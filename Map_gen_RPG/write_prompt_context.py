#!/usr/bin/env python
"""
阶段 D：把用户「美术风格」与阶段 A 的地点信息写入 runtime-refs，供 WorldX Step1 与环境变量使用。
- prompt_context.json：完整字段 + 一行版（便于日志）
- export_art_style.sh：可被 bash `source`，设置 ART_STYLE_PROMPT（供 WorldX generators/map 读取）
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import sys


def one_line(s: str) -> str:
    return " ".join(s.split())


def main() -> None:
    parser = argparse.ArgumentParser(description="阶段 D：写入美术风格与地点上下文")
    parser.add_argument(
        "--art-style",
        default="",
        help="用户指定美术风格，如：16bit 日系像素 JRPG，黄昏暖色。也可通过环境变量 ART_STYLE_PROMPT 传入（命令行优先）。",
    )
    parser.add_argument(
        "-i",
        "--input",
        default=os.path.join("runtime-refs", "place.json"),
        help="阶段 A 的 place.json",
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join("runtime-refs"),
        help="输出目录，默认 runtime-refs",
    )
    args = parser.parse_args()

    art = (args.art_style or os.environ.get("ART_STYLE_PROMPT", "") or "").strip()
    if not art:
        print("错误: 请提供 --art-style 或环境变量 ART_STYLE_PROMPT", file=sys.stderr)
        sys.exit(1)

    if not os.path.isfile(args.input):
        print(f"错误: 找不到 {args.input!r}，请先跑 resolve_place.py", file=sys.stderr)
        sys.exit(1)

    with open(args.input, encoding="utf-8") as f:
        place = json.load(f)

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    addr = place.get("formattedAddress") or place.get("placeQuery") or ""
    pq = place.get("placeQuery") or ""

    # 给 npm run create 的一句示例（不含引号转义说明：用户自行包在引号内）
    npm_hint = (
        f"基于真实地点「{addr or pq}」的开放街区俯视地图。"
        f"美术风格：{one_line(art)}。"
        "卫星与街景参考图见 Map_gen_RPG/runtime-refs/。"
    )

    ctx = {
        "art_style_prompt": art,
        "art_style_prompt_one_line": one_line(art),
        "placeQuery": pq,
        "formattedAddress": place.get("formattedAddress", ""),
        "lat": place.get("lat"),
        "lng": place.get("lng"),
        "npm_run_create_suggestion": npm_hint,
        "worldx_env": {
            "ART_STYLE_PROMPT": "运行 WorldX 地图管线前在 shell 中 export；或 source export_art_style.sh",
        },
    }

    json_path = os.path.join(out_dir, "prompt_context.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(ctx, f, ensure_ascii=False, indent=2)

    sh_path = os.path.join(out_dir, "export_art_style.sh")
    export_line = f"export ART_STYLE_PROMPT={shlex.quote(art)}\n"
    with open(sh_path, "w", encoding="utf-8") as f:
        f.write("# 由 write_prompt_context.py 生成；用法: source runtime-refs/export_art_style.sh\n")
        f.write(export_line)

    print(f"已写入: {json_path}")
    print(f"已写入: {sh_path}")
    print("\nWorldX 前请在同一终端执行:")
    print(f"  source {sh_path}")
    print("\n或 npm create 参考句（整句加引号）:")
    print(f"  {npm_hint[:200]}{'…' if len(npm_hint) > 200 else ''}")


if __name__ == "__main__":
    main()
