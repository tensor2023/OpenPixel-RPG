/**
 * Custom map pipeline entry point — skips AI map generation (Step 1).
 * Accepts a pre-generated pixel-art PNG and runs Steps 2-6 of the GeoPixel pipeline.
 *
 * Usage:
 *   node src/index-from-image.mjs --image /path/to/pixel_art.png [location description]
 *
 * Example:
 *   node src/index-from-image.mjs --image /tmp/tongji.png 同济大学校园
 */

import dotenv from "dotenv";
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
  const rawArgs = process.argv.slice(2);

  // Parse --image flag
  const imgIdx = rawArgs.indexOf("--image");
  if (imgIdx === -1 || !rawArgs[imgIdx + 1]) {
    console.error(
      "Usage: node src/index-from-image.mjs --image /path/to/pixel_art.png [location description]",
    );
    process.exit(1);
  }

  const imagePath = rawArgs[imgIdx + 1];
  if (!existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }

  // Remaining args = location/description
  const descriptionArgs = rawArgs.filter((_, i) => i !== imgIdx && i !== imgIdx + 1);
  const locationDescription = descriptionArgs.join(" ").trim() || "真实城市地图";

  // Augment prompt with road-width hint so Step 4 marks roads generously
  const userPrompt =
    `${locationDescription}。这是真实城市/校园的俯视像素地图，有真实道路网络、建筑群、绿地。` +
    `道路是主要可行走区域，请确保所有道路（包括主干道、支路、走廊）都被完整标注为可行走区域，` +
    `道路标注宽度要充足（不要遗漏细节，保证角色能够穿行）。`;

  const runId = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = join(OUTPUT_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const logDir = process.env.MAP_LOG_DIR || runDir;
  mkdirSync(logDir, { recursive: true });
  initLogger(logDir, process.env.MAP_LOG_FILE_NAME || "map-pipeline.log");

  log(
    "Pipeline",
    "start (from-image)",
    `imagePath: ${imagePath}\nuserPrompt: ${userPrompt}\nrunId: ${runId}\nmapImageSize: ${MAP_IMAGE_SIZE}\noutputDir: ${runDir}`,
  );

  const worldDesign = normalizeWorldDesign({
    mapDescription: userPrompt,
    artStylePrompt: "像素风格城市/校园地图，俯视45度视角，保留真实道路和建筑布局",
    regions: [],
    worldActions: [],
    mapPlan: {
      visual: "真实城市俯视像素地图",
      areas: ["道路", "建筑区", "绿地", "广场"],
    },
  });

  const metadata = {
    runId,
    userPrompt,
    imagePath,
    startedAt: new Date().toISOString(),
    steps: {},
    skippedStep1: true,
  };
  const warnings = [];

  const save = (filename, data) => {
    const p = join(runDir, filename);
    if (Buffer.isBuffer(data)) writeFileSync(p, data);
    else writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data, null, 2));
    return p;
  };

  try {
    // ── Skip Step 1: read pre-generated pixel art directly ──
    console.log(`\n═══ Step 1: Load pre-generated pixel art (skipping AI generation) ═══`);
    const originalMap = readFileSync(imagePath);
    save("01-original-map.png", originalMap);
    const origSize = await getImageSize(originalMap);
    console.log(`[Step 1] Loaded image: ${origSize.width}x${origSize.height} (${originalMap.length} bytes)`);
    metadata.steps.step1 = {
      source: "pre-generated",
      imagePath,
      imageSize: MAP_IMAGE_SIZE,
      width: origSize.width,
      height: origSize.height,
      bytes: originalMap.length,
    };

    // ── Step 2: Compress ──
    console.log("\n═══ Step 2: Compress Map ═══");
    const {
      compressedMap,
      width: compressedWidth,
      height: compressedHeight,
      originalBytes,
      compressedBytes,
      strategy,
    } = await compressMap(originalMap);
    save("02-compressed-map.png", compressedMap);
    metadata.steps.step2 = {
      width: compressedWidth,
      height: compressedHeight,
      originalBytes,
      compressedBytes,
      savedBytes: originalBytes - compressedBytes,
      strategy,
    };

    // ── Step 3 + 3.2 + 4: parallel ──
    console.log("\n═══ Step 3 + Step 3.2 + Step 4: Regions, Elements & Walkable Areas (parallel) ═══");

    // WALKABLE_IMAGE_PATH: skip AI step4 and use a pre-computed walkable image
    const precomputedWalkablePath = process.env.WALKABLE_IMAGE_PATH;
    const walkableStep4Promise = precomputedWalkablePath && existsSync(precomputedWalkablePath)
      ? (async () => {
          console.log(`[Step 4] Using pre-computed walkable image: ${precomputedWalkablePath}`);
          const buf = readFileSync(precomputedWalkablePath);
          return { buffer: buf, reviewPassed: true, attempts: 0 };
        })()
      : generateWalkableMap(compressedMap, userPrompt, worldDesign, save);

    const [regionResult, elementResult, step4] = await Promise.all([
      resolveDesignedRegions(compressedMap, worldDesign, userPrompt, save),
      locateElements(compressedMap, worldDesign, userPrompt, save),
      walkableStep4Promise,
    ]);

    save("03-designed-regions.json", regionResult.preparedRegions);
    save("03-regions.json", regionResult.regions);
    save("03-regions-annotated.png", regionResult.annotatedImage);
    log("Step 3", "resolved designed regions", {
      preparedRegionCount: regionResult.preparedRegions.length,
      regionCount: regionResult.regions.length,
      regions: regionResult.regions.map((r) => r.id),
      droppedRegionIds: regionResult.droppedRegionIds || [],
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
      reviewPassed: step4.reviewPassed,
      attempts: step4.attempts,
    };
    if (!step4.reviewPassed) {
      const fallbackNote = "Step 4: 可行走区域标注 review 最终未通过，已使用多帧均值融合 (fallback) 生成复合标注";
      console.warn(`\n⚠ ${fallbackNote}\n`);
      warnings.push(fallbackNote);
    }

    // ── Step 5: Compute Grid ──
    console.log("\n═══ Step 5: Compute Walkable Grid ═══");
    const { grid, gridWidth, gridHeight, tileSize } = await computeGrid(
      compressedMap,
      walkableMap,
      origSize.width,
    );
    save("05-walkable-grid.json", { gridWidth, gridHeight, grid });
    console.log(
      `[Pipeline] Grid ${gridWidth}x${gridHeight}, tileSize=${tileSize}px, world=${gridWidth * tileSize}x${gridHeight * tileSize}px`,
    );
    metadata.steps.step5 = { gridWidth, gridHeight, tileSize };

    // ── Step 6: Build Output ──
    console.log("\n═══ Step 6: Build Output ═══");

    const fromCompressedToWorld = (coord) =>
      Math.round(coord * (origSize.width / compressedWidth));
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
      try {
        runs = JSON.parse(readFileSync(runsFile, "utf-8"));
      } catch {}
    }
    if (!runs.includes(runId)) runs.push(runId);
    writeFileSync(runsFile, JSON.stringify(runs, null, 2));

    metadata.warnings = warnings;
    metadata.completedAt = new Date().toISOString();
    save("metadata.json", metadata);

    // ── Detect locale from location description ──
    const detectLocale = (location) => {
      const loc = (location ?? "").toLowerCase();
      if (/日本|japan|tokyo|京都|osaka|kyoto/.test(loc)) return "ja-JP";
      if (/韩国|korea|seoul|busan/.test(loc)) return "ko-KR";
      if (/法国|france|paris|marseille|l[yi]on/.test(loc)) return "fr-FR";
      if (/德国|germany|berlin|munich|hamburg/.test(loc)) return "de-DE";
      if (/意大利|italy|rome|milan|venice|florence/.test(loc)) return "it-IT";
      if (/西班牙|spain|madrid|barcelona/.test(loc)) return "es-ES";
      if (/俄罗斯|russia|moscow/.test(loc)) return "ru-RU";
      if (/英国|uk|united kingdom|london|england|britain|new\s*york|nyc|纽约/.test(loc)) return "en-US";
      if (/泰国|thailand|bangkok/.test(loc)) return "th-TH";
      if (/印度|india|mumbai|delhi/.test(loc)) return "hi-IN";
      if (/中国|china|上海|北京|深圳|广州|杭州/.test(loc)) return "zh-CN";
      if (/台湾|taiwan|taipei/.test(loc)) return "zh-TW";
      return "en-US";
    };

    // ── Register as GeoPixel World ──
    const worldsDir = join(WORLD_SEED_ROOT, "output", "worlds");
    const worldDir = join(worldsDir, runId);
    mkdirSync(join(worldDir, "config"), { recursive: true });
    mkdirSync(join(worldDir, "config", "characters"), { recursive: true });
    mkdirSync(join(worldDir, "map"), { recursive: true });
    mkdirSync(join(worldDir, "characters"), { recursive: true });

    for (const f of [
      "03-designed-regions.json", "03-elements.json", "03-regions.json",
      "05-walkable-grid.json", "06-background.png", "06-elements-scaled.json",
      "06-final.tmj", "06-regions-scaled.json", "metadata.json",
    ]) {
      const src = join(runDir, f);
      if (existsSync(src)) copyFileSync(src, join(worldDir, "map", f));
    }

    // Copy appearance spritesheets into the world (so character sprites can render)
    const charSourceDir = join(WORLD_SEED_ROOT, "output", "characters");
    if (existsSync(charSourceDir)) {
      for (const appId of readdirSync(charSourceDir)) {
        const srcPng = join(charSourceDir, appId, "spritesheet.png");
        if (existsSync(srcPng)) {
          const dstDir = join(worldDir, "characters", appId);
          mkdirSync(dstDir, { recursive: true });
          copyFileSync(srcPng, join(dstDir, "spritesheet.png"));
        }
      }
    }

    // Ensure char_player/ spritesheet exists so BootScene can find it by
    // character id (not appearanceId). Copy from 小同 spritesheet if not present.
    const playerSpritesheetDir = join(worldDir, "characters", "char_player");
    const playerSpritesheetPath = join(playerSpritesheetDir, "spritesheet.png");
    if (!existsSync(playerSpritesheetPath)) {
      const tongPng = join(worldDir, "characters", "char_1779005204057", "spritesheet.png");
      if (existsSync(tongPng)) {
        mkdirSync(playerSpritesheetDir, { recursive: true });
        copyFileSync(tongPng, playerSpritesheetPath);
      }
    }

    const worldConfig = {
      worldName: locationDescription || "Real World Map",
      worldDescription: `Pixel art map: ${locationDescription}`,
      worldSocialContext: "A real-world location converted to a playable pixel art map.",
      contentLanguage: detectLocale(locationDescription),
      scene: {
        sceneType: "open",
        startTime: "09:00",
        tickDurationMinutes: 15,
        maxTicks: 96,
        description: `Pixel art map of ${locationDescription}`,
      },
      worldActions: [],
    };
    writeFileSync(join(worldDir, "config", "world.json"), JSON.stringify(worldConfig, null, 2));
    writeFileSync(join(worldDir, "characters", "characters.json"), "[]");

    const playerChar = {
      id: "char_player",
      name: "User",
      role: "玩家角色",
      personality: "活泼好奇，喜欢探索城市的每个角落。",
      appearanceHint: "黑发扎马尾，头戴红色棒球帽，穿蓝色背带裤，运动鞋。",
      motivation: "探索这座城市，发现有趣的人和故事。",
      socialStyle: "extrovert",
      backstory: `${locationDescription}的探索者，喜欢在街道间漫步。`,
      coreMotivation: "探索城市，结交朋友，发现隐藏的故事。",
    };
    writeFileSync(join(worldDir, "config", "characters", "char_player.json"), JSON.stringify(playerChar, null, 2));
    console.log(`[World] Registered world → ${worldDir}`);

    console.log("\n═══════════════════════════════════════════");
    console.log(`✓ Map generation complete! (from-image mode)`);
    console.log(`  Run ID:     ${runId}`);
    console.log(`  Output dir: ${runDir}`);
    console.log(`  Grid:       ${gridWidth}x${gridHeight} (tile size: ${tileSize}px)`);
    console.log(`  Regions:    ${regionResult.regions.length}`);
    console.log(`  Elements:   ${elementResult.elements.length}`);
    console.log(`  RUN_DIR:    ${runDir}`);
    if (warnings.length) {
      console.log(`\n⚠ Warnings:`);
      warnings.forEach((w) => console.log(`  - ${w}`));
    }
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
