#!/usr/bin/env bash
# 阶段 F：依次跑 Map_gen_RPG A→B→C→E→D，再进入 WorldX-main 执行 npm run create。
# 用法：
#   ./run_phase_f.sh "地点" "美术风格" ["可选：create 的整句世界描述；省略则用 prompt_context.json 里的建议句"]
#
# 需：conda/python、GOOGLE_MAPS_API_KEY；可选 BAIDU_MAP_AK；阶段 E 需 pip install -r requirements.txt
# 可选环境变量：
#   SAT_MAX_EDGE=1024        — prepare_satellite 最长边
#   SAT_DOWNLOAD_TIMEOUT=120 SAT_DOWNLOAD_RETRIES=5 — fetch_satellite 大 PNG 下载（弱网 IncompleteRead）
#   RUN_VISION_CROP=1        — 在缩放后调用视觉裁剪（需 VISION_* 或 ORCHESTRATOR_* 支持多模态）
#   CROP_QUERY=操场          — 传给 crop_region_with_vision.py
#   RUN_PATCH_SPLIT=1       — 切 patch 网格（不自动逐块出图，见 README）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WX="$REPO_ROOT/WorldX-main"
MG="$SCRIPT_DIR"

if [[ -z "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  echo "错误: 请 export GOOGLE_MAPS_API_KEY" >&2
  exit 1
fi

PLACE="${1:?用法: $0 <地点> <美术风格> [create 描述可选]}"
ART="${2:?}"
shift 2 || true
CREATE_PROMPT="${*:-}"

cd "$MG"
python resolve_place.py --place "$PLACE"
python fetch_satellite.py
python prepare_satellite.py --max-edge "${SAT_MAX_EDGE:-1024}"
if [[ "${RUN_VISION_CROP:-}" == "1" ]]; then
  python crop_region_with_vision.py --query "${CROP_QUERY:-操场}"
fi
if [[ "${RUN_PATCH_SPLIT:-}" == "1" ]]; then
  python split_to_patches.py --rows "${PATCH_ROWS:-2}" --cols "${PATCH_COLS:-2}"
fi
python fetch_baidu_scene.py
python build_ref_collage.py
python write_prompt_context.py --art-style "$ART"

set -a
# shellcheck disable=SC1091
source "$MG/runtime-refs/export_art_style.sh"
set +a

if [[ -z "${CREATE_PROMPT// }" ]]; then
  CREATE_PROMPT="$(python -c "import json; print(json.load(open('$MG/runtime-refs/prompt_context.json'))['npm_run_create_suggestion'])")"
fi

cd "$WX"
npm run create -- "$CREATE_PROMPT"
