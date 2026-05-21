/**
 * Build 6x5 spritesheets from reference images (no AI).
 *
 * For each NPC type, takes the single character image from 参考/,
 * removes the white background, and builds a 1020×1020 spritesheet
 * (6 cols × 5 rows, 170×204 per frame) with the character placed
 * into each cell.
 *
 * Usage: node build_npc_sheets.mjs
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCRIPT_DIR = __dirname;

const REF_DIR = join(SCRIPT_DIR, "参考");
const OUTPUT_CHAR = resolve(SCRIPT_DIR, "../../WorldX-main/output/characters");

const GREEN = { r: 0, g: 176, b: 0 }; // #00B000

const COLS = 6;
const ROWS = 5;
const FW = 170;  // frame width
const FH = 204;  // frame height
const SW = FW * COLS; // sheet width  = 1020
const SH = FH * ROWS; // sheet height = 1020

// How much the character should fill of each frame (as fraction)
const SCALE_FACTOR = 0.65;

// Walk cycle: 6 frames, X offset in pixels
const WALK_X = [0, -2, -5, 0, 2, 5];

const NPCS = [
  { id: "app_npc_woman1",     file: "npc_woman1.png",     role: "年轻休闲女性" },
  { id: "app_npc_woman2",     file: "npc_woman2.png",     role: "优雅女性" },
  { id: "app_npc_woman3",     file: "npc_woman3.png",     role: "酷帅女性" },
  { id: "app_npc_man1",       file: "npc_man1.png",       role: "休闲男性" },
  { id: "app_npc_man2",       file: "npc_man2.png",       role: "斯文男性" },
  { id: "app_npc_man3",       file: "npc_man3.png",       role: "运动男性" },
  { id: "app_npc_girl",       file: "npc_girl.png",       role: "小女孩" },
  { id: "app_npc_boy",        file: "npc_boy.png",        role: "小男孩" },
  { id: "app_npc_oldman1",    file: "npc_oldman1.png",    role: "老年学者" },
  { id: "app_npc_oldman2",    file: "npc_oldman2.png",    role: "老年开朗" },
  { id: "app_npc_oldwoman1",  file: "npc_oldwoman1.png",  role: "老年典雅女性" },
  { id: "app_npc_oldwoman2",  file: "npc_oldwoman2.png",  role: "老年热心女性" },
];

/**
 * Remove near-white background → transparent.
 * Simple threshold: any pixel within `threshold` of white becomes transparent.
 */
async function removeWhiteBg(buffer, threshold = 35) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * channels;
      const r = pixels[pi], g = pixels[pi + 1], b = pixels[pi + 2];
      const dist = Math.sqrt((r - 255) ** 2 + (g - 255) ** 2 + (b - 255) ** 2);
      if (dist < threshold) {
        pixels[pi + 3] = 0; // fully transparent
      }
    }
  }

  return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels } })
    .png()
    .toBuffer();
}

/**
 * Find the bounding box of non-transparent pixels.
 */
async function findContentBounds(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasContent = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 30) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        hasContent = true;
      }
    }
  }

  if (!hasContent) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * For a character image (buffer with transparent bg), darken the RGB channels
 * to simulate a "back" view.
 */
async function darkenChar(buffer, factor = 0.75) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  for (let i = 0; i < width * height * channels; i += channels) {
    data[i]     = Math.round(data[i] * factor);     // R
    data[i + 1] = Math.round(data[i + 1] * factor); // G
    data[i + 2] = Math.round(data[i + 2] * factor); // B
    // alpha unchanged
  }

  return sharp(Buffer.from(data.buffer), { raw: { width, height, channels } })
    .png()
    .toBuffer();
}

/**
 * Chromakey: remove green background via flood-fill from edges.
 */
async function removeGreenBg(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  const bgR = GREEN.r, bgG = GREEN.g, bgB = GREEN.b;
  const HARD = 35, SOFT = 65;

  const colorDist = (r, g, b) => Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
  const state = new Uint8Array(width * height);
  const queue = [];
  const idx = (x, y) => y * width + x;

  const seedIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pi = (y * width + x) * channels;
    const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
    if (d < SOFT && state[idx(x, y)] === 0) {
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
      const pi = (ny * width + nx) * channels;
      const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
      if (d < SOFT) {
        state[idx(nx, ny)] = d < HARD ? 1 : 2;
        queue.push(nx, ny);
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = state[idx(x, y)];
      const pi = (y * width + x) * channels;
      if (s === 1) {
        pixels[pi + 3] = 0;
      } else if (s === 2) {
        const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
        const t = Math.max(0, Math.min(1, (d - HARD) / (SOFT - HARD)));
        pixels[pi + 3] = Math.min(pixels[pi + 3], Math.round(255 * t));
      }
    }
  }

  return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels } })
    .png()
    .toBuffer();
}

/**
 * Build the complete spritesheet for one NPC.
 */
async function buildForNpc(npc) {
  const refPath = join(REF_DIR, npc.file);
  if (!existsSync(refPath)) {
    console.log(`  SKIP: ${npc.file} not found`);
    return;
  }

  console.log(`\n[${npc.id}] ${npc.role} ← ${npc.file}`);

  // 1. Load reference and remove white background
  const refBuf = readFileSync(refPath);
  const charBuf = await removeWhiteBg(refBuf);

  // 2. Find character bounds and scale to fit frame
  const bounds = await findContentBounds(charBuf);
  if (!bounds) {
    console.log(`  FAIL: no character content detected`);
    return;
  }

  const targetW = Math.round(FW * SCALE_FACTOR);
  const targetH = Math.round(FH * SCALE_FACTOR);
  const scale = Math.min(targetW / bounds.w, targetH / bounds.h);
  const scaledW = Math.round(bounds.w * scale);
  const scaledH = Math.round(bounds.h * scale);

  console.log(`  bounds: ${bounds.w}×${bounds.h}, scale: ${scale.toFixed(3)}, → ${scaledW}×${scaledH}`);

  const charScaled = await sharp(charBuf)
    .resize(scaledW, scaledH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Also create darkened version for "back" view
  const charBack = await darkenChar(charScaled);

  // Center position within a frame
  const cx = Math.round((FW - scaledW) / 2);
  const cy = Math.round((FH - scaledH) / 2);

  // 3. Build the spritesheet composite layers
  const overlays = [];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const bx = col * FW; // base x of this cell in the sheet
      const by = row * FH;

      // Determine what to place in this cell
      if (row < 3) {
        // Walk rows: row 0 = left, row 1 = down, row 2 = up
        const xOff = WALK_X[col];
        const yOff = 0;

        let src;
        if (row === 0) {
          // Walk left — flip horizontally (face left)
          const flipped = await sharp(charScaled)
            .flop()
            .png()
            .toBuffer();
          src = flipped;
        } else if (row === 1) {
          // Walk down — front facing, no flip
          src = charScaled;
        } else {
          // Walk up — back view (darkened)
          src = charBack;
        }

        overlays.push({
          input: src,
          top: by + cy + yOff,
          left: bx + cx + xOff,
        });
      } else if (row === 3 && col < 3) {
        // Idle row: col 0 = front, col 1 = back, col 2 = left
        let src;
        if (col === 0) {
          src = charScaled;
        } else if (col === 1) {
          src = charBack;
        } else {
          src = await sharp(charScaled).flop().png().toBuffer();
        }

        overlays.push({
          input: src,
          top: by + cy,
          left: bx + cx,
        });
      }
      // else: blank (green background) — nothing to composite
    }
  }

  // 4. Create green background canvas and composite
  const greenBuffer = await sharp({
    create: { width: SW, height: SH, channels: 3, background: GREEN },
  })
    .png()
    .toBuffer();

  const composited = await sharp(greenBuffer)
    .composite(overlays)
    .png()
    .toBuffer();

  // 5. Save raw (green bg) and processed (transparent bg) versions
  const outDir = join(OUTPUT_CHAR, npc.id);
  mkdirSync(outDir, { recursive: true });

  const rawPath = join(outDir, "spritesheet-raw.png");
  writeFileSync(rawPath, composited);
  console.log(`  → spritesheet-raw.png  (${(composited.length / 1024).toFixed(0)} KB)`);

  const transparentBuf = await removeGreenBg(composited);
  const spritePath = join(outDir, "spritesheet.png");
  writeFileSync(spritePath, transparentBuf);
  console.log(`  → spritesheet.png      (${(transparentBuf.length / 1024).toFixed(0)} KB)`);

  // 6. Metadata
  const meta = {
    id: npc.id,
    name: npc.role,
    description: `NPC template: ${npc.role}`,
    frameWidth: FW,
    frameHeight: FH,
    columns: COLS,
    rows: ROWS,
    createdAt: new Date().toISOString(),
    sourceFile: npc.file,
    animations: {
      "walk-left":  { start: 0, end: 5, frameRate: 8 },
      "walk-down":  { start: 6, end: 11, frameRate: 8 },
      "walk-up":    { start: 12, end: 17, frameRate: 8 },
      "idle-front": { frame: 18 },
      "idle-back":  { frame: 19 },
      "idle-left":  { frame: 20 },
    },
  };

  const metaPath = join(outDir, "metadata.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`  → metadata.json`);

  // 7. Update manifest
  const manifestPath = join(OUTPUT_CHAR, "characters.json");
  let manifest = [];
  if (existsSync(manifestPath)) {
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf-8")); } catch {}
  }
  // Remove existing entry for this npc id, add new one
  manifest = manifest.filter(e => e.id !== npc.id);
  manifest.push({ id: npc.id, name: npc.role, description: meta.description, createdAt: meta.createdAt });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function main() {
  console.log("=== Build NPC Spritesheets from Reference Images ===\n");
  console.log(`Reference images: ${REF_DIR}`);
  console.log(`Output: ${OUTPUT_CHAR}\n`);

  for (const npc of NPCS) {
    await buildForNpc(npc);
  }

  console.log("\n=== Done! ===");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
