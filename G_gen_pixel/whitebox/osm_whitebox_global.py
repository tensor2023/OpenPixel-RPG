#!/usr/bin/env python3
"""
Global OSM whitebox renderer — works for any lat/lon on Earth.

Differences from osm_whitebox.py (NYC-hardcoded):
  - No hardcoded BBOX; accepts center + radius or explicit bbox
  - SCALE auto-calculated to fit the area into the canvas
  - Usable both as CLI and as importable library

CLI usage:
  python osm_whitebox_global.py --lat 31.281 --lon 121.504 --radius 400
  python osm_whitebox_global.py --bbox 31.275,121.498,31.287,121.511
  python osm_whitebox_global.py --lat 40.785 --lon -73.965 --radius 300 --output /tmp/wb.png

Library usage:
  from osm_whitebox_global import generate_whitebox
  path = generate_whitebox(lat=31.281, lon=121.504, radius_m=400, output="/tmp/wb.png")
"""

import argparse
import json
import math
import os

import requests
from PIL import Image, ImageDraw

CANVAS_W, CANVAS_H = 1280, 960
DEFAULT_H = 20          # metres when OSM has no height/level tag
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

# ── Proxy support (for access from mainland China) ────────────────────────────
def _get_proxy():
    return (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or
            os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy") or None)

# ── Load hyperparams to match the 3D Tiles camera ───────────────────────────────
_hp_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "hyperparams.json")
with open(_hp_path) as _f:
    _HP = json.load(_f)
CAM_AZIMUTH = math.radians(_HP.get("CAMERA_AZIMUTH", -15))
CAM_ELEVATION = math.radians(_HP.get("CAMERA_ELEVATION", -45))
# Precomputed trig values for the isometric projection
_COS_AZ = math.cos(CAM_AZIMUTH)
_SIN_AZ = math.sin(CAM_AZIMUTH)
_COS_EL = math.cos(abs(CAM_ELEVATION))
_SIN_EL = math.sin(abs(CAM_ELEVATION))

# ── Coordinate helpers ────────────────────────────────────────────────────────

def _bbox_from_center(lat: float, lon: float, radius_m: float):
    """Return (lat_min, lon_min, lat_max, lon_max) for a square area."""
    delta_lat = radius_m / 111_000
    delta_lon = radius_m / (111_000 * math.cos(math.radians(lat)))
    return (lat - delta_lat, lon - delta_lon, lat + delta_lat, lon + delta_lon)


def _auto_scale(bbox):
    """Compute SCALE so the bbox fits in the canvas with an 85% margin."""
    lat_c = (bbox[0] + bbox[2]) / 2
    lon_span = bbox[3] - bbox[1]
    lat_span = bbox[2] - bbox[0]
    # geo_to_px: x = (lon-lon_c)*SCALE*cos(lat), y = (lat_c-lat)*SCALE
    scale_lon = CANVAS_W * 0.85 / (lon_span * math.cos(math.radians(lat_c)))
    scale_lat = CANVAS_H * 0.85 / lat_span
    return min(scale_lon, scale_lat)


def _make_coord_fns(bbox, scale):
    lat_c = (bbox[0] + bbox[2]) / 2
    lon_c = (bbox[1] + bbox[3]) / 2

    def geo_to_px(lat, lon):
        x = (lon - lon_c) * scale * math.cos(math.radians(lat_c))
        y = (lat_c - lat) * scale
        return x, y

    def iso(x, y, z=0):
        """Project flat coords to isometric screen, matching 3D Tiles camera.
        Azimuth θ and elevation φ from hyperparams.json (default -15° / -45°).
        Screen formulas (orthographic projection):
          sx =  x*cos(θ) - y*sin(θ)
          sy = -x*sin(θ)*sin(|φ|) - y*cos(θ)*sin(|φ|) - z*cos(|φ|)
        """
        sx =  x * _COS_AZ          - y * _SIN_AZ
        sy = -x * _SIN_AZ * _SIN_EL - y * _COS_AZ * _SIN_EL - z * _COS_EL
        return int(sx + CANVAS_W / 2), int(sy + CANVAS_H * 0.55)

    return geo_to_px, iso

# ── OSM fetch + parse ─────────────────────────────────────────────────────────

def _fetch_buildings(bbox):
    query = f"""
[out:json][timeout:60];
(
  way["building"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
  relation["building"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
);
out body;
>;
out skel qt;
"""
    headers = {"User-Agent": "osm-whitebox-global/1.0"}
    proxy = _get_proxy()
    proxies = {"http": proxy, "https": proxy} if proxy else None

    last_error = None
    for url in OVERPASS_URLS:
        try:
            print(f"Querying Overpass API: {url} …")
            r = requests.post(url, data={"data": query}, headers=headers,
                            timeout=90, proxies=proxies)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_error = e
            print(f"  Failed: {e}, trying next mirror...")

    raise last_error


def _parse_buildings(data):
    nodes = {el["id"]: (el["lat"], el["lon"])
             for el in data["elements"] if el["type"] == "node"}
    buildings = []
    for el in data["elements"]:
        if el["type"] != "way" or "building" not in el.get("tags", {}):
            continue
        refs = el.get("nodes", [])
        coords = [nodes[r] for r in refs if r in nodes]
        if len(coords) < 3:
            continue
        tags = el.get("tags", {})
        raw_h = tags.get("height", tags.get("building:levels", str(DEFAULT_H / 3.5)))
        try:
            h = float(str(raw_h).split()[0])
            # If value looks like levels (small int), convert to metres
            if "height" not in tags and h < 50:
                h = h * 3.5
        except Exception:
            h = DEFAULT_H
        buildings.append({"coords": coords, "height": max(h, 3.0)})
    print(f"  Parsed {len(buildings)} buildings.")
    return buildings

# ── Render ────────────────────────────────────────────────────────────────────

def _render(buildings, geo_to_px, iso):
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), (10, 10, 10))
    draw = ImageDraw.Draw(img)

    # Painter's algorithm: north-facing buildings drawn first
    buildings.sort(key=lambda b: -sum(c[0] for c in b["coords"]) / len(b["coords"]))

    for bld in buildings:
        coords = bld["coords"]
        h_px = bld["height"] * 0.35

        pts_flat = [geo_to_px(lat, lon) for lat, lon in coords]

        top = [iso(x, y, h_px) for x, y in pts_flat]
        draw.polygon(top, fill=(230, 230, 230), outline=(200, 200, 200))

        n = len(pts_flat) - 1
        for i in range(n):
            p0 = pts_flat[i]
            p1 = pts_flat[(i + 1) % n]
            bot0 = iso(p0[0], p0[1], 0)
            bot1 = iso(p1[0], p1[1], 0)
            top0 = iso(p0[0], p0[1], h_px)
            top1 = iso(p1[0], p1[1], h_px)
            dx = p1[0] - p0[0]
            shade = (150, 150, 150) if dx > 0 else (100, 100, 100)
            draw.polygon([bot0, bot1, top1, top0], fill=shade, outline=(80, 80, 80))

    return img

# ── Public API ────────────────────────────────────────────────────────────────

def generate_whitebox(
    lat: float,
    lon: float,
    radius_m: float = 400,
    bbox=None,
    output: str = None,
    canvas_w: int = CANVAS_W,
    canvas_h: int = CANVAS_H,
) -> str:
    """
    Generate an isometric whitebox PNG and save it.

    Args:
        lat, lon   : center coordinate (used if bbox is None)
        radius_m   : half-side of the square area in metres (default 400 ≈ 2-3 blocks)
        bbox       : explicit (lat_min, lon_min, lat_max, lon_max) overrides lat/lon/radius_m
        output     : output file path (default: whitebox_<lat>_<lon>.png in cwd)
        canvas_w, canvas_h : canvas dimensions in pixels

    Returns:
        Absolute path of the saved PNG.
    """
    global CANVAS_W, CANVAS_H
    CANVAS_W, CANVAS_H = canvas_w, canvas_h

    if bbox is None:
        bbox = _bbox_from_center(lat, lon, radius_m)

    if output is None:
        center_lat = (bbox[0] + bbox[2]) / 2
        center_lon = (bbox[1] + bbox[3]) / 2
        output = os.path.abspath(f"whitebox_{center_lat:.4f}_{center_lon:.4f}.png")

    scale = _auto_scale(bbox)
    geo_to_px, iso = _make_coord_fns(bbox, scale)

    data = _fetch_buildings(bbox)
    buildings = _parse_buildings(data)
    img = _render(buildings, geo_to_px, iso)
    img.save(output)
    print(f"Saved whitebox → {output}")
    return output

# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate isometric whitebox for any location")
    parser.add_argument("--lat", type=float, help="Center latitude")
    parser.add_argument("--lon", type=float, help="Center longitude")
    parser.add_argument("--radius", type=float, default=400,
                        help="Half-side radius in metres (default 400 ≈ 3 city blocks)")
    parser.add_argument("--bbox", type=str,
                        help="Explicit bbox: lat_min,lon_min,lat_max,lon_max")
    parser.add_argument("--output", type=str, default=None,
                        help="Output PNG path (default: whitebox_<lat>_<lon>.png)")
    args = parser.parse_args()

    bbox = None
    if args.bbox:
        parts = [float(v) for v in args.bbox.split(",")]
        bbox = tuple(parts)
    elif args.lat is None or args.lon is None:
        parser.error("Provide --lat and --lon (or --bbox)")

    generate_whitebox(
        lat=args.lat or 0,
        lon=args.lon or 0,
        radius_m=args.radius,
        bbox=bbox,
        output=args.output,
    )
