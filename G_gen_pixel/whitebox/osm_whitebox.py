#!/usr/bin/env python3
"""
Render a 3D isometric whitebox image of NYC Central Park surroundings
using OpenStreetMap building data (no browser / no system libs needed).
"""

import json, math, requests
from PIL import Image, ImageDraw

# ── Area: Central Park NYC (bbox: south, west, north, east) ──────────────────
BBOX = (40.766, -73.981, 40.800, -73.950)   # lat_min, lon_min, lat_max, lon_max

CANVAS_W, CANVAS_H = 1280, 960
DEFAULT_H = 20          # metres, when OSM has no height tag
SCALE     = 35000       # pixels per degree
ISO_ANGLE = math.radians(30)

OUTPUT = "/home/gaoxueqing/2026/Agent_JRPG_Tongji/G_gen_pixel/whitebox/whitebox.png"

# ── Coordinate helpers ───────────────────────────────────────────────────────
lat_c = (BBOX[0] + BBOX[2]) / 2
lon_c = (BBOX[1] + BBOX[3]) / 2

def geo_to_px(lat, lon):
    """Convert lat/lon to flat canvas pixel (before iso projection)."""
    x = (lon - lon_c) * SCALE * math.cos(math.radians(lat_c))
    y = (lat_c - lat) * SCALE
    return x, y

def iso(x, y, z=0):
    """Isometric projection: flat (x,y) + height z → screen pixel."""
    sx =  x * math.cos(ISO_ANGLE) - y * math.cos(ISO_ANGLE)
    sy = -x * math.sin(ISO_ANGLE) - y * math.sin(ISO_ANGLE) - z * 0.5
    return int(sx + CANVAS_W / 2), int(sy + CANVAS_H * 0.6)

# ── Fetch buildings from Overpass API ───────────────────────────────────────
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
QUERY = f"""
[out:json][timeout:60];
(
  way["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body;
>;
out skel qt;
"""

def fetch_buildings():
    print("Querying Overpass API …")
    headers = {"User-Agent": "osm-whitebox-renderer/1.0"}
    r = requests.post(OVERPASS_URL, data={"data": QUERY}, headers=headers, timeout=90)
    r.raise_for_status()
    return r.json()

def parse_buildings(data):
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
        h = float(tags.get("height", tags.get("building:levels", DEFAULT_H / 3.5)) or DEFAULT_H)
        if isinstance(h, float) and "levels" not in tags.get("height", ""):
            pass
        else:
            # levels → rough metres
            try:
                h = float(str(h).split()[0]) * 3.5
            except Exception:
                h = DEFAULT_H
        buildings.append({"coords": coords, "height": h})
    print(f"  Parsed {len(buildings)} buildings.")
    return buildings

# ── Render ───────────────────────────────────────────────────────────────────
def render(buildings):
    img = Image.new("RGB", (CANVAS_W, CANVAS_H), (10, 10, 10))
    draw = ImageDraw.Draw(img)

    # Sort buildings back-to-front (painter's algorithm: larger lat = further north = draw first)
    buildings.sort(key=lambda b: -sum(c[0] for c in b["coords"]) / len(b["coords"]))

    for bld in buildings:
        coords = bld["coords"]
        h_px = bld["height"] * 0.5   # scale height to pixels

        # Ground footprint pixels
        pts_flat = [geo_to_px(lat, lon) for lat, lon in coords]

        # Top face (roof) → white
        top = [iso(x, y, h_px) for x, y in pts_flat]
        draw.polygon(top, fill=(230, 230, 230), outline=(200, 200, 200))

        # Side faces: left side darker, right side medium grey
        n = len(pts_flat) - 1  # last == first
        for i in range(n):
            p0 = pts_flat[i]
            p1 = pts_flat[(i + 1) % n]
            bot0 = iso(p0[0], p0[1], 0)
            bot1 = iso(p1[0], p1[1], 0)
            top0 = iso(p0[0], p0[1], h_px)
            top1 = iso(p1[0], p1[1], h_px)
            # Determine face direction to pick shade
            dx = p1[0] - p0[0]
            shade = (150, 150, 150) if dx > 0 else (100, 100, 100)
            face = [bot0, bot1, top1, top0]
            draw.polygon(face, fill=shade, outline=(80, 80, 80))

    img.save(OUTPUT)
    print(f"Saved: {OUTPUT}")

# ── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    data = fetch_buildings()
    buildings = parse_buildings(data)
    render(buildings)
