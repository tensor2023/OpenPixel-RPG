#!/usr/bin/env python
"""
将卫星图（或 vision 裁剪后的 region）切成 rows×cols 网格，便于逐块调图生图。
输出：runtime-refs/patches/patch_r_c.png + patches/manifest.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("错误: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def pick_input(d: str, explicit: str) -> str:
    if explicit:
        return explicit
    for name in ("region_for_patches.png", "google_satellite_for_model.png", "google_satellite.png"):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    raise SystemExit(f"错误: 在 {d} 下找不到可用输入图")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="runtime-refs")
    ap.add_argument("-i", "--input", default="", help="输入图路径；省略则自动选 region/缩放卫星/原卫星")
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--cols", type=int, default=2)
    args = ap.parse_args()

    if args.rows < 1 or args.cols < 1:
        sys.exit("rows/cols 须 >=1")

    inp = pick_input(args.dir, args.input)
    im = Image.open(inp).convert("RGB")
    W, H = im.size
    cw, ch = W // args.cols, H // args.rows
    if cw < 32 or ch < 32:
        sys.exit("切片过小，请减小行列数或换更大输入图")

    out_dir = os.path.join(args.dir, "patches")
    os.makedirs(out_dir, exist_ok=True)

    manifest: list[dict] = []
    for r in range(args.rows):
        for c in range(args.cols):
            x0, y0 = c * cw, r * ch
            x1, y1 = min(x0 + cw, W), min(y0 + ch, H)
            tile = im.crop((x0, y0, x1, y1))
            fn = f"patch_{r}_{c}.png"
            path = os.path.join(out_dir, fn)
            tile.save(path, "PNG", optimize=True)
            manifest.append(
                {
                    "file": fn,
                    "row": r,
                    "col": c,
                    "bbox_pixels": [x0, y0, x1, y1],
                    "source_image": os.path.basename(inp),
                    "source_size": [W, H],
                }
            )

    man_path = os.path.join(out_dir, "manifest.json")
    with open(man_path, "w", encoding="utf-8") as f:
        json.dump({"patches": manifest, "grid": [args.rows, args.cols]}, f, ensure_ascii=False, indent=2)

    print(f"已写入 {len(manifest)} 张切片 -> {out_dir}")
    print(f"清单: {man_path}")


if __name__ == "__main__":
    main()
