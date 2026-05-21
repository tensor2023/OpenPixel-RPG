#!/usr/bin/env python
"""
阶段 A：用户地点字符串 -> Google Geocoding -> WGS84 lat/lng + bbox -> place.json
需环境变量 GOOGLE_MAPS_API_KEY。仅使用标准库。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


def _default_bbox(lat: float, lng: float, delta: float = 0.003) -> dict[str, float]:
    """无 viewport 时，以约数百米级方框兜底（度数近似）。"""
    return {
        "south": lat - delta,
        "west": lng - delta,
        "north": lat + delta,
        "east": lng + delta,
    }


def geocode(place: str, api_key: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "address": place,
            "key": api_key,
        }
    )
    url = f"{GEOCODE_URL}?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "Map_gen_RPG/resolve_place"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:500]}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"请求失败: {e}") from e

    data = json.loads(raw)
    status = data.get("status")
    if status != "OK":
        err = data.get("error_message", "")
        raise SystemExit(f"Geocoding status={status} {err}".strip())

    result = data["results"][0]
    loc = result["geometry"]["location"]
    lat, lng = float(loc["lat"]), float(loc["lng"])
    geom = result["geometry"]

    bbox: dict[str, float] | None = None
    vp = geom.get("viewport")
    if vp:
        ne = vp["northeast"]
        sw = vp["southwest"]
        bbox = {
            "south": float(sw["lat"]),
            "west": float(sw["lng"]),
            "north": float(ne["lat"]),
            "east": float(ne["lng"]),
        }
    else:
        bounds = geom.get("bounds")
        if bounds:
            ne = bounds["northeast"]
            sw = bounds["southwest"]
            bbox = {
                "south": float(sw["lat"]),
                "west": float(sw["lng"]),
                "north": float(ne["lat"]),
                "east": float(ne["lng"]),
            }

    if bbox is None:
        bbox = _default_bbox(lat, lng)

    out = {
        "placeQuery": place,
        "formattedAddress": result.get("formatted_address", ""),
        "lat": lat,
        "lng": lng,
        "bbox": bbox,
        "locationType": geom.get("location_type", ""),
        "viewport": vp,
        "placeId": result.get("place_id", ""),
    }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Google Geocoding -> place.json (WGS84)")
    parser.add_argument("--place", required=True, help="地点描述，如 同济大学四平路校区")
    parser.add_argument(
        "-o",
        "--output",
        default=os.path.join("runtime-refs", "place.json"),
        help="输出 JSON 路径（默认 runtime-refs/place.json）",
    )
    args = parser.parse_args()

    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        print("错误: 请设置环境变量 GOOGLE_MAPS_API_KEY", file=sys.stderr)
        sys.exit(1)

    payload = geocode(args.place, key)

    out_path = args.output
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"已写入: {out_path}")
    print(json.dumps({"lat": payload["lat"], "lng": payload["lng"], "bbox": payload["bbox"]}, indent=2))


if __name__ == "__main__":
    main()
