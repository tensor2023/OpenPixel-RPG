import { editImage } from "../models/gemini-flash-img.mjs";
import { geminiProVisionJSON } from "../models/gemini-pro.mjs";
import { loadPrompt } from "../utils/prompt-loader.mjs";
import {
  formatMapPlanSummary,
  formatRegionSummary,
} from "../utils/world-design-summary.mjs";

/**
 * Generate a walkable-area-marked version of the map using image editing mode.
 * Allows up to MAX_RETRIES modifications + 1 final review per attempt.
 * If all regular attempts fail review, falls back to inverted prompt
 * ("mark everything EXCEPT buildings/water/sky as walkable").
 * If that also fails, falls back to pixel-wise averaging of all cyan overlays.
 * When env var STEP4_FAST_MODE=true, skips the review-retry loop entirely and
 * goes straight to the inverted prompt (one call, no review).
 * @param {Buffer} compressedMapBuffer - same-resolution optimized map used for model input
 * @param {string} userPrompt - user's map description for context
 * @param {object} worldDesign
 * @param {(name: string, data: any) => void} save
 * @returns {{ buffer: Buffer, reviewPassed: boolean, attempts: number }}
 */
export async function generateWalkableMap(compressedMapBuffer, userPrompt, worldDesign, save) {
  const MAX_RETRIES = parseInt(process.env.STEP4_MAX_RETRIES || process.env.MAX_RETRIES || "3", 10);
  const GENERATE_TIMEOUT_MS = parseInt(process.env.STEP4_GENERATE_TIMEOUT_MS || "180000", 10);
  const REVIEW_TIMEOUT_MS = parseInt(process.env.STEP4_REVIEW_TIMEOUT_MS || "90000", 10);
  const FAST_MODE = process.env.STEP4_FAST_MODE === "true";
  let additionalInstructions = "";
  const totalAttempts = MAX_RETRIES;
  const mapPlanSummary = formatMapPlanSummary(worldDesign);
  const regionSummary = formatRegionSummary(worldDesign);

  // ── Fast mode: skip review-retry loop, go straight to inverted prompt ──
  if (FAST_MODE) {
    console.log(`[Step 4] FAST MODE: using inverted prompt (everything except buildings/water/sky = cyan)...`);
    const fallbackBuffer = await tryInvertedPrompt(
      compressedMapBuffer, { mapPlanSummary, regionSummary, userPrompt },
      GENERATE_TIMEOUT_MS, save,
    );
    return { buffer: fallbackBuffer, reviewPassed: false, attempts: 1 };
  }

  // Collect all successfully generated marked buffers for potential fallback averaging
  const markedBuffers = [];

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    console.log(`[Step 4] Generating walkable area map (attempt ${attempt}/${totalAttempts})...`);

    const prompt = loadPrompt("step4-walkable-generation.md", {
      additionalInstructions,
      mapPlanSummary,
      regionSummary,
      userPrompt,
    });

    let markedBuffer;
    try {
      markedBuffer = await editImage(prompt, compressedMapBuffer, {
        imageSize: "1K",
        logStep: "Step 4 generate",
        requestTimeoutMs: GENERATE_TIMEOUT_MS,
      });
    } catch (e) {
      console.warn(`[Step 4] API call failed on attempt ${attempt}: ${e.message}`);
      continue; // skip this attempt, keep going
    }
    console.log(`[Step 4] Generated marked image: ${markedBuffer.length} bytes`);
    save(`04-walkable-attempt-${attempt}.png`, markedBuffer);
    markedBuffers.push(markedBuffer);

    console.log(`[Step 4] Reviewing (${attempt}/${totalAttempts})...`);

    const reviewPrompt = loadPrompt("step4-walkable-review.md", {
      mapPlanSummary,
      regionSummary,
      userPrompt,
    });

    let review;
    let reviewError = null;
    try {
      review = await geminiProVisionJSON(reviewPrompt, [compressedMapBuffer, markedBuffer], {
        logStep: "Step 4 review",
        requestTimeoutMs: REVIEW_TIMEOUT_MS,
      });
    } catch (e) {
      reviewError = e;
      console.warn(`[Step 4] Review failed on attempt ${attempt}: ${e.message}`);
      review = { pass: false, issues: [`Review request failed: ${e.message}`], promptAdjustments: [] };
    }

    if (review.pass) {
      console.log("[Step 4] Review result: pass=true, issues=0");
      console.log(`[Step 4] Walkable area map passed review on attempt ${attempt}.`);
      return { buffer: markedBuffer, reviewPassed: true, attempts: attempt };
    }

    if (reviewError) {
      console.log(`[Step 4] Review unavailable on attempt ${attempt}, retrying generation.`);
      continue;
    }

    console.log(`[Step 4] Review failed. Issues: ${review.issues?.join("; ")}`);

    if (attempt < totalAttempts && review.promptAdjustments?.length) {
      additionalInstructions += `\n### 第${attempt}次审查反馈\n${review.promptAdjustments.join("\n")}`;
    }
  }

  // ── Fallback strategy 1: try inverted prompt ──
  if (markedBuffers.length > 0) {
    console.warn(`[Step 4] All ${totalAttempts} regular attempts exhausted, review never passed.`);
    console.warn(`[Step 4] ⚠ FALLBACK 1: trying inverted prompt (everything except buildings/water/sky = cyan)...`);

    try {
      const fallbackBuffer = await tryInvertedPrompt(
        compressedMapBuffer, { mapPlanSummary, regionSummary, userPrompt },
        GENERATE_TIMEOUT_MS, save,
      );
      return { buffer: fallbackBuffer, reviewPassed: false, attempts: totalAttempts + 1 };
    } catch (e) {
      console.warn(`[Step 4] Fallback (inverted prompt) also failed: ${e.message}`);
    }
  }

  // ── Fallback strategy 2: pixel-wise averaging ──
  if (markedBuffers.length === 0) {
    console.error(`[Step 4] All ${totalAttempts} attempts exhausted with no successful API response.`);
    throw new Error("Step 4: All attempts failed — no walkable map could be generated.");
  }

  console.warn(`[Step 4] ⚠ FALLBACK 2: averaging ${markedBuffers.length} attempt(s) to produce composite walkable map.`);

  const avgFallbackBuffer = await averageWalkableMaps(compressedMapBuffer, markedBuffers);
  save("04-walkable-fallback-average.png", avgFallbackBuffer);

  console.warn(`[Step 4] Fallback composite saved to 04-walkable-fallback-average.png`);
  return { buffer: avgFallbackBuffer, reviewPassed: false, attempts: totalAttempts };
}

/**
 * Single call with inverted prompt: mark everything cyan EXCEPT buildings/water/sky.
 * Used directly in fast mode, or as fallback after regular attempts exhaust.
 */
async function tryInvertedPrompt(compressedMapBuffer, { mapPlanSummary, regionSummary, userPrompt }, timeoutMs, save) {
  const fallbackPrompt = loadPrompt("step4-walkable-fallback.md", {
    additionalInstructions: "",
    mapPlanSummary,
    regionSummary,
    userPrompt,
  });

  const fallbackBuffer = await editImage(fallbackPrompt, compressedMapBuffer, {
    imageSize: "1K",
    logStep: "Step 4 fallback",
    requestTimeoutMs: timeoutMs,
  });
  console.log(`[Step 4] Fallback generated: ${fallbackBuffer.length} bytes`);
  save("04-walkable-fallback.png", fallbackBuffer);
  console.warn(`[Step 4] Using fallback (inverted) walkable map.`);
  return fallbackBuffer;
}

/**
 * Pixel-wise averaging of cyan overlays from multiple failed attempts.
 *
 * For each pixel, estimates the cyan overlay alpha from each attempt via the green channel:
 *   α ≈ clamp((marked.g - orig.g) / (255 - orig.g + 1e-6), 0, 1)
 *
 * Then averages across attempts, thresholds, and re-applies cyan overlay on the original.
 */
async function averageWalkableMaps(originalBuffer, markedBuffers) {
  const sharp = (await import("sharp")).default;

  const origMeta = await sharp(originalBuffer).metadata();
  const w = origMeta.width;
  const h = origMeta.height;

  const origRaw = await sharp(originalBuffer).raw().toBuffer();

  // Decode each marked buffer to raw RGBA
  const markRaws = await Promise.all(
    markedBuffers.map((buf) =>
      sharp(buf).resize(w, h, { fit: "fill" }).raw().toBuffer(),
    ),
  );
  const channels = origRaw.length / (w * h); // 3 or 4

  // Per-pixel accumulate alpha from each attempt
  const alphaSum = new Float32Array(w * h);
  let validCount = 0;

  for (const markRaw of markRaws) {
    validCount++;
    for (let i = 0; i < w * h; i++) {
      const origG = origRaw[i * channels + 1];
      const markG = markRaw[i * channels + 1];
      // cyan overlay: mark = orig*(1-α) + 255*α → α = (mark - orig) / (255 - orig)
      const alpha = Math.max(0, Math.min(1, (markG - origG) / (255 - origG + 1e-6)));
      alphaSum[i] += alpha;
    }
  }

  // Build composite: average alpha, threshold, re-apply cyan
  const CYAN_R = 0, CYAN_G = 255, CYAN_B = 255;
  const THRESHOLD = 0.3;
  const out = Buffer.alloc(w * h * 3);

  for (let i = 0; i < w * h; i++) {
    const alphaAvg = alphaSum[i] / validCount;
    const alpha = alphaAvg > THRESHOLD ? alphaAvg : 0;

    const origR = origRaw[i * channels];
    const origG = origRaw[i * channels + 1];
    const origB = origRaw[i * channels + 2];

    out[i * 3]     = Math.round(origR * (1 - alpha) + CYAN_R * alpha);
    out[i * 3 + 1] = Math.round(origG * (1 - alpha) + CYAN_G * alpha);
    out[i * 3 + 2] = Math.round(origB * (1 - alpha) + CYAN_B * alpha);
  }

  return sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
