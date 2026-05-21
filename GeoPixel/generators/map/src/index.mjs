import dotenv from "dotenv";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { generateMap } from "./steps/step1-generate-map.mjs";
import { compressMap } from "./steps/step2-compress.mjs";
import { resolveDesignedRegions, scaleRegions } from "./steps/step3-resolve-designed-regions.mjs";
import { locateElements, scaleElements } from "./steps/step3.2-locate-elements.mjs";
import { generateWalkableMap } from "./steps/step4-walkable-areas.mjs";
import { computeGrid } from "./steps/step5-compute-grid.mjs";
import { buildOutput } from "./steps/step6-build-output.mjs";
import { getImageSize } from "./utils/image-utils.mjs";
import { initLogger, log } from "./utils/logger.mjs";
import { getMapImageSizeLabel } from "./utils/generation-config.mjs";
import { normalizeWorldDesign } from "../../../orchestrator/src/world-design-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLD_SEED_ROOT = join(__dirname, "../../..");
dotenv.config({ path: join(WORLD_SEED_ROOT, ".env") });
const OUTPUT_DIR = process.env.MAP_OUTPUT_DIR || join(WORLD_SEED_ROOT, "output/maps");
const MAP_IMAGE_SIZE = getMapImageSizeLabel();

installPhaseStepLogPrefix("Phase 2");

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");
  if (!userPrompt) {
    console.error("Usage: node src/index.mjs \"地图描述\"");
    process.exit(1);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(OUTPUT_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  const logDir = process.env.MAP_LOG_DIR || runDir;
  mkdirSync(logDir, { recursive: true });

  initLogger(logDir, process.env.MAP_LOG_FILE_NAME || "map-pipeline.log");
  log(
    "Pipeline",
    "start",
    `userPrompt: ${userPrompt}\nrunId: ${runId}\nmapImageSize: ${MAP_IMAGE_SIZE}\noutputDir: ${runDir}\nlogDir: ${logDir}`,
  );

  const metadata = { runId, userPrompt, startedAt: new Date().toISOString(), steps: {} };
  const warnings = [];

  const save = (filename, data) => {
    const p = join(runDir, filename);
    if (Buffer.isBuffer(data)) writeFileSync(p, data);
    else writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2));
    return p;
  };

  const worldDesignPath = process.env.WORLD_DESIGN_PATH || "";
  const worldDesign = worldDesignPath && existsSync(worldDesignPath)
    ? normalizeWorldDesign(JSON.parse(readFileSync(worldDesignPath, "utf-8")))
    : normalizeWorldDesign({
        mapDescription: userPrompt,
        regions: [],
        worldActions: [],
        mapPlan: {},
      });

  const originalUserPrompt = process.env.ORIGINAL_USER_PROMPT || "";

  try {
    // ── Step 1: Generate Map ──
    console.log(`\n═══ Step 1: Generate ${MAP_IMAGE_SIZE} Map ═══`);
    const step1 = await generateMap(userPrompt, worldDesign, save, { originalUserPrompt });
    const originalMap = step1.buffer;
    save("01-original-map.png", originalMap);
    const origSize = await getImageSize(originalMap);
    metadata.steps.step1 = {
      imageSize: MAP_IMAGE_SIZE,
      width: origSize.width, height: origSize.height,
      bytes: originalMap.length, reviewPassed: step1.reviewPassed, attempts: step1.attempts,
    };
    if (!step1.reviewPassed) {
      warnings.push("Step 1: 地图生成 review 最终未通过");
    }

    // ── Step 2: Compress ──
    console.log("\n═══ Step 2: Compress Map ═══");
    const { compressedMap, width: compressedWidth, height: compressedHeight, originalBytes, compressedBytes, strategy } = await compressMap(originalMap);
    save("02-compressed-map.png", compressedMap);
    metadata.steps.step2 = {
      width: compressedWidth,
      height: compressedHeight,
      originalBytes,
      compressedBytes,
      savedBytes: originalBytes - compressedBytes,
      strategy,
    };

    // ── Step 3 (regions) + Step 3.2 (elements) + Step 4 (walkable): parallel ──
    console.log("\n═══ Step 3 + Step 3.2 + Step 4: Regions, Elements & Walkable Areas (parallel) ═══");
    const [regionResult, elementResult, step4] = await Promise.all([
      resolveDesignedRegions(compressedMap, worldDesign, userPrompt, save),
      locateElements(compressedMap, worldDesign, userPrompt, save),
      generateWalkableMap(compressedMap, userPrompt, worldDesign, save),
    ]);

    save("03-designed-regions.json", regionResult.preparedRegions);
    save("03-regions.json", regionResult.regions);
    save("03-regions-annotated.png", regionResult.annotatedImage);
    log("Step 3", "resolved designed regions", {
      preparedRegionCount: regionResult.preparedRegions.length,
      regionCount: regionResult.regions.length,
      regions: regionResult.regions.map((r) => r.id),
      droppedRegionIds: regionResult.droppedRegionIds || [],
      source: "world_design",
    });
    metadata.steps.step3 = {
      source: "world_design",
      preparedRegionCount: regionResult.preparedRegions.length,
      regionCount: regionResult.regions.length,
      reviewPassed: regionResult.reviewPassed,
      attempts: regionResult.attempts,
      droppedRegionIds: regionResult.droppedRegionIds || [],
    };
    if (!regionResult.reviewPassed) {
      warnings.push("Step 3: 预定义区域定位 review 最终未通过");
    }
    if (regionResult.droppedRegionIds?.length) {
      warnings.push(`Step 3: 已移除最终 review 未通过的区域: ${regionResult.droppedRegionIds.join(", ")}`);
    }

    save("03-elements.json", elementResult.elements);
    if (elementResult.annotatedImage && elementResult.elements.length > 0) {
      save("03.2-elements-annotated.png", elementResult.annotatedImage);
    }
    log("Step 3.2", "located interactive elements", {
      elementCount: elementResult.elements.length,
      elements: elementResult.elements.map((e) => e.id),
      droppedElementIds: elementResult.droppedElementIds || [],
    });
    metadata.steps.step3_2 = {
      elementCount: elementResult.elements.length,
      reviewPassed: elementResult.reviewPassed,
      attempts: elementResult.attempts,
      droppedElementIds: elementResult.droppedElementIds || [],
    };
    if (!elementResult.reviewPassed && elementResult.elements.length > 0) {
      warnings.push("Step 3.2: 可交互元素定位 review 最终未通过");
    }
    if (elementResult.droppedElementIds?.length) {
      warnings.push(`Step 3.2: 已移除最终 review 未通过的元素: ${elementResult.droppedElementIds.join(", ")}`);
    }
    const walkableMap = step4.buffer;
    save("04-walkable-marked.png", walkableMap);
    metadata.steps.step4 = {
      bytes: walkableMap.length,
      reviewPassed: step4.reviewPassed, attempts: step4.attempts,
    };
    if (!step4.reviewPassed) {
      warnings.push("Step 4: 可行走区域标注 review 最终未通过");
    }

    // ── Step 5: Compute Grid ──
    console.log("\n═══ Step 5: Compute Walkable Grid ═══");
    const { grid, gridWidth, gridHeight, tileSize } = await computeGrid(compressedMap, walkableMap, origSize.width);
    save("05-walkable-grid.json", { gridWidth, gridHeight, grid });

    console.log(`[Pipeline] Grid ${gridWidth}x${gridHeight}, tileSize=${tileSize}px, world=${gridWidth * tileSize}x${gridHeight * tileSize}px (source ${MAP_IMAGE_SIZE}: ${origSize.width}x${origSize.height})`);
    metadata.steps.step5 = { gridWidth, gridHeight, tileSize };

    // ── Step 6: Build Output ──
    console.log("\n═══ Step 6: Build Output ═══");

    const fromCompressedToWorld = (coord) => Math.round(coord * (origSize.width / compressedWidth));
    const toWorldCoords = (obj) => ({
      ...obj,
      topLeft: {
        x: fromCompressedToWorld(obj.topLeft.x),
        y: fromCompressedToWorld(obj.topLeft.y),
      },
      bottomRight: {
        x: fromCompressedToWorld(obj.bottomRight.x),
        y: fromCompressedToWorld(obj.bottomRight.y),
      },
    });

    const worldRegions = regionResult.regions
      .filter((r) => r.topLeft && r.bottomRight)
      .map(toWorldCoords);

    const worldElements = elementResult.elements
      .filter((e) => e.topLeft && e.bottomRight)
      .map(toWorldCoords);

    const scaledRegions = scaleRegions(regionResult.regions, origSize.width, compressedWidth);
    const scaledElements = scaleElements(elementResult.elements, origSize.width, compressedWidth);

    const sharp = (await import("sharp")).default;
    const bgWidth = gridWidth * tileSize;
    const bgHeight = gridHeight * tileSize;
    const bgBuffer = await sharp(originalMap)
      .resize(bgWidth, bgHeight, { fit: "fill" })
      .png()
      .toBuffer();
    save("06-background.png", bgBuffer);

    const tmj = buildOutput({
      grid,
      gridWidth,
      gridHeight,
      tileSize,
      regions: worldRegions,
      elements: worldElements,
      backgroundImage: "06-background.png",
    });
    save("06-final.tmj", tmj);

    save("06-regions-scaled.json", scaledRegions);
    save("06-elements-scaled.json", scaledElements);

    // Update runs list for viewer
    const runsFile = join(OUTPUT_DIR, "runs.json");
    let runs = [];
    if (existsSync(runsFile)) {
      try { runs = JSON.parse(readFileSync(runsFile, "utf-8")); } catch {}
    }
    if (!runs.includes(runId)) runs.push(runId);
    writeFileSync(runsFile, JSON.stringify(runs, null, 2));

    metadata.warnings = warnings;
    metadata.completedAt = new Date().toISOString();
    save("metadata.json", metadata);

    console.log("\n═══════════════════════════════════════════");
    console.log(`✓ Map generation complete!`);
    console.log(`  Run ID:     ${runId}`);
    console.log(`  Output dir: ${runDir}`);
    console.log(`  Grid:       ${gridWidth}x${gridHeight} (tile size: ${tileSize}px)`);
    console.log(`  Regions:    ${regionResult.regions.length}`);
    console.log(`  Elements:   ${elementResult.elements.length}`);
    if (warnings.length) {
      console.log(`\n⚠ Warnings:`);
      warnings.forEach((w) => console.log(`  - ${w}`));
    }
    console.log(`\nTo view: open viewer/index.html in a browser`);
    console.log(`  (serve with: cd ai-world-test && npm run viewer)`);
    console.log("═══════════════════════════════════════════\n");

  } catch (err) {
    console.error("\n✗ Pipeline failed:", err);
    metadata.error = err.message;
    metadata.warnings = warnings;
    save("metadata.json", metadata);
    process.exit(1);
  }
}

main();

function installPhaseStepLogPrefix(phaseLabel) {
  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args.map((arg) => prefixPhaseStep(arg, phaseLabel)));
    };
  }
}

function prefixPhaseStep(value, phaseLabel) {
  if (typeof value !== "string") return value;
  return value
    .replace(/═══ Step /g, `═══ ${phaseLabel} · Step `)
    .replace(/\[Step /g, `[${phaseLabel} · Step `);
}
