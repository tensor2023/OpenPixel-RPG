#!/usr/bin/env python
"""
对单张 patch 调用与 WorldX 兼容的 OpenAI-style 图生图（chat/completions + modalities）。
环境变量：IMAGE_GEN_BASE_URL / IMAGE_GEN_API_KEY / IMAGE_GEN_MODEL（与 WorldX .env 一致）。
可选：MAP_PATCH_IMAGE_SIZE 默认 1K（减轻上游压力）。
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request


def _extract_png_from_response(data: dict) -> bytes:
    msg = data.get("choices", [{}])[0].get("message", {})
    if msg.get("images"):
        url = msg["images"][0].get("image_url", {}).get("url", "")
        b64 = url.split(",", 1)[-1] if "," in url else ""
        if b64:
            return base64.standard_b64decode(b64)
    content = msg.get("content", "")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if "base64," in url:
                    return base64.standard_b64decode(url.split("base64,", 1)[1])
    if isinstance(content, str):
        m = re.search(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)", content)
        if m:
            return base64.standard_b64decode(m.group(1))
    raise SystemExit(f"响应中未解析到图片: {json.dumps(msg, ensure_ascii=False)[:500]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--patch", required=True, help="patch PNG 路径，如 runtime-refs/patches/patch_0_0.png")
    ap.add_argument(
        "--style",
        default="",
        help="像素/美术风格；也可通过环境变量 PATCH_STYLE 提供",
    )
    ap.add_argument(
        "--extra",
        default="",
        help="附加说明，如：保持俯视、不要出现文字",
    )
    ap.add_argument("-o", "--output", default="", help="输出 PNG；默认与 patch 同目录加后缀 _pixel")
    args = ap.parse_args()

    base = os.environ.get("IMAGE_GEN_BASE_URL", "").strip().rstrip("/")
    key = os.environ.get("IMAGE_GEN_API_KEY", "").strip()
    model = os.environ.get("IMAGE_GEN_MODEL", "").strip()
    if not (base and key and model):
        print("错误: 请设置 IMAGE_GEN_BASE_URL / IMAGE_GEN_API_KEY / IMAGE_GEN_MODEL", file=sys.stderr)
        sys.exit(1)

    style = (args.style or os.environ.get("PATCH_STYLE", "") or "").strip()
    if not style:
        print("错误: 请提供 --style 或 PATCH_STYLE", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.patch):
        print(f"错误: 找不到 {args.patch}", file=sys.stderr)
        sys.exit(1)

    with open(args.patch, "rb") as f:
        raw = f.read()
    b64 = base64.standard_b64encode(raw).decode("ascii")
    image_size = os.environ.get("MAP_PATCH_IMAGE_SIZE", "1K").strip() or "1K"

    instruction = (
        f"将输入的卫星/航拍俯视块转换为游戏可用的**像素风或块面风**俯视贴图块。"
        f"美术要求：{style}。"
        f"{args.extra}"
        " 保持道路与地块关系可辨认；不要添加任何文字、水印、坐标轴；不要出现小人角色。"
    )

    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
        "modalities": ["image", "text"],
        "image_config": {"image_size": image_size},
    }

    url = f"{base}/chat/completions"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:1200]}") from e
    except urllib.error.URLError as e:
        raise SystemExit(f"请求失败: {e}") from e

    png = _extract_png_from_response(out)
    outp = args.output
    if not outp:
        root, ext = os.path.splitext(args.patch)
        outp = f"{root}_pixel{ext or '.png'}"
    os.makedirs(os.path.dirname(os.path.abspath(outp)) or ".", exist_ok=True)
    with open(outp, "wb") as f:
        f.write(png)
    print(f"已写入: {outp} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
