#!/usr/bin/env python
"""
用多模态聊天模型在卫星图上定位用户描述的区域，按返回的归一化 bbox 裁剪，供切片/单 patch 出图。
环境变量（与 WorldX 一致，在运行前 export 或 source .env 后执行）：
  VISION_BASE_URL / VISION_API_KEY / VISION_MODEL
若未配 VISION_*，可回退：ORCHESTRATOR_BASE_URL / ORCHESTRATOR_API_KEY / ORCHESTRATOR_MODEL（须支持图像输入）。

提分辨率：--full-res-crop（缩略图走 API、原图裁剪）；--vision-max-edge 256（API 仅用最长边 256 的等比图定位，bbox 仍映射原图）；--margin；prepare_satellite --max-edge 加大。
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

try:
    from PIL import Image
except ImportError:
    print("错误: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)


def _vision_config():
    b = os.environ.get("VISION_BASE_URL", "").strip()
    k = os.environ.get("VISION_API_KEY", "").strip()
    m = os.environ.get("VISION_MODEL", "").strip()
    if b and k and m:
        return b.rstrip("/"), k, m
    b = os.environ.get("ORCHESTRATOR_BASE_URL", "").strip()
    k = os.environ.get("ORCHESTRATOR_API_KEY", "").strip()
    m = os.environ.get("ORCHESTRATOR_MODEL", "").strip()
    if b and k and m:
        return b.rstrip("/"), k, m
    return None, None, None


def _https_ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    except (AttributeError, ValueError):
        pass
    return ctx


def _call_vision_chat(image_png: bytes, user_query: str, base_url: str, api_key: str, model: str) -> str:
    b64 = base64.standard_b64encode(image_png).decode("ascii")
    url = f"{base_url}/chat/completions"
    system = (
        "你是遥感/地图助手。用户会给一张俯视卫星图并用中文指出兴趣区域。"
        "你必须只回复一个 JSON 对象，不要 markdown，不要其它文字。"
        '格式严格为：{"bbox_norm":[x1,y1,x2,y2]}，其中 x1,y1,x2,y2 均为 0～1 的浮点数，'
        "相对整图宽高的比例：x 从左到右，y 从上到下；且满足 x1<x2, y1<y2。"
        "若无法判断，返回近似包含该区域的合理框，不要返回 null。"
    )
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"请框出：{user_query}"},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"},
                    },
                ],
            },
        ],
        "max_tokens": 500,
    }
    ua = os.environ.get(
        "VISION_HTTP_USER_AGENT",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": ua,
            "Accept": "application/json",
        },
        method="POST",
    )
    ssl_ctx = _https_ssl_context() if url.lower().startswith("https:") else None
    retries = int(os.environ.get("VISION_HTTP_RETRIES", "3"))
    for attempt in range(max(1, retries)):
        try:
            kw: dict = {"timeout": 120}
            if ssl_ctx is not None:
                kw["context"] = ssl_ctx
            with urllib.request.urlopen(req, **kw) as resp:
                raw = resp.read().decode("utf-8")
            break
        except urllib.error.HTTPError as e:
            raise SystemExit(f"Vision HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:800]}") from e
        except urllib.error.URLError as e:
            if attempt + 1 >= max(1, retries):
                raise SystemExit(f"请求失败: {e}") from e
            time.sleep(min(8.0, 0.8 * (2**attempt)))

    data = json.loads(raw)
    msg = data.get("choices", [{}])[0].get("message", {})
    content = msg.get("content", "")
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict) and p.get("type") == "text":
                parts.append(p.get("text", ""))
        content = "".join(parts)
    return str(content)


def _parse_bbox_norm(text: str) -> tuple[float, float, float, float]:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        raise ValueError(f"模型未返回 JSON: {text[:300]}")
    obj = json.loads(m.group())
    box = obj.get("bbox_norm") or obj.get("bbox")
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError(f"JSON 缺少 bbox_norm: {obj}")
    x1, y1, x2, y2 = (float(box[i]) for i in range(4))
    x1, x2 = min(x1, x2), max(x1, x2)
    y1, y2 = min(y1, y2), max(y1, y2)
    x1, y1 = max(0.0, min(1.0, x1)), max(0.0, min(1.0, y1))
    x2, y2 = max(0.0, min(1.0, x2)), max(0.0, min(1.0, y2))
    if x2 - x1 < 0.05 or y2 - y1 < 0.05:
        raise ValueError("bbox 过小，请换描述或重试")
    return x1, y1, x2, y2


def _expand_bbox_norm(
    x1: float, y1: float, x2: float, y2: float, margin: float
) -> tuple[float, float, float, float]:
    """按框宽高比例外扩 margin（如 0.15 表示每边再加 15% 框宽/框高），再夹到 [0,1]。"""
    if margin <= 0:
        return x1, y1, x2, y2
    bw, bh = x2 - x1, y2 - y1
    if bw <= 0 or bh <= 0:
        return x1, y1, x2, y2
    x1 -= bw * margin
    x2 += bw * margin
    y1 -= bh * margin
    y2 += bh * margin
    x1, x2 = max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))
    y1, y2 = max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))
    if x2 <= x1 or y2 <= y1:
        raise ValueError("margin 过大导致框退化，请减小 --margin")
    return x1, y1, x2, y2


def _pick_first_existing(dir_path: str, names: tuple[str, ...]) -> str | None:
    for name in names:
        cand = os.path.join(dir_path, name)
        if os.path.isfile(cand):
            return cand
    return None


def _resize_max_edge(im: Image.Image, max_edge: int) -> Image.Image:
    """等比缩放，最长边不超过 max_edge（与 prepare_satellite 一致）；max_edge<=0 则原样返回。"""
    if max_edge <= 0:
        return im
    w, h = im.size
    m = max(w, h)
    if m <= max_edge:
        return im
    s = max_edge / m
    nw, nh = int(w * s + 0.5), int(h * s + 0.5)
    return im.resize((max(1, nw), max(1, nh)), Image.Resampling.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="runtime-refs")
    ap.add_argument(
        "-i",
        "--input",
        default="",
        help="输入卫星图（API 与裁剪同源），默认优先 google_satellite_for_model.png 再 google_satellite.png",
    )
    ap.add_argument(
        "--vision-input",
        default="",
        help="仅用于多模态 API 的图；与 --crop-input 组合可实现「小图定位、原图裁剪」",
    )
    ap.add_argument(
        "--crop-input",
        default="",
        help="按 bbox_norm 裁剪保存的图；默认同 vision。存在原图时请与 --vision-input 或 --full-res-crop 配合",
    )
    ap.add_argument(
        "--full-res-crop",
        action="store_true",
        help="若存在 google_satellite.png：API 用 for_model（若存在）否则原图，裁剪始终用原图（须与缩略图同构图缩放，bbox_norm 才对齐）",
    )
    ap.add_argument(
        "--margin",
        type=float,
        default=0.0,
        help="框外扩：相对框宽/高的比例，如 0.12 在四周多带约 12% 环境像素",
    )
    ap.add_argument(
        "--vision-max-edge",
        type=int,
        default=0,
        help="仅影响多模态 API：把送入模型的图等比压到最长边不超过该值（如 256），省流量；bbox_norm 与未缩放图一致，可配合 --full-res-crop 在原图裁出高分辨率 patch",
    )
    ap.add_argument("-o", "--output", default="", help="默认 <dir>/region_for_patches.png")
    ap.add_argument("--query", required=True, help='中文区域描述，如："操场""图书馆前广场"')
    args = ap.parse_args()

    base_url, api_key, model = _vision_config()
    if not base_url:
        print("错误: 请配置 VISION_* 或 ORCHESTRATOR_*（须支持图+文）", file=sys.stderr)
        sys.exit(1)

    d = args.dir
    if args.input:
        path_vision = path_crop = args.input
    elif args.full_res_crop:
        full_p = os.path.join(d, "google_satellite.png")
        small_p = _pick_first_existing(d, ("google_satellite_for_model.png",))
        if not os.path.isfile(full_p):
            print("错误: --full-res-crop 需要同目录下存在 google_satellite.png", file=sys.stderr)
            sys.exit(1)
        path_vision = small_p if small_p else full_p
        path_crop = full_p
    else:
        first = _pick_first_existing(d, ("google_satellite_for_model.png", "google_satellite.png"))
        if not first:
            print("错误: 找不到卫星图", file=sys.stderr)
            sys.exit(1)
        path_vision = path_crop = first

    if args.vision_input:
        path_vision = args.vision_input
    if args.crop_input:
        path_crop = args.crop_input

    im_v = Image.open(path_vision).convert("RGB")
    im_api = _resize_max_edge(im_v, args.vision_max_edge)
    bbuf = io.BytesIO()
    im_api.save(bbuf, format="PNG")
    buf = bbuf.getvalue()

    text = _call_vision_chat(buf, args.query, base_url, api_key, model)
    x1n, y1n, x2n, y2n = _parse_bbox_norm(text)
    x1n, y1n, x2n, y2n = _expand_bbox_norm(x1n, y1n, x2n, y2n, args.margin)

    im_c = Image.open(path_crop).convert("RGB")
    wv, hv = im_v.size
    wc, hc = im_c.size
    ar_v = wv / max(hv, 1)
    ar_c = wc / max(hc, 1)
    if abs(ar_v - ar_c) / max(ar_v, ar_c, 1e-6) > 0.02:
        print(
            "警告: vision 图与裁剪图宽高比相差 >2%，bbox 可能错位；请使用 prepare_satellite 从原图等比缩放得到的 for_model",
            file=sys.stderr,
        )

    w, h = wc, hc
    x1, y1 = int(x1n * w), int(y1n * h)
    x2, y2 = int(x2n * w), int(y2n * h)
    crop = im_c.crop((x1, y1, x2, y2))
    out = args.output or os.path.join(d, "region_for_patches.png")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    crop.save(out, "PNG", optimize=True)
    meta = {
        "vision_source": path_vision,
        "crop_source": path_crop,
        "source": path_crop,
        "query": args.query,
        "bbox_pixels": [x1, y1, x2, y2],
        "bbox_norm": [x1n, y1n, x2n, y2n],
        "margin": args.margin,
        "vision_max_edge": args.vision_max_edge,
        "vision_api_pixels": [im_api.size[0], im_api.size[1]],
        "vision_ref_pixels": [wv, hv],
    }
    meta_dir = os.path.dirname(os.path.abspath(out)) or "."
    with open(os.path.join(meta_dir, "region_crop_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"已裁剪 -> {out}，像素框 {meta['bbox_pixels']}")


if __name__ == "__main__":
    main()
