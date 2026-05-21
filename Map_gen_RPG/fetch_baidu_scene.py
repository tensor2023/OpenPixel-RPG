#!/usr/bin/env python
"""
阶段 C：读取 place.json，调用百度地图静态图 v2，以该地点为中心拉一张「街块」实景图。
环境变量 BAIDU_MAP_AK；未配置时**直接跳过**（退出码 0，不请求百度）。
若控制台启用了 SN 校验，再设 BAIDU_MAP_SK（本脚本会计算 sn 参数）。
center 使用经度,纬度；coordtype=wgs84ll 与 Google Geocoding 的 WGS84 一致。
仅使用标准库。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BAIDU_STATIC_URL = "https://api.map.baidu.com/staticimage/v2"


def load_place(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _append_sn(pairs: list[tuple[str, str]], sk: str) -> list[tuple[str, str]]:
    """
    百度 SN：对「路径 + ? + 查询串」做 quote 后与 SK 拼接再 MD5。
    pairs 顺序必须与最终请求一致。若与你控制台校验不一致，请关闭 SN 或按官方文档改此函数。
    """
    path = "/staticimage/v2"
    qs = urllib.parse.urlencode(pairs)
    raw = f"{path}?{qs}"
    quoted = urllib.parse.quote(raw, safe="/:=&?+,#._-")
    sn = hashlib.md5((quoted + sk).encode("utf-8")).hexdigest()
    return pairs + [("sn", sn)]


def build_param_pairs(
    ak: str,
    lng: float,
    lat: float,
    width: int,
    height: int,
    zoom: int,
    coordtype: str,
    sk: str | None,
) -> list[tuple[str, str]]:
    # 百度文档：center 为 经度,纬度
    pairs: list[tuple[str, str]] = [
        ("ak", ak),
        ("center", f"{lng},{lat}"),
        ("width", str(width)),
        ("height", str(height)),
        ("zoom", str(zoom)),
        ("coordtype", coordtype),
        ("copyright", "1"),
    ]
    if sk:
        return _append_sn(pairs, sk)
    return pairs


def fetch_image(pairs: list[tuple[str, str]]) -> tuple[bytes, str]:
    qs = urllib.parse.urlencode(pairs)
    url = f"{BAIDU_STATIC_URL}?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "Map_gen_RPG/fetch_baidu_scene"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:800]
        raise SystemExit(f"HTTP {e.code}: {body}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"请求失败: {e}") from e
    return data, ctype


def _guess_ext(data: bytes) -> str:
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    return ".bin"


def main() -> None:
    parser = argparse.ArgumentParser(description="百度静态图 v2 -> baidu_scene_1.*")
    parser.add_argument(
        "-i",
        "--input",
        default=os.path.join("runtime-refs", "place.json"),
        help="阶段 A 输出（默认 runtime-refs/place.json）",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="",
        help="输出文件路径；默认按内容自动为 runtime-refs/baidu_scene_1.jpg 或 .png",
    )
    parser.add_argument("--width", type=int, default=640, help="图片宽 [50,1024]")
    parser.add_argument("--height", type=int, default=640, help="图片高 [50,1024]")
    parser.add_argument("--zoom", type=int, default=17, help="缩放 约 3-19，街块建议 16-18")
    parser.add_argument(
        "--coordtype",
        default="wgs84ll",
        choices=("wgs84ll", "gcj02ll", "bd09ll"),
        help="与 center 坐标系一致；默认 wgs84ll 对齐 Google Geocoding",
    )
    args = parser.parse_args()

    ak = os.environ.get("BAIDU_MAP_AK", "").strip()
    if not ak:
        print("跳过百度静态图：未设置环境变量 BAIDU_MAP_AK（仅使用 Google 阶段 A/B 即可）")
        sys.exit(0)

    sk = os.environ.get("BAIDU_MAP_SK", "").strip() or None

    if not os.path.isfile(args.input):
        print(f"错误: 找不到 {args.input!r}，请先跑 resolve_place.py", file=sys.stderr)
        sys.exit(1)

    place = load_place(args.input)
    lat = float(place["lat"])
    lng = float(place["lng"])

    w, h = args.width, args.height
    if not (50 < w <= 1024 and 50 < h <= 1024):
        print("错误: width/height 需在 (50,1024] 区间内（见百度静态图文档）", file=sys.stderr)
        sys.exit(1)

    pairs = build_param_pairs(ak, lng, lat, w, h, args.zoom, args.coordtype, sk)
    data, ctype = fetch_image(pairs)

    ext = _guess_ext(data)
    if args.output:
        out_path = args.output
    else:
        base = "baidu_scene_1.jpg" if ext == ".jpg" else "baidu_scene_1.png"
        out_path = os.path.join("runtime-refs", base)

    if len(data) < 2000 and ext == ".bin":
        head = data[:400].decode("utf-8", errors="replace")
        raise SystemExit(f"返回内容异常（可能 AK 无效、未开通静态图或 SN 错误）。开头:\n{head}")

    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)

    print(f"已写入: {out_path} ({len(data)} bytes, Content-Type={ctype!r})")


if __name__ == "__main__":
    main()
