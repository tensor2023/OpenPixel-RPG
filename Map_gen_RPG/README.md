# Map_gen_RPG

阶段 A～D 脚本仅依赖 **Python 标准库**；**阶段 E 拼图**需 **`pip install -r requirements.txt`**（Pillow）。

## 阶段 A：地点 → WGS84 坐标 + bbox

```bash
conda activate game
export GOOGLE_MAPS_API_KEY="你的Key"
cd Map_gen_RPG
python resolve_place.py --place "同济大学四平路校区"
```

默认写出 `runtime-refs/place.json`。自定义输出路径：

```bash
python resolve_place.py --place "天安门" -o runtime-refs/place.json
```

依赖：仅 Python 标准库（`urllib`），无需 `pip install`。

## 阶段 B：Google 卫星静态图

先完成阶段 A 生成 `runtime-refs/place.json`。Cloud 控制台需启用 **Maps Static API**（与 Geocoding 同一 Key 即可，注意 Key 的 API 限制里勾选该 API）。

```bash
conda activate game
export GOOGLE_MAPS_API_KEY="你的Key"
cd Map_gen_RPG
python fetch_satellite.py
```

默认读 `runtime-refs/place.json`，写出 `runtime-refs/google_satellite.png`。可选参数：`--size 640x640`、`--maptype satellite|hybrid`、`--scale 1|2`、`-i`/`-o` 自定义路径。

**A + B 连续跑：**

```bash
python resolve_place.py --place "同济大学四平路校区" && python fetch_satellite.py
```

## 阶段 C：百度静态「街块」实景图（可选）

未设置 **`BAIDU_MAP_AK`** 时，`fetch_baidu_scene.py` 会**直接跳过**（成功退出、不拉百度图），可与仅 Google 的流程链式执行。

已配置时：需 **百度地图开放平台** 创建应用并勾选 **静态图 API**（服务文档：https://lbsyun.baidu.com/index.php?title=webapi/staticimg-v2 ）。

```bash
conda activate game
export BAIDU_MAP_AK="你的AK"
# 若应用启用了「SN 校验」，再设置 SK（与控制台一致）：
# export BAIDU_MAP_SK="你的SK"
cd Map_gen_RPG
python fetch_baidu_scene.py
```

默认读 `runtime-refs/place.json`（与阶段 A 同一 WGS84 中心），`coordtype=wgs84ll`；写出 **`runtime-refs/baidu_scene_1.jpg`** 或 **`baidu_scene_1.png`**（按接口返回魔数自动选扩展名）。可调 `--zoom`、`--width`、`--height`、`--coordtype`。

**A + B + C：**

```bash
export GOOGLE_MAPS_API_KEY="..."
export BAIDU_MAP_AK="..."
python resolve_place.py --place "同济大学四平路校区" && python fetch_satellite.py && python fetch_baidu_scene.py
```

## 阶段 D：美术风格写入上下文 + WorldX Step1 接入

1. **本仓库脚本** `write_prompt_context.py`：读 `place.json`，根据 **`--art-style`**（或环境变量 **`ART_STYLE_PROMPT`**）生成  
   - `runtime-refs/prompt_context.json`（含给 `npm run create` 的整句建议）  
   - `runtime-refs/export_art_style.sh`（`source` 后设置 **`ART_STYLE_PROMPT`**，供 **WorldX** `generators/map` 使用）

```bash
cd Map_gen_RPG
python write_prompt_context.py --art-style "16bit 日系像素 JRPG，黄昏暖色，俯视游戏大地图"
```

2. **WorldX**（`WorldX-main`）：已在 **`prompts/step1-map-generation.md`**、**`step1-map-review.md`** 加入占位 **`{{artStylePrompt}}`**；**`step1-generate-map.mjs`** 从 **`worldDesign.artStylePrompt`** 或环境变量 **`ART_STYLE_PROMPT`** 注入（未设置时用一段占位说明，不阻断管线）。

跑地图子管线前（在 `WorldX-main` 根目录、已 `cp .env`）：

```bash
source /path/to/Map_gen_RPG/runtime-refs/export_art_style.sh
cd WorldX-main
npm run generate:map -- "你的地图描述……"
```

或在 **`WORLD_DESIGN_PATH`** 指向的 JSON 里增加字段 **`"artStylePrompt": "……"`**（与编排输出并存时优先生效）。

**A → D（无 B/C 也可先写风格）：**

```bash
export GOOGLE_MAPS_API_KEY="..."
python resolve_place.py --place "同济大学四平路校区" && python write_prompt_context.py --art-style "16bit 像素"
```

## 阶段 E：参考拼图 + WorldX Step1 图生图

1. **拼图**（需 **Pillow**，仅此阶段）：`pip install -r requirements.txt`
2. 生成 **`runtime-refs/ref_collage.png`**（左卫星、右百度街景；无百度时为灰底说明）。
3. 在 **`WorldX-main`** 跑 **`npm run generate:map`** 时，若检测到该文件（或 **`REF_COLLAGE_PATH`**），Step1 自动走 **`editImage`** 而非纯文生图。关闭参考：`USE_STEP1_REF_COLLAGE=0`。

```bash
conda activate game
cd Map_gen_RPG
pip install -r requirements.txt
python resolve_place.py --place "同济大学四平路校区" && \
  python fetch_satellite.py && \
  python prepare_satellite.py && \
  python fetch_baidu_scene.py && \
  python build_ref_collage.py
source runtime-refs/export_art_style.sh
cd ../WorldX-main
npm run generate:map -- "基于上述真实地点的俯视街区地图，道路清晰，无文字标牌。"
```

可选：**`REF_COLLAGE_PATH=/绝对路径/ref_collage.png`**；仓库布局非「`WorldX-main` 与 `Map_gen_RPG` 同级」时请用此变量。

## 阶段 F：一键 prefetch + `npm run create`

仓库根与 **`WorldX-main` / `Map_gen_RPG` 同级** 时：

```bash
conda activate game
export GOOGLE_MAPS_API_KEY="..."
# export BAIDU_MAP_AK="..."   # 可选
pip install -r Map_gen_RPG/requirements.txt   # 阶段 E 拼图
chmod +x Map_gen_RPG/run_phase_f.sh
./Map_gen_RPG/run_phase_f.sh "同济大学四平路校区" "16bit 日系像素 JRPG，黄昏暖色"
```

第三参可省略，则用 **`prompt_context.json`** 里的 **`npm_run_create_suggestion`** 作为 `npm run create` 的句子。

**仅手动跑 WorldX**（已自己跑完 A–E+D）：在 **`WorldX-main`** 执行 **`npm run create`** 前保证 **`Map_gen_RPG/runtime-refs/prompt_context.json`** 存在或已 **`export ART_STYLE_PROMPT`**；编排器会自动合并 **`artStylePrompt`** 到 **`world-design.json`**（见 **`orchestrator/src/index.mjs`** 中 **`mergeArtStyleFromMapGenRuntime`**）。自定义运行时目录可设 **`MAP_GEN_RUNTIME_DIR`**（指向含 `prompt_context.json` 的目录）。

---

## 卫星缩放 / 语义裁剪 / Patch 像素块（减轻单次出图分辨率）

WorldX **Step1** 默认仍是一张**整图大地图**；patch 管线用于：**先缩小卫星 →（可选）让多模态模型按中文框区域 → 再切块 → 对每一块单独走 `IMAGE_GEN` 图生图**，避免一张超大卫星直接塞进模型。

| 脚本 | 作用 |
|------|------|
| **`prepare_satellite.py`** | `google_satellite.png` → `google_satellite_for_model.png`（`--max-edge`，默认 1024） |
| **`crop_region_with_vision.py`** | 用 **`VISION_*`**（若无则用 **`ORCHESTRATOR_*`**）看图 + `--query "操场"`，输出 **`region_for_patches.png`** + `region_crop_meta.json` |
| **`split_to_patches.py`** | 将当前输入图（优先 `region_for_patches.png`）切成 **`runtime-refs/patches/patch_r_c.png`** + **`manifest.json`** |
| **`generate_patch_pixel.py`** | 对**单张** patch 调 **`IMAGE_GEN_*`**（与 WorldX `.env` 相同），`--style` 控制像素风；可选 **`MAP_PATCH_IMAGE_SIZE`**（默认 `1K`） |

**手动示例：**

```bash
cd Map_gen_RPG
pip install -r requirements.txt
export VISION_BASE_URL=... VISION_API_KEY=... VISION_MODEL=...   # 须支持图+文
export IMAGE_GEN_BASE_URL=... IMAGE_GEN_API_KEY=... IMAGE_GEN_MODEL=...
python fetch_satellite.py
python prepare_satellite.py --max-edge 1024
python crop_region_with_vision.py --query "操场"
python split_to_patches.py --rows 2 --cols 2
python generate_patch_pixel.py --patch runtime-refs/patches/patch_0_0.png --style "16bit 日系像素俯视块"
```

**一键脚本 `run_phase_f.sh`** 已默认执行 **`prepare_satellite`**。若要启用视觉裁剪 / 切片：

```bash
RUN_VISION_CROP=1 CROP_QUERY="图书馆前广场" RUN_PATCH_SPLIT=1 PATCH_ROWS=2 PATCH_COLS=2 \
  ./Map_gen_RPG/run_phase_f.sh "同济大学四平路校区" "16bit 像素"
```

**与 WorldX 的关系**：WorldX 地图管线主要消费 **一张整图** + 后续 TMJ；patch 出图适合作为 **素材块 / 背景 tile 原型** 或 **拼回一张较小 ref 再喂 `ref_collage`**（自动拼回大图未实现，可自行在图像软件里拼）。角色立绘、建筑贴图等由 WorldX **角色生成**等阶段负责；patch 流是**并行素材路径**，不替代整套 TMJ。
