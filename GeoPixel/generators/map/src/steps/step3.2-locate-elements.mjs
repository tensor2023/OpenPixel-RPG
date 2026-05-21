import { normalizeWorldDesign } from "../../../../orchestrator/src/world-design-utils.mjs";
import { geminiProVision } from "../models/gemini-pro.mjs";
import { editImage } from "../models/gemini-flash-img.mjs";
import { loadPrompt } from "../utils/prompt-loader.mjs";
import { buildOverlayWorkingImage, drawBoundingBoxes, getImageSize } from "../utils/image-utils.mjs";
import {
  COLOR_SPECS,
  MAX_BATCH_SIZE,
  chunkArray,
  extractRegionBoxesFromMarkedImage,
} from "../utils/overlay-extraction.mjs";

const ELEMENT_COLOR = "rgba(0,200,200,0.95)";
const ELEMENT_BOX_STYLE = {
  lineWidth: 4,
  fontSize: 16,
  labelTextColor: "#ffffff",
  labelBgColor: "rgba(0,200,200,0.95)",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function prepareInteractiveElements(worldDesign) {
  console.log("[Step 3.2] Preparing interactive elements...");
  const normalized = normalizeWorldDesign(worldDesign);
  const elements = (normalized.interactiveElements || []).map((el) => ({
    id: el.id,
    name: el.name,
    description: el.description,
    visualDescription: el.visualDescription,
    placementHint: el.placementHint,
    interactions: el.interactions || [],
  }));

  console.log(`[Step 3.2] Found ${elements.length} interactive element(s).`);
  for (const el of elements) {
    console.log(
      `[Step 3.2]   Element: ${el.id} (${el.name}) — ${el.interactions?.length || 0} interactions`,
    );
  }

  return elements;
}

function buildElementBoxes(elements) {
  return elements
    .filter((e) => e.topLeft && e.bottomRight)
    .map((e) => ({
      x: e.topLeft.x,
      y: e.topLeft.y,
      w: e.bottomRight.x - e.topLeft.x,
      h: e.bottomRight.y - e.topLeft.y,
      color: ELEMENT_COLOR,
      label: e.id,
    }));
}

// ─── Nano Banana batch overlay ──────────────────────────────────────────────

async function processBatch({ batchIndex, elements, userPrompt, mapDescription, compressedMap, overlayInputMap, save, additionalConstraints }) {
  const IMAGE_EDIT_TIMEOUT_MS = parseInt(
    process.env.STEP3_2_OVERLAY_TIMEOUT_MS || process.env.STEP3_OVERLAY_TIMEOUT_MS || "240000", 10,
  );

  const colorAssignments = elements.map((element, index) => ({
    region: element,
    color: COLOR_SPECS[index],
  }));

  const elementList = colorAssignments
    .map(({ region: element }, index) =>
      [
        `${index + 1}. ${element.name} (${element.id})`,
        `   - 位置提示：${element.placementHint || "未指定"}`,
        `   - 外观提示：${element.visualDescription || element.description || "未指定"}`,
        `   - 说明：${element.description || "无"}`,
      ].join("\n"),
    )
    .join("\n");

  const colorLegend = colorAssignments
    .map(
      ({ region: element, color }) =>
        `- ${element.id}: 使用 ${color.label}，色值 ${color.rgba}，对应 RGB(${color.rgb.join(", ")})`,
    )
    .join("\n");

  const prompt = loadPrompt("step3.2-overlay-generation.md", {
    userPrompt,
    mapDescription,
    elementList,
    colorLegend,
    additionalConstraints: additionalConstraints || "",
  });

  console.log(`[Step 3.2] Batch ${batchIndex}: marking ${elements.length} element(s) with Nano Banana...`);
  colorAssignments.forEach(({ region: element, color }) => {
    console.log(
      `[Step 3.2]   ${element.id} -> ${color.label} RGB(${color.rgb.join(", ")})`,
    );
  });

  const markedBuffer = await editImage(prompt, overlayInputMap, {
    imageSize: "1K",
    logStep: `Step 3.2 overlay batch ${batchIndex}`,
    requestTimeoutMs: IMAGE_EDIT_TIMEOUT_MS,
  });
  save(`03.2-overlay-batch-${batchIndex}.png`, markedBuffer);
  console.log(
    `[Step 3.2] Batch ${batchIndex}: overlay saved (${Math.round(markedBuffer.length / 1024)}KB)`,
  );

  const detectedElements = await extractRegionBoxesFromMarkedImage(
    compressedMap,
    markedBuffer,
    colorAssignments,
  );

  if (detectedElements.length === 0) {
    console.log(`[Step 3.2] Batch ${batchIndex}: no elements detected from overlay diff`);
  } else {
    console.log(`[Step 3.2] Batch ${batchIndex}: detected ${detectedElements.length} element(s)`);
    detectedElements.forEach((el) => {
      console.log(
        `[Step 3.2]   ${el.id}: (${el.topLeft.x},${el.topLeft.y}) -> (${el.bottomRight.x},${el.bottomRight.y})`,
      );
    });
  }

  return { batchIndex, detectedElements };
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Locate interactive elements on the map using Nano Banana color overlays + image diff,
 * then run a single Gemini Pro confirmation pass to drop clearly wrong elements.
 * @param {Buffer} compressedBuffer - compressed map PNG
 * @param {object} worldDesign
 * @param {string} userPrompt
 * @param {(name: string, data: any) => void} save
 * @returns {{ elements: object[], annotatedImage: Buffer, reviewPassed: boolean, attempts: number, droppedElementIds: string[] }}
 */
export async function locateElements(compressedBuffer, worldDesign, userPrompt, save) {
  const preparedElements = prepareInteractiveElements(worldDesign);
  if (preparedElements.length === 0) {
    console.log("[Step 3.2] No interactive elements for this world; skipping localization.");
    return {
      elements: [],
      annotatedImage: compressedBuffer,
      reviewPassed: true,
      attempts: 0,
      droppedElementIds: [],
    };
  }

  const elements = JSON.parse(JSON.stringify(preparedElements));
  const mapDescription = worldDesign.mapDescription || userPrompt;

  const MAX_RETRIES = parseInt(
    process.env.STEP3_2_MAX_RETRIES || process.env.STEP3_MAX_RETRIES || "2", 10,
  );
  const TOTAL_ATTEMPTS = Math.max(1, MAX_RETRIES + 1);
  const CONFIRM_TIMEOUT_MS = parseInt(
    process.env.STEP3_2_CONFIRM_TIMEOUT_MS || process.env.STEP3_CONFIRM_TIMEOUT_MS || "90000", 10,
  );
  const { width: imageWidth, height: imageHeight } = await getImageSize(compressedBuffer);
  const overlayWorkingImage = await buildOverlayWorkingImage(compressedBuffer);
  if (overlayWorkingImage.resized) {
    console.log(
      `[Step 3.2] Using resized overlay working image ${overlayWorkingImage.width}x${overlayWorkingImage.height} (source ${imageWidth}x${imageHeight})`,
    );
  }

  let reviewPassed = false;
  let attemptsUsed = 0;
  let lastProblematicIds = [];
  let additionalConstraints = "";

  for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt++) {
    const pendingElements = elements.filter((e) => !e.topLeft || !e.bottomRight);
    if (pendingElements.length === 0) break;

    attemptsUsed = attempt;
    console.log(
      `[Step 3.2] Attempt ${attempt}/${TOTAL_ATTEMPTS}: locating ${pendingElements.length} element(s) via color overlay...`,
    );

    // ── Phase A: Batch overlay via Nano Banana (only for pending elements) ──
    const batches = chunkArray(pendingElements, MAX_BATCH_SIZE);
    console.log(`[Step 3.2] Split into ${batches.length} batch(es), max ${MAX_BATCH_SIZE} per batch`);

    const attemptSave = attempt === 1
      ? save
      : (name, data) => save(name.replace(/\.png$/, `-a${attempt}.png`), data);

    const batchResults = await Promise.all(
      batches.map((batchElements, idx) =>
        processBatch({
          batchIndex: idx + 1,
          elements: batchElements,
          userPrompt,
          mapDescription,
          compressedMap: compressedBuffer,
          overlayInputMap: overlayWorkingImage.buffer,
          save: attemptSave,
          additionalConstraints,
        }),
      ),
    );

    const detectedElements = batchResults.flatMap((r) => r.detectedElements);
    const detectedMap = new Map(detectedElements.map((d) => [d.id, d]));

    for (const element of elements) {
      if ((!element.topLeft || !element.bottomRight) && detectedMap.has(element.id)) {
        const d = detectedMap.get(element.id);
        element.topLeft = d.topLeft;
        element.bottomRight = d.bottomRight;
      }
    }

    const locatedElements = elements.filter((e) => e.topLeft && e.bottomRight);
    const stillMissingIds = elements
      .filter((e) => !e.topLeft || !e.bottomRight)
      .map((e) => e.id);

    if (stillMissingIds.length > 0) {
      console.warn(
        `[Step 3.2] Attempt ${attempt}: elements not detected from overlays: ${stillMissingIds.join(", ")}`,
      );
    }
    console.log(
      `[Step 3.2] Attempt ${attempt}: overlay extraction total ${locatedElements.length}/${elements.length} located`,
    );

    if (locatedElements.length === 0) {
      console.error(`[Step 3.2] Attempt ${attempt}: no elements detected from any overlay batch.`);
      lastProblematicIds = [];
      continue;
    }

    // ── Phase B: Draw annotated image for confirmation ──
    const boxes = buildElementBoxes(locatedElements);
    const annotatedImage = await drawBoundingBoxes(compressedBuffer, boxes, ELEMENT_BOX_STYLE);
    save(`03.2-elements-attempt-${attempt}.png`, annotatedImage);

    // ── Phase C: Gemini Pro confirmation pass ──
    const elementsList = locatedElements
      .map((e) => {
        const lines = [`- ${e.id}: ${e.name} (${e.topLeft.x},${e.topLeft.y})→(${e.bottomRight.x},${e.bottomRight.y})`];
        if (e.visualDescription) lines.push(`  外观：${e.visualDescription}`);
        if (e.placementHint) lines.push(`  位置提示：${e.placementHint}`);
        return lines.join("\n");
      })
      .join("\n");

    const confirmPrompt = loadPrompt("step3.2-confirm-elements.md", {
      elementsList,
      imageWidth,
      imageHeight,
      userPrompt,
    });

    let confirmResult;
    try {
      console.log(`[Step 3.2] Attempt ${attempt}: running confirmation pass with Gemini Pro...`);
      const raw = await geminiProVision(confirmPrompt, [compressedBuffer, annotatedImage], {
        logStep: `Step 3.2 confirm attempt ${attempt}`,
        requestTimeoutMs: CONFIRM_TIMEOUT_MS,
      });
      const match = raw.match(/\{[\s\S]*\}/);
      confirmResult = match ? JSON.parse(match[0]) : { pass: true, problematic_element_ids: [] };
    } catch (e) {
      console.warn(
        `[Step 3.2] Attempt ${attempt}: confirmation call failed (keeping all detected elements): ${e.message}`,
      );
      confirmResult = { pass: true, problematic_element_ids: [] };
    }

    const problematicIds = confirmResult.problematic_element_ids || [];
    lastProblematicIds = problematicIds;

    if (confirmResult.pass) {
      console.log(`[Step 3.2] Attempt ${attempt}: confirmation passed — all detected elements accepted.`);
      reviewPassed = true;
      break;
    }

    console.log(
      `[Step 3.2] Attempt ${attempt}: flagged ${problematicIds.length} problematic element(s): ${problematicIds.join(", ")}`,
    );

    // Accumulate review feedback as constraints for next overlay attempt
    const feedback = confirmResult.feedback || {};
    const feedbackLines = problematicIds
      .filter((id) => feedback[id])
      .map((id) => `- ${id}：${feedback[id]}`);
    if (feedbackLines.length > 0) {
      additionalConstraints +=
        `\n## 上一次标注审查反馈（请特别注意）\n以下元素上次标注有误，请修正：\n${feedbackLines.join("\n")}\n`;
      console.log(`[Step 3.2] Accumulated constraints for next attempt: ${feedbackLines.join("; ")}`);
    }

    // Clear problematic boxes.
    // On retry: they become pending again and will be re-detected next attempt.
    // On the final attempt: they stay cleared and are dropped (existing behavior).
    if (problematicIds.length > 0) {
      for (const element of elements) {
        if (problematicIds.includes(element.id)) {
          element.topLeft = undefined;
          element.bottomRight = undefined;
        }
      }
    }
  }

  const finalElements = elements.filter((e) => e.topLeft && e.bottomRight);
  const droppedElementIds = elements
    .filter((e) => !e.topLeft || !e.bottomRight)
    .map((e) => e.id);

  let finalAnnotatedImage = compressedBuffer;
  if (finalElements.length > 0) {
    const finalBoxes = buildElementBoxes(finalElements);
    finalAnnotatedImage = await drawBoundingBoxes(compressedBuffer, finalBoxes, ELEMENT_BOX_STYLE);
  }

  if (!reviewPassed && lastProblematicIds.length > 0) {
    console.log(
      `[Step 3.2] Retries exhausted; dropped ${lastProblematicIds.length} problematic element(s): ${lastProblematicIds.join(", ")}`,
    );
  }

  return {
    elements: finalElements,
    annotatedImage: finalAnnotatedImage,
    reviewPassed,
    attempts: attemptsUsed,
    droppedElementIds,
  };
}

/**
 * Scale element coordinates from compressed to original resolution.
 */
export function scaleElements(elements, origWidth, compressedWidth) {
  const ratio = origWidth / compressedWidth;
  return elements
    .filter((e) => e.topLeft && e.bottomRight)
    .map((e) => ({
      ...e,
      topLeft: {
        x: Math.round(e.topLeft.x * ratio),
        y: Math.round(e.topLeft.y * ratio),
      },
      bottomRight: {
        x: Math.round(e.bottomRight.x * ratio),
        y: Math.round(e.bottomRight.y * ratio),
      },
    }));
}
