#!/usr/bin/env node
import dotenv from "dotenv";
import sharp from "sharp";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";

import { designWorld } from "../../../orchestrator/src/world-designer.mjs";
import { generateMap } from "./steps/step1-generate-map.mjs";
import { compressMap } from "./steps/step2-compress.mjs";
import { editImage } from "./models/gemini-flash-img.mjs";
import { loadPrompt } from "./utils/prompt-loader.mjs";
import { drawBoundingBoxes, getImageSize } from "./utils/image-utils.mjs";
import { initLogger, log } from "./utils/logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
dotenv.config({ path: join(ROOT, ".env") });

const OUTPUT_ROOT =
  process.env.REGION_OVERLAY_DEMO_OUTPUT_DIR ||
  join(ROOT, "output/region-overlay-demos");
const IMAGE_EDIT_TIMEOUT_MS = parseInt(
  process.env.REGION_OVERLAY_DEMO_TIMEOUT_MS || "240000",
  10,
);
const MAX_BATCH_SIZE = 4;
const COLOR_SPECS = [
  {
    key: "cyan",
    label: "亮青色",
    rgb: [0, 255, 255],
    rgba: "rgba(0,255,255,0.62)",
  },
  {
    key: "magenta",
    label: "亮品红",
    rgb: [255, 0, 255],
    rgba: "rgba(255,0,255,0.62)",
  },
  {
    key: "yellow",
    label: "亮黄色",
    rgb: [255, 255, 0],
    rgba: "rgba(255,255,0,0.62)",
  },
  {
    key: "blue",
    label: "电蓝色",
    rgb: [0, 128, 255],
    rgba: "rgba(0,128,255,0.62)",
  },
];
const BOX_STYLE = {
  lineWidth: 6,
  fontSize: 18,
  labelTextColor: "#ffffff",
  labelBgColor: "rgba(255,0,255,0.95)",
};

main().catch((error) => {
  console.error("\n✗ Region overlay demo failed:", error);
  process.exit(1);
});

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const userPrompt = args.join(" ").trim();
  const runId = `demo_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const runDir = join(OUTPUT_ROOT, runId);
  mkdirSync(runDir, { recursive: true });
  initLogger(runDir);

  const metadata = {
    runId,
    userPrompt,
    startedAt: new Date().toISOString(),
    steps: {},
  };
  const warnings = [];
  const save = (filename, data) => {
    const path = join(runDir, filename);
    if (Buffer.isBuffer(data)) {
      writeFileSync(path, data);
    } else {
      writeFileSync(
        path,
        typeof data === "string" ? data : JSON.stringify(data, null, 2),
      );
    }
    return path;
  };

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║      Region Overlay Demo (Ark + Nano Banana)     ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`Run ID: ${runId}`);
  console.log(`Output: ${runDir}`);
  console.log(`Pipeline log: ${join(runDir, "pipeline.log")}`);
  console.log(`Prompt: ${userPrompt}\n`);
  log("Demo", "start", { runId, userPrompt });

  console.log("━━━ Demo Step 1: Design world / derive regions with Ark ━━━");
  const worldDesign = await designWorld(userPrompt);
  const allRegions = (worldDesign.regions || []).slice(0, 8);
  if (allRegions.length === 0) {
    throw new Error("Ark world design returned no regions for this prompt");
  }
  save("01-world-design.json", worldDesign);
  metadata.steps.design = {
    worldName: worldDesign.worldName,
    sceneType: worldDesign.sceneType,
    regionCount: allRegions.length,
    regionIds: allRegions.map((region) => region.id),
  };
  console.log(
    `[Demo] World designed: ${worldDesign.worldName} | sceneType=${worldDesign.sceneType} | regions=${allRegions.length}`,
  );
  console.log("[Demo] Regions:");
  allRegions.forEach((region, index) => {
    console.log(
      `  ${index + 1}. ${region.id} | ${region.type}${region.enterable ? " / enterable" : ""} | placement=${region.placementHint || "n/a"} | visual=${region.visualDescription || "n/a"}`,
    );
  });

  console.log("━━━ Demo Step 2: Generate map with Step 1 pipeline ━━━");
  const mapResult = await generateMap(worldDesign.mapDescription, worldDesign, save);
  const originalMap = mapResult.buffer;
  save("02-original-map.png", originalMap);
  metadata.steps.map = {
    reviewPassed: mapResult.reviewPassed,
    attempts: mapResult.attempts,
    bytes: originalMap.length,
  };
  if (!mapResult.reviewPassed) {
    warnings.push("Map generation review did not fully pass");
  }
  const originalSize = await getImageSize(originalMap);
  console.log(
    `[Demo] Map ready: ${originalSize.width}x${originalSize.height}, ${Math.round(originalMap.length / 1024)}KB, reviewPassed=${mapResult.reviewPassed}, attempts=${mapResult.attempts}`,
  );

  console.log("━━━ Demo Step 3: Compress map for image-editing overlay ━━━");
  const {
    compressedMap,
    width,
    height,
    originalBytes,
    compressedBytes,
    strategy,
  } = await compressMap(originalMap);
  save("03-compressed-map.png", compressedMap);
  metadata.steps.compress = {
    width,
    height,
    originalBytes,
    compressedBytes,
    strategy,
  };
  console.log(
    `[Demo] Compressed map: ${width}x${height}, ${Math.round(originalBytes / 1024)}KB -> ${Math.round(compressedBytes / 1024)}KB via ${strategy}`,
  );

  console.log("━━━ Demo Step 4: Overlay functional regions with Nano Banana ━━━");
  const batches = chunkRegions(allRegions, MAX_BATCH_SIZE);
  save(
    "04-region-batches.json",
    batches.map((batch, index) => ({
      batchIndex: index + 1,
      regionIds: batch.map((region) => region.id),
    })),
  );
  console.log(
    `[Demo] Overlay plan: ${allRegions.length} regions -> ${batches.length} batch(es), max ${MAX_BATCH_SIZE} per batch`,
  );
  batches.forEach((batch, index) => {
    console.log(
      `  Batch ${index + 1}: ${batch.map((region) => region.id).join(", ")}`,
    );
  });

  const batchResults = await Promise.all(
    batches.map((regions, batchIndex) =>
      processBatch({
        batchIndex: batchIndex + 1,
        regions,
        userPrompt,
        mapDescription: worldDesign.mapDescription,
        compressedMap,
        save,
      }),
    ),
  );

  const detectedRegions = batchResults.flatMap((result) => result.detectedRegions);
  save("05-detected-regions.json", detectedRegions);
  metadata.steps.overlay = {
    batchCount: batches.length,
    batches: batchResults.map((result) => ({
      batchIndex: result.batchIndex,
      regionIds: result.regions.map((region) => region.id),
      detectedIds: result.detectedRegions.map((region) => region.id),
    })),
  };
  console.log(
    `[Demo] Overlay extraction summary: detected ${detectedRegions.length}/${allRegions.length} region boxes`,
  );

  const missingRegionIds = allRegions
    .map((region) => region.id)
    .filter((id) => !detectedRegions.some((region) => region.id === id));
  if (missingRegionIds.length > 0) {
    warnings.push(
      `Some regions were not detected from overlays: ${missingRegionIds.join(", ")}`,
    );
  }

  console.log("━━━ Demo Step 5: Draw extracted rectangles for visual review ━━━");
  const boxes = detectedRegions.map((region) => ({
    x: region.topLeft.x,
    y: region.topLeft.y,
    w: region.bottomRight.x - region.topLeft.x,
    h: region.bottomRight.y - region.topLeft.y,
    color: "rgba(255,0,255,0.95)",
    label: region.id,
  }));
  const annotated = await drawBoundingBoxes(compressedMap, boxes, BOX_STYLE);
  save("06-regions-annotated.png", annotated);

  metadata.steps.final = {
    extractedRegionCount: detectedRegions.length,
    warnings,
  };
  metadata.completedAt = new Date().toISOString();
  metadata.warnings = warnings;
  save("metadata.json", metadata);

  console.log("\n═══════════════════════════════════════════");
  console.log("✓ Demo complete");
  console.log(`  Regions requested: ${allRegions.length}`);
  console.log(`  Regions detected:  ${detectedRegions.length}`);
  console.log(`  Output dir:        ${runDir}`);
  console.log("  Key files:");
  console.log("    - 01-world-design.json");
  console.log("    - 02-original-map.png");
  console.log("    - 03-compressed-map.png");
  console.log("    - 04-region-batches.json");
  console.log("    - 05-detected-regions.json");
  console.log("    - 06-regions-annotated.png");
  if (warnings.length > 0) {
    console.log("\n  Warnings:");
    warnings.forEach((warning) => console.log(`    - ${warning}`));
  }
  console.log("═══════════════════════════════════════════\n");
}

function printUsage() {
  console.log(`Usage:
  npm run demo:region-overlay -- "一个星露谷物语风格的小镇，有菜地、杂货店和铁匠铺"

What this demo does:
  1. Use Ark to design the world and derive candidate regions
  2. Reuse Step 1 map generation to make the map
  3. Compress the map for downstream image editing
  4. Use Nano Banana to overlay up to 4 regions per batch with distinct colors
  5. Extract rectangle boxes from image diffs
  6. Draw all extracted boxes onto the map for manual review
`);
}

async function processBatch({
  batchIndex,
  regions,
  userPrompt,
  mapDescription,
  compressedMap,
  save,
}) {
  const colorAssignments = regions.map((region, index) => ({
    region,
    color: COLOR_SPECS[index],
  }));
  const regionList = colorAssignments
    .map(({ region }, index) =>
      [
        `${index + 1}. ${region.name} (${region.id})`,
        `   - 类型：${region.type}${region.enterable ? " / 可进入" : ""}`,
        `   - 位置提示：${region.placementHint || "未指定"}`,
        `   - 外观提示：${region.visualDescription || region.description || "未指定"}`,
        `   - 说明：${region.description || "无"}`,
      ].join("\n"),
    )
    .join("\n");
  const colorLegend = colorAssignments
    .map(
      ({ region, color }) =>
        `- ${region.id}: 使用 ${color.label}，色值 ${color.rgba}，对应 RGB(${color.rgb.join(", ")})`,
    )
    .join("\n");

  const prompt = loadPrompt("demo-region-overlay-generation.md", {
    userPrompt,
    mapDescription,
    regionList,
    colorLegend,
  });

  console.log(
    `[Demo] Batch ${batchIndex}: marking ${regions.length} regions with Nano Banana...`,
  );
  console.log(`[Demo] Batch ${batchIndex} assignments:`);
  colorAssignments.forEach(({ region, color }) => {
    console.log(
      `  - ${region.id} -> ${color.label} RGB(${color.rgb.join(", ")}) | placement=${region.placementHint || "n/a"}`,
    );
  });
  const markedBuffer = await editImage(prompt, compressedMap, {
    imageSize: "1K",
    logStep: `Demo region overlay batch ${batchIndex}`,
    requestTimeoutMs: IMAGE_EDIT_TIMEOUT_MS,
  });
  save(`04-region-batch-${batchIndex}.png`, markedBuffer);
  console.log(
    `[Demo] Batch ${batchIndex}: marked image saved to 04-region-batch-${batchIndex}.png (${Math.round(markedBuffer.length / 1024)}KB)`,
  );

  const detectedRegions = await extractRegionBoxesFromMarkedImage(
    compressedMap,
    markedBuffer,
    colorAssignments,
  );
  save(`05-region-batch-${batchIndex}-detected.json`, detectedRegions);
  if (detectedRegions.length === 0) {
    console.log(`[Demo] Batch ${batchIndex}: no regions detected from overlay diff`);
  } else {
    console.log(`[Demo] Batch ${batchIndex}: detected boxes`);
    detectedRegions.forEach((region) => {
      console.log(
        `  - ${region.id}: (${region.topLeft.x},${region.topLeft.y}) -> (${region.bottomRight.x},${region.bottomRight.y})`,
      );
    });
  }
  log(
    "Demo",
    `batch ${batchIndex} detection`,
    detectedRegions.map((region) => ({
      id: region.id,
      topLeft: region.topLeft,
      bottomRight: region.bottomRight,
    })),
  );

  return {
    batchIndex,
    regions,
    markedBuffer,
    detectedRegions,
  };
}

async function extractRegionBoxesFromMarkedImage(
  originalBuffer,
  markedBuffer,
  colorAssignments,
) {
  const { width, height } = await getImageSize(markedBuffer);
  const blockSize = width <= 1500 ? 4 : width <= 3000 ? 6 : 8;
  const gridWidth = Math.floor(width / blockSize);
  const gridHeight = Math.floor(height / blockSize);

  const originalRaw = await sharp(originalBuffer)
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const markedRaw = await sharp(markedBuffer)
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const channels = Math.round(originalRaw.length / (width * height));
  const labelGrid = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(-1),
  );

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const avgOriginal = [0, 0, 0];
      const avgMarked = [0, 0, 0];
      let count = 0;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = gx * blockSize + dx;
          const py = gy * blockSize + dy;
          const idx = (py * width + px) * channels;

          avgOriginal[0] += originalRaw[idx];
          avgOriginal[1] += originalRaw[idx + 1];
          avgOriginal[2] += originalRaw[idx + 2];
          avgMarked[0] += markedRaw[idx];
          avgMarked[1] += markedRaw[idx + 1];
          avgMarked[2] += markedRaw[idx + 2];
          count++;
        }
      }

      for (let i = 0; i < 3; i++) {
        avgOriginal[i] /= count;
        avgMarked[i] /= count;
      }

      const diff = [
        avgMarked[0] - avgOriginal[0],
        avgMarked[1] - avgOriginal[1],
        avgMarked[2] - avgOriginal[2],
      ];
      const diffMagnitude = magnitude(diff);
      if (diffMagnitude < 12) continue;

      let bestIndex = -1;
      let bestScore = 0;
      for (let index = 0; index < colorAssignments.length; index++) {
        const target = colorAssignments[index].color.rgb;
        const score = scoreColorOverlay(avgOriginal, avgMarked, diff, target);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }

      if (bestIndex !== -1 && bestScore >= 12) {
        labelGrid[gy][gx] = bestIndex;
      }
    }
  }

  return colorAssignments
    .map(({ region }, index) => {
      const bbox = extractBoundingBoxFromLabelGrid(
        labelGrid,
        index,
        blockSize,
        width,
        height,
      );
      if (!bbox) return null;
      return {
        id: region.id,
        name: region.name,
        type: region.type,
        topLeft: bbox.topLeft,
        bottomRight: bbox.bottomRight,
      };
    })
    .filter(Boolean);
}

function scoreColorOverlay(avgOriginal, avgMarked, diff, target) {
  const towardTarget = [
    target[0] - avgOriginal[0],
    target[1] - avgOriginal[1],
    target[2] - avgOriginal[2],
  ];
  const towardMagnitudeSquared = dot(towardTarget, towardTarget);
  if (towardMagnitudeSquared <= 1) return 0;

  const alpha = dot(diff, towardTarget) / towardMagnitudeSquared;
  if (alpha < 0.08 || alpha > 1.2) return 0;

  const reconstructed = [
    towardTarget[0] * alpha,
    towardTarget[1] * alpha,
    towardTarget[2] * alpha,
  ];
  const reconstructionError = magnitude([
    diff[0] - reconstructed[0],
    diff[1] - reconstructed[1],
    diff[2] - reconstructed[2],
  ]);
  if (reconstructionError > 26) return 0;

  const originalDistance = colorDistance(avgOriginal, target);
  const markedDistance = colorDistance(avgMarked, target);
  const closenessGain = originalDistance - markedDistance;
  if (closenessGain < 5 && alpha < 0.2) return 0;

  return alpha * 90 + closenessGain * 0.25 - reconstructionError * 0.6;
}

function extractBoundingBoxFromLabelGrid(
  labelGrid,
  labelIndex,
  blockSize,
  width,
  height,
) {
  const gridHeight = labelGrid.length;
  const gridWidth = labelGrid[0]?.length || 0;
  const visited = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(false),
  );
  const components = [];

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (visited[y][x] || labelGrid[y][x] !== labelIndex) continue;
      const component = floodFill(labelGrid, visited, x, y, labelIndex);
      if (component.area >= 4) {
        components.push(component);
      }
    }
  }

  if (components.length === 0) return null;

  const largestArea = Math.max(...components.map((component) => component.area));
  const selected = components.filter(
    (component) => component.area >= Math.max(4, largestArea * 0.15),
  );

  const union = selected.reduce(
    (acc, comp) => ({
      minX: Math.min(acc.minX, comp.minX),
      minY: Math.min(acc.minY, comp.minY),
      maxX: Math.max(acc.maxX, comp.maxX),
      maxY: Math.max(acc.maxY, comp.maxY),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );

  if (!Number.isFinite(union.minX)) return null;

  let { minX, minY, maxX, maxY } = union;

  const TRIM_THRESHOLD = 0.35;

  const rowCoverage = (y) => {
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      if (labelGrid[y][x] === labelIndex) count++;
    }
    return count / Math.max(1, maxX - minX + 1);
  };
  const colCoverage = (x) => {
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      if (labelGrid[y][x] === labelIndex) count++;
    }
    return count / Math.max(1, maxY - minY + 1);
  };

  while (minY <= maxY && rowCoverage(minY) < TRIM_THRESHOLD) minY++;
  while (maxY >= minY && rowCoverage(maxY) < TRIM_THRESHOLD) maxY--;
  while (minX <= maxX && colCoverage(minX) < TRIM_THRESHOLD) minX++;
  while (maxX >= minX && colCoverage(maxX) < TRIM_THRESHOLD) maxX--;

  if (minX > maxX || minY > maxY) return null;

  const rawX1 = minX * blockSize;
  const rawY1 = minY * blockSize;
  const rawX2 = (maxX + 1) * blockSize;
  const rawY2 = (maxY + 1) * blockSize;

  const INSET_RATIO = 0.03;
  const centerX = (rawX1 + rawX2) / 2;
  const centerY = (rawY1 + rawY2) / 2;
  const halfW = (rawX2 - rawX1) / 2 * (1 - INSET_RATIO);
  const halfH = (rawY2 - rawY1) / 2 * (1 - INSET_RATIO);

  return {
    topLeft: {
      x: Math.max(0, Math.round(centerX - halfW)),
      y: Math.max(0, Math.round(centerY - halfH)),
    },
    bottomRight: {
      x: Math.min(width, Math.round(centerX + halfW)),
      y: Math.min(height, Math.round(centerY + halfH)),
    },
  };
}

function floodFill(labelGrid, visited, startX, startY, labelIndex) {
  const stack = [[startX, startY]];
  visited[startY][startX] = true;
  let area = 0;
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    area++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (
        ny < 0 ||
        ny >= labelGrid.length ||
        nx < 0 ||
        nx >= labelGrid[0].length ||
        visited[ny][nx] ||
        labelGrid[ny][nx] !== labelIndex
      ) {
        continue;
      }
      visited[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  return { area, minX, minY, maxX, maxY };
}

function chunkRegions(regions, size) {
  const chunks = [];
  for (let i = 0; i < regions.length; i += size) {
    chunks.push(regions.slice(i, i + size));
  }
  return chunks;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
