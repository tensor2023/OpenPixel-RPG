#!/usr/bin/env python
"""
将 google_satellite.png 缩放到最长边不超过 --max-edge，减轻后续视觉模型 / 图生图 payload。
输出默认：runtime-refs/google_satellite_for_model.png（不覆盖原图）。
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

try:
    from PIL import Image
except ImportError:
    print("错误: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default="runtime-refs", help="含 google_satellite.png 的目录")
    p.add_argument("--max-edge", type=int, default=1024, help="最长边像素上限")
    p.add_argument(
        "-o",
        "--output",
        default="",
        help="输出路径，默认 <dir>/google_satellite_for_model.png",
    )
    args = p.parse_args()

    src = os.path.join(args.dir, "google_satellite.png")
    if not os.path.isfile(src):
        print(f"错误: 缺少 {src}", file=sys.stderr)
        sys.exit(1)

    out = args.output or os.path.join(args.dir, "google_satellite_for_model.png")
    im = Image.open(src).convert("RGB")
    w, h = im.size
    m = max(w, h)
    if m <= args.max_edge:
        shutil.copy2(src, out)
        print(f"原图已小于等于 {args.max_edge}px，直接复制 -> {out}")
        return

    scale = args.max_edge / m
    nw, nh = int(w * scale + 0.5), int(h * scale + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    im.save(out, "PNG", optimize=True)
    print(f"已缩放 {w}x{h} -> {nw}x{nh}，写入 {out}")


if __name__ == "__main__":
    main()
