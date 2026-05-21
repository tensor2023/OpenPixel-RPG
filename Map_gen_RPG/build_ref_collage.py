#!/usr/bin/env python
"""
阶段 E：将 Google 卫星图 +（可选）百度街块图拼成一张 PNG，供 WorldX Step1 editImage 使用。
依赖 Pillow：conda activate game && pip install -r requirements.txt
"""
from __future__ import annotations

import argparse
import glob
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("错误: 需要 Pillow。请执行: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def _load_rgba(path: str) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    return im


def _resize_cover(im: Image.Image, tw: int, th: int) -> Image.Image:
    """等比放大后居中裁剪到 tw×th。"""
    im = im.copy()
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(sw * scale + 0.5), int(sh * scale + 0.5)
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    x0 = (nw - tw) // 2
    y0 = (nh - th) // 2
    return im.crop((x0, y0, x0 + tw, y0 + th))


def _gray_panel(tw: int, th: int, caption: str) -> Image.Image:
    im = Image.new("RGBA", (tw, th), (40, 40, 48, 255))
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), caption, font=font)
    twt = bbox[2] - bbox[0]
    tht = bbox[3] - bbox[1]
    draw.text(((tw - twt) // 2, (th - tht) // 2), caption, fill=(200, 200, 210, 255), font=font)
    return im


def main() -> None:
    parser = argparse.ArgumentParser(description="卫星 + 百度街景 -> ref_collage.png")
    parser.add_argument(
        "--dir",
        default=os.path.join("runtime-refs"),
        help="含 google_satellite.png 的目录",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="",
        help="输出路径，默认 <dir>/ref_collage.png",
    )
    parser.add_argument("--half-w", type=int, default=640, help="左/右半幅宽")
    parser.add_argument("--h", type=int, default=720, help="整图高度")
    args = parser.parse_args()

    d = args.dir
    sat_path = ""
    for name in ("region_for_patches.png", "google_satellite_for_model.png", "google_satellite.png"):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            sat_path = p
            break
    if not sat_path:
        print(
            f"错误: 在 {d} 下缺少卫星图（google_satellite.png 或先运行 prepare_satellite / crop_region）",
            file=sys.stderr,
        )
        sys.exit(1)

    tw, th = args.half_w, args.h
    total_w = tw * 2

    left = _resize_cover(_load_rgba(sat_path), tw, th)

    baidu_paths = sorted(
        glob.glob(os.path.join(d, "baidu_scene_1.png"))
        + glob.glob(os.path.join(d, "baidu_scene_1.jpg"))
        + glob.glob(os.path.join(d, "baidu_scene_1.jpeg"))
    )
    if baidu_paths:
        right = _resize_cover(_load_rgba(baidu_paths[0]), tw, th)
        right_cap = "街景/路网参考（百度）"
    else:
        right = _gray_panel(tw, th, "无百度实景图\n（未配置 BAIDU_MAP_AK 或未生成）")
        right_cap = "无百度图"

    out = Image.new("RGBA", (total_w, th + 28), (16, 16, 20, 255))
    out.paste(left, (0, 28))
    out.paste(right, (tw, 28))
    draw = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    draw.rectangle((0, 0, total_w, 28), fill=(32, 32, 40, 255))
    draw.text((8, 4), "左：卫星俯视（Google）", fill=(220, 220, 230, 255), font=font)
    draw.text((tw + 8, 4), f"右：{right_cap}", fill=(220, 220, 230, 255), font=font)

    out_path = args.output or os.path.join(d, "ref_collage.png")
    out_dir = os.path.dirname(os.path.abspath(out_path))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    out.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"已写入: {out_path} ({os.path.getsize(out_path)} bytes)")


if __name__ == "__main__":
    main()
