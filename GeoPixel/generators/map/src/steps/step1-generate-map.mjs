import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { editImage, generateImage } from "../models/gemini-flash-img.mjs";
import { geminiProVisionJSON } from "../models/gemini-pro.mjs";
import { chat } from "../models/llm-client.mjs";
import { loadPrompt } from "../utils/prompt-loader.mjs";
import { resizeImage } from "../utils/image-utils.mjs";
import { getMapImageSizeLabel } from "../utils/generation-config.mjs";
import {
  formatElementSummary,
  formatMapPlanSummary,
  formatRegionSummary,
} from "../utils/world-design-summary.mjs";

const STEP_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * 阶段 E：读取 Map_gen_RPG/runtime-refs/ref_collage.png，或环境变量 REF_COLLAGE_PATH。
 * USE_STEP1_REF_COLLAGE=0 / false 可关闭图生图路径。
 */
function resolveRefCollageBuffer() {
  const off = process.env.USE_STEP1_REF_COLLAGE;
  if (off === "0" || off === "false") return null;

  const explicit = process.env.REF_COLLAGE_PATH?.trim();
  if (explicit && existsSync(explicit)) {
    return readFileSync(explicit);
  }

  const geopixelRoot = join(STEP_DIR, "../../../..");
  const sibling = join(geopixelRoot, "..", "Map_gen_RPG", "runtime-refs", "ref_collage.png");
  if (existsSync(sibling)) {
    return readFileSync(sibling);
  }
  return null;
}

const REF_EDIT_SUFFIX = `

---
## 参考拼图（图生图输入，必读）
你收到的是一张**横向拼接**的参考图：上方条带文字说明左右含义。**左侧**为卫星俯视，**右侧**为近景/路网或占位灰底。请生成**最终俯视游戏大地图**（接近正上方视角）：
- **几何与区块关系**可参考左右图（道路、水体、建筑疏密），但不要复制卫星灰度质感或摄影镜头畸变。
- **画风**必须严格服从上文「用户指定美术风格」与「具体内容」，输出统一像素/插画风格的游戏地图。
- **禁止**在画上保留参考图里的条带说明文字；**禁止**出现任何可读标注、水印、Logo（与硬性约束一致）。
`;

/**
 * Generate the source map with self-feedback loop.
 * Allows up to MAX_RETRIES modifications + 1 final review.
 * @param {string} userPrompt
 * @param {object} worldDesign
 * @param {(name: string, data: any) => void} save - callback to persist intermediate artifacts
 * @param {{ originalUserPrompt?: string }} options
 * @returns {{ buffer: Buffer, reviewPassed: boolean, attempts: number }}
 */
export async function generateMap(userPrompt, worldDesign, save, { originalUserPrompt = "" } = {}) {
  const MAX_RETRIES = parseInt(process.env.STEP1_MAX_RETRIES || process.env.MAX_RETRIES || "3", 10);
  const MAP_IMAGE_SIZE = getMapImageSizeLabel();
  const GENERATE_TIMEOUT_MS = parseInt(process.env.STEP1_GENERATE_TIMEOUT_MS || "180000", 10);
  const REVIEW_TIMEOUT_MS = parseInt(process.env.STEP1_REVIEW_TIMEOUT_MS || "90000", 10);
  const ADJUST_TIMEOUT_MS = parseInt(process.env.STEP1_ADJUST_TIMEOUT_MS || "90000", 10);
  let additionalConstraints = "";
  let mapBuffer = null;
  const totalAttempts = MAX_RETRIES + 1;
  const mapPlanSummary = formatMapPlanSummary(worldDesign);
  const regionSummary = formatRegionSummary(worldDesign);
  const elementSummary = formatElementSummary(worldDesign);

  const rawArt = String(worldDesign.artStylePrompt ?? process.env.ART_STYLE_PROMPT ?? "").trim();
  const artStylePrompt =
    rawArt ||
    "（未通过 worldDesign.artStylePrompt / 环境变量 ART_STYLE_PROMPT 单独指定：请完全服从上文「具体内容」与地图规划中的视觉描述，并保持俯视游戏地图的统一风格。）";

  const refCollageBuffer = resolveRefCollageBuffer();
  if (refCollageBuffer) {
    console.log(
      `[Step 1] 检测到参考拼图 (${refCollageBuffer.length} bytes)，将使用 editImage（图生图）；关闭请设 USE_STEP1_REF_COLLAGE=0`,
    );
  }

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    console.log(`[Step 1] Generating map (attempt ${attempt}/${totalAttempts})...`);

    const prompt = loadPrompt("step1-map-generation.md", {
      userPrompt,
      originalUserPrompt: originalUserPrompt || "",
      mapPlanSummary,
      regionSummary,
      elementSummary,
      additionalConstraints,
      artStylePrompt,
    });

    if (refCollageBuffer) {
      const editPrompt = `${prompt}${REF_EDIT_SUFFIX}`;
      mapBuffer = await editImage(editPrompt, refCollageBuffer, {
        imageSize: MAP_IMAGE_SIZE,
        logStep: "Step 1 edit-from-ref",
        requestTimeoutMs: GENERATE_TIMEOUT_MS,
        timeoutEnvKey: "STEP1_GENERATE_TIMEOUT_MS",
      });
    } else {
      mapBuffer = await generateImage(prompt, {
        aspectRatio: "16:9",
        imageSize: MAP_IMAGE_SIZE,
        logStep: "Step 1 generate",
        requestTimeoutMs: GENERATE_TIMEOUT_MS,
      });
    }
    console.log(`[Step 1] Generated image: ${mapBuffer.length} bytes`);
    save(`01-map-attempt-${attempt}.png`, mapBuffer);

    console.log(`[Step 1] Reviewing (${attempt}/${totalAttempts})...`);
    const { buffer: smallBuf } = await resizeImage(mapBuffer, 1024);

    const reviewPrompt = loadPrompt("step1-map-review.md", {
      userPrompt,
      originalUserPrompt: originalUserPrompt || "",
      mapPlanSummary,
      regionSummary,
      elementSummary,
      artStylePrompt,
    });

    let review;
    let reviewError = null;
    try {
      review = await geminiProVisionJSON(reviewPrompt, [smallBuf], {
        logStep: "Step 1 review",
        requestTimeoutMs: REVIEW_TIMEOUT_MS,
      });
    } catch (e) {
      reviewError = e;
      console.warn(`[Step 1] Review failed on attempt ${attempt}: ${e.message}`);
      review = { pass: false, issues: [`Review request failed: ${e.message}`], promptAdjustments: [] };
    }

    if (review.pass) {
      console.log("[Step 1] Review result: pass=true, issues=0");
      console.log(`[Step 1] Map passed review on attempt ${attempt}.`);
      return { buffer: mapBuffer, reviewPassed: true, attempts: attempt };
    }

    if (reviewError) {
      console.log(`[Step 1] Review unavailable on attempt ${attempt}, retrying generation.`);
      continue;
    }

    console.log(`[Step 1] Review failed. Issues: ${review.issues?.join("; ")}`);

    if (attempt < totalAttempts && review.promptAdjustments?.length) {
      const adjustmentRequest = `以下是对地图生成prompt的审查反馈，请将这些调整建议整合成额外的约束条件（用中文，简洁明了）：\n${review.promptAdjustments.join("\n")}`;
      const newConstraints = await chat([
        { role: "user", content: adjustmentRequest },
      ], { logStep: "Step 1 adjust", requestTimeoutMs: ADJUST_TIMEOUT_MS });
      additionalConstraints += `\n${newConstraints}`;
      console.log(`[Step 1] Accumulated constraints: ${additionalConstraints.slice(0, 300)}`);
    }
  }

  console.warn(`[Step 1] All ${totalAttempts} attempts exhausted, review never passed.`);
  return { buffer: mapBuffer, reviewPassed: false, attempts: totalAttempts };
}
