/**
 * Post-process the 12 generated spritesheets:
 * 1. Chromakey (green background removal - fixed version)
 * 2. Resize to 1020x1020 (170*6 × 204*5, matching game frame dimensions)
 *
 * Usage: node fix_spritesheets.mjs
 */

import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_BASE = resolve(__dirname, "../../output/characters");

const NPC_IDS = [
  "app_npc_woman1", "app_npc_woman2", "app_npc_woman3",
  "app_npc_man1", "app_npc_man2", "app_npc_man3",
  "app_npc_girl", "app_npc_boy",
  "app_npc_oldman1", "app_npc_oldman2",
  "app_npc_oldwoman1", "app_npc_oldwoman2",
];

async function removeGreenBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  // Detect background green from correct corners: top-left, top-right-3, bottom-left-3, bottom-right-3
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  const patchSize = 5;
  const corners = [
    [0, 0],
    [width - patchSize, 0],
    [0, height - patchSize],
    [width - patchSize, height - patchSize],
  ];
  for (const [cx, cy] of corners) {
    for (let dy = 0; dy < patchSize; dy++) {
      for (let dx = 0; dx < patchSize; dx++) {
        const pi = ((cy + dy) * width + (cx + dx)) * channels;
        totalR += pixels[pi];
        totalG += pixels[pi + 1];
        totalB += pixels[pi + 2];
        count++;
      }
    }
  }
  const bgR = Math.round(totalR / count);
  const bgG = Math.round(totalG / count);
  const bgB = Math.round(totalB / count);
  console.log(`    BG: rgb(${bgR},${bgG},${bgB})`);

  const HARD = 18;
  const SOFT = 40;

  function colorDist(r1, g1, b1) {
    return Math.sqrt((r1 - bgR) ** 2 + (g1 - bgG) ** 2 + (b1 - bgB) ** 2);
  }

  // Phase 1: Flood-fill from edges to find connected background
  const state = new Uint8Array(width * height); // 0=unvisited, 1=hard-bg, 2=soft-bg
  const queue = [];
  const idx = (x, y) => y * width + x;
  const pixelIdx = (x, y) => (y * width + x) * channels;

  const seedIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    if (state[idx(x, y)] !== 0) return;
    const pi = pixelIdx(x, y);
    const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
    if (d < SOFT) {
      state[idx(x, y)] = d < HARD ? 1 : 2;
      queue.push(x, y);
    }
  };

  for (let x = 0; x < width; x++) { seedIfBg(x, 0); seedIfBg(x, height - 1); }
  for (let y = 1; y < height - 1; y++) { seedIfBg(0, y); seedIfBg(width - 1, y); }

  let qi = 0;
  while (qi < queue.length) {
    const cx = queue[qi++], cy = queue[qi++];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (state[idx(nx, ny)] !== 0) continue;
      const pi = pixelIdx(nx, ny);
      const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
      if (d < SOFT) {
        state[idx(nx, ny)] = d < HARD ? 1 : 2;
        queue.push(nx, ny);
      }
    }
  }

  // Phase 2: Apply transparency
  // - Flood-fill connected bg (state 1/2): remove with full soft-edge blending
  // - Unvisited bg-like pixels (state 0, low dist): remove with tighter threshold
  // - Everything else: keep opaque
  let removed = 0;
  const UNVISITED_HARD = 12;
  const UNVISITED_SOFT = 20;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = state[idx(x, y)];
      const pi = pixelIdx(x, y);
      if (s === 1) {
        pixels[pi + 3] = 0;
        removed++;
      } else if (s === 2) {
        const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
        const t = Math.max(0, Math.min(1, (d - HARD) / (SOFT - HARD)));
        pixels[pi + 3] = Math.min(pixels[pi + 3], Math.round(255 * t));
        removed++;
      } else if (s === 0) {
        // For pixels flood-fill couldn't reach, do a tight chroma key
        // (only remove pixels very close to background color)
        const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
        if (d < UNVISITED_SOFT) {
          const t = Math.max(0, Math.min(1, (d - UNVISITED_HARD) / (UNVISITED_SOFT - UNVISITED_HARD)));
          pixels[pi + 3] = Math.min(pixels[pi + 3], Math.round(255 * t));
          removed++;
        }
      }
    }
  }

  const total = width * height;
  console.log(`    Removed ${removed}/${total} (${(100 * removed / total).toFixed(1)}%)`);
  return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels } }).png().toBuffer();
}

async function main() {
  console.log("=== Post-processing 12 spritesheets ===\n");

  for (const id of NPC_IDS) {
    const dir = join(OUTPUT_BASE, id);
    const rawPath = join(dir, "spritesheet-raw.png");
    const outPath = join(dir, "spritesheet.png");

    const raw = readFileSync(rawPath);
    console.log(`[${id}] Input: ${(raw.length / 1024).toFixed(0)} KB`);

    // Step 1: Chromakey
    console.log(`  chromakey...`);
    const transparent = await removeGreenBackground(raw);

    // Step 2: Resize to 1020x1020 (the game expects 170x204 * 6x5 grid)
    const resized = await sharp(transparent)
      .resize(1020, 1020, { kernel: "nearest" })
      .png()
      .toBuffer();

    writeFileSync(outPath, resized);
    console.log(`  saved: ${outPath} (${(resized.length / 1024).toFixed(0)} KB)`);
  }

  console.log("\n=== All done! ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
