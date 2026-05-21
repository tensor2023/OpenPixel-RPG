#!/usr/bin/env python
"""
阶段 B：读取阶段 A 的 place.json，调用 Google Maps Static API 拉卫星图 -> google_satellite.png
需环境变量 GOOGLE_MAPS_API_KEY，且 Cloud 项目已启用 Maps Static API。仅使用标准库。
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

STATIC_MAP_URL = "https://maps.googleapis.com/maps/api/staticmap"


def load_place(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_url(
    api_key: str,
    bbox: dict[str, float],
    size: str,
    maptype: str,
    scale: int,
) -> str:
    """用 visible=西南|东北 框住 bbox，避免手算 zoom。"""
    south, west = float(bbox["south"]), float(bbox["west"])
    north, east = float(bbox["north"]), float(bbox["east"])
    visible = f"{south},{west}|{north},{east}"
    params = urllib.parse.urlencode(
        {
            "size": size,
            "scale": str(scale),
            "maptype": maptype,
            "visible": visible,
            "key": api_key,
        },
        safe="|",
    )
    return f"{STATIC_MAP_URL}?{params}"


def download_png(url: str, out_path: str, *, timeout: float, retries: int) -> None:
    """大 PNG 在弱网/代理下易出现 IncompleteRead，做有限次重试。"""
    last: BaseException | None = None
    for attempt in range(max(1, retries)):
        req = urllib.request.Request(url, headers={"User-Agent": "Map_gen_RPG/fetch_satellite"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            break
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:800]
            raise SystemExit(f"HTTP {e.code}: {body}") from e
        except http.client.IncompleteRead as e:
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionResetError, BrokenPipeError, OSError) as e:
            last = e
        if attempt + 1 >= max(1, retries):
            raise SystemExit(
                f"下载中断（已重试 {retries} 次）: {last}\n"
                "可检查：网络/代理是否稳定；unset 代理试直连；或稍后再跑 fetch_satellite.py。"
            ) from last
        time.sleep(min(10.0, 1.5 * (2**attempt)))

    if len(data) < 1000 or not data.startswith(b"\x89PNG"):
        # 常见错误：返回 JSON 或 HTML 说明文字
        head = data[:500].decode("utf-8", errors="replace")
        raise SystemExit(f"返回不是 PNG（可能被拒或配额问题）。开头内容:\n{head}")

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description="Maps Static API -> google_satellite.png")
    parser.add_argument(
        "-i",
        "--input",
        default=os.path.join("runtime-refs", "place.json"),
        help="阶段 A 输出的 JSON（默认 runtime-refs/place.json）",
    )
    parser.add_argument(
        "-o",
        "--output",
        default=os.path.join("runtime-refs", "google_satellite.png"),
        help="输出 PNG（默认 runtime-refs/google_satellite.png）",
    )
    parser.add_argument(
        "--size",
        default="640x640",
        help="Static API size，如 640x640（见官方文档上限）",
    )
    parser.add_argument(
        "--maptype",
        default="satellite",
        choices=("satellite", "hybrid", "roadmap", "terrain"),
        help="地图类型，默认 satellite",
    )
    parser.add_argument(
        "--scale",
        type=int,
        default=2,
        choices=(1, 2),
        help="scale=2 提高像素密度（逻辑尺寸仍为 size）",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("SAT_DOWNLOAD_TIMEOUT", "120")),
        help="单次下载超时秒数（也可用环境变量 SAT_DOWNLOAD_TIMEOUT）",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=int(os.environ.get("SAT_DOWNLOAD_RETRIES", "5")),
        help="IncompleteRead/断连时重试次数（SAT_DOWNLOAD_RETRIES）",
    )
    args = parser.parse_args()

    key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        print("错误: 请设置环境变量 GOOGLE_MAPS_API_KEY", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.input):
        print(f"错误: 找不到输入文件 {args.input!r}，请先跑 resolve_place.py", file=sys.stderr)
        sys.exit(1)

    place = load_place(args.input)
    bbox = place.get("bbox")
    if not bbox or not all(k in bbox for k in ("south", "west", "north", "east")):
        print("错误: place.json 缺少 bbox.south/west/north/east", file=sys.stderr)
        sys.exit(1)

    url = build_url(key, bbox, args.size, args.maptype, args.scale)
    download_png(url, args.output, timeout=args.timeout, retries=args.retries)
    print(f"已写入: {args.output} ({os.path.getsize(args.output)} bytes)")


if __name__ == "__main__":
    main()
