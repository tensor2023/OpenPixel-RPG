/**
 * Batch spritesheet generation for all 12 NPC reference images.
 *
 * For each NPC:
 *   1. Load the single front-facing image as style reference
 *   2. Build a 6x5 spritesheet prompt (walk animations + idle frames)
 *   3. Call Gemini Flash Image via TokenRouter
 *   4. Chromakey (green-screen removal)
 *   5. Save to WorldX-main/output/characters/app_npc_<name>/
 *
 * Usage: node batch_gen_spritesheets.mjs
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = resolve(__dirname, "../..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

// Reference images live outside GeoPixel, in G_gen_pixel/characters/参考/
const G_GEN_PIXEL   = resolve(PROJECT_ROOT, "../G_gen_pixel");
const REF_DIR       = join(G_GEN_PIXEL, "characters", "参考");
const OUTPUT_BASE   = join(PROJECT_ROOT, "output/characters");
const CHAR_MANIFEST = join(OUTPUT_BASE, "characters.json");

// ── NPC definitions ─────────────────────────────────────────────────────────
const NPCS = [
  // ── Young Women ──
  {
    id: "app_npc_woman1",
    file: "npc_woman1.png",
    role: "年轻女性/学生/职员",
    appearance: "22岁年轻女性。暖橙色头发扎成凌乱的发髻，散落几缕发丝。明亮的灿烂笑容，红润的脸颊。穿着舒适的奶油色宽松针织毛衣和牛仔迷你裙。白色运动鞋。精力充沛、友善的表情。",
  },
  {
    id: "app_npc_woman2",
    file: "npc_woman2.png",
    role: "年轻女性/白领/优雅型",
    appearance: "25岁年轻女性。长长的直发浅金色，发尾微卷。温柔的微笑。穿着优雅的薄荷绿碎花裙，腰间有一个小蝴蝶结。白色高跟鞋。优雅平静的表情。",
  },
  {
    id: "app_npc_woman3",
    file: "npc_woman3.png",
    role: "年轻女性/时尚潮流型",
    appearance: "20岁年轻女性。紫色短发波波头。自信的挑眉笑容。穿着黑色皮夹克内搭红色短款上衣，深色格纹裙。黑色靴子。酷炫时尚的造型。",
  },

  // ── Young Men ──
  {
    id: "app_npc_man1",
    file: "npc_man1.png",
    role: "年轻男性/学生/休闲型",
    appearance: "23岁年轻男性。黑色蓬松凌乱的头发。友善温暖的笑容，红润的脸颊。穿着白色T恤外搭蓝色法兰绒开衫，卡其色短裤。白色运动鞋。轻松随和的表情。",
  },
  {
    id: "app_npc_man2",
    file: "npc_man2.png",
    role: "年轻男性/上班族/斯文型",
    appearance: "26岁年轻男性。整洁的浅棕色侧分头发。礼貌温柔的微笑。穿着浅蓝色衬衫扎进裤腰，袖子卷起，深海军蓝长裤。棕色皮鞋。聪明端庄的表情。",
  },
  {
    id: "app_npc_man3",
    file: "npc_man3.png",
    role: "年轻男性/运动型",
    appearance: "21岁年轻男性。尖刺形亮蓝色发梢（深色发根）。兴奋活力的笑容。穿着橙色和黑色拼色运动夹克，配套运动裤。运动鞋。动感十足的运动表情。",
  },

  // ── Girl ──
  {
    id: "app_npc_girl",
    file: "npc_girl.png",
    role: "小女孩/学生",
    appearance: "8岁小女孩。比成人更矮更小，头身比约3:1。鲜红色头发扎成两个高马尾，系着黄色蝴蝶结。闪亮的大眼睛，灿烂的笑容，红润脸颊。穿着亮黄色雏菊图案太阳裙。白色短袜，红色玛丽珍鞋。天真快乐的表情。",
  },

  // ── Boy ──
  {
    id: "app_npc_boy",
    file: "npc_boy.png",
    role: "小男孩/学生",
    appearance: "8岁小男孩。比成人更矮更小，头身比约3:1。金色锅盖头。圆圆的眼睛，兴奋咧嘴大笑，红润脸颊。穿着浅蓝色工装裤内搭红白条纹T恤。白色运动鞋。活泼精力充沛的表情。",
  },

  // ── Old Men ──
  {
    id: "app_npc_oldman1",
    file: "npc_oldman1.png",
    role: "老年男性/学者/知识型",
    appearance: "70岁老年男性。比年轻人略矮、略显驼背。整齐的白发，鼻子上架着圆框眼镜，浓密白色眉毛，布满皱纹的慈祥脸庞。温和睿智的微笑。穿着舒适的米色开衫内搭浅色衬衫，深棕色长裤。棕色乐福鞋。慈祥学者表情。",
  },
  {
    id: "app_npc_oldman2",
    file: "npc_oldman2.png",
    role: "老年男性/开朗型",
    appearance: "68岁老年男性。略微驼背。完全秃头，白色短胡子，深陷的皱纹眼睛。开怀大笑的表情，红润脸颊。穿着宽松的深红色传统马甲内搭奶油色衬衫，灰色宽松长裤。凉鞋。开朗热情的表情。",
  },

  // ── Old Women ──
  {
    id: "app_npc_oldwoman1",
    file: "npc_oldwoman1.png",
    role: "老年女性/传统典雅型",
    appearance: "65岁老年女性。比年轻人略矮驼背。白发整齐盘成发髻，插着一支玉簪。温柔慈祥的布满皱纹的脸。温暖轻柔的微笑。穿着淡紫色传统花卉旗袍。黑色平底鞋。安详端庄的表情。",
  },
  {
    id: "app_npc_oldwoman2",
    file: "npc_oldwoman2.png",
    role: "老年女性/热心型",
    appearance: "70岁老年女性。略微驼背。短卷银灰色头发。圆圆的布满皱纹的脸，笑纹明显， cheerful 眯缝的眼睛，红润脸颊。大大的温暖笑容。穿着鲜艳多彩的花卉开衫（蓝绿色和橙色花朵）内搭浅色衬衫，舒适的深色裙子。活泼温暖的表情。",
  },
];

// ── Spritesheet Prompt ───────────────────────────────────────────────────────

function buildSpritesheetPrompt(npc) {
  return `Create a pixel art 6x5 sprite sheet for a game character.

CHARACTER IDENTITY:
Role: ${npc.role}
Appearance: ${npc.appearance}

SHEET LAYOUT — exactly 6 columns × 5 rows:
  Row 1: WALK LEFT — 6 frames (continuous walk cycle, facing left)
  Row 2: WALK DOWN — 6 frames (walking toward viewer, facing front)
  Row 3: WALK UP — 6 frames (walking away from viewer, facing back)
  Row 4: IDLE FRAMES from left to right: front-facing idle, back-facing idle, left-facing idle. Columns 4-6 blank/empty.
  Row 5: completely blank/empty

ART STYLE:
- Chunky pixel art, chibi/Q-version proportions (head about 1/2.5 of body height)
- Cute, vivid saturated colors
- Dark crisp pixel outlines, readable at small scale
- Full body visible in every frame (head to feet)
- Each frame character size must be IDENTICAL (same bounding box)

TECHNICAL:
- Background: 100% solid flat green (#00B000) — NO other background colors, NO gradients
- NO borders, NO lines, NO frames between cells — only green separates cells
- NO text, NO labels, NO numbers, NO arrows
- Character fills ~60% of each cell, with equal green margin all around
- No body part may cross cell boundaries
- Each row must align horizontally — same Y position across all columns`;
}

// ── API Helper ───────────────────────────────────────────────────────────────

const API_URL = "https://api.tokenrouter.com/v1/chat/completions";
const API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH";
const MODEL   = "google/gemini-2.5-flash-image";

function imgToB64(imgPath, maxPx = 128) {
  const buf = readFileSync(imgPath);
  // Use sharp to resize
  return sharp(buf).resize(maxPx, maxPx, { fit: "inside" }).png().toBuffer().then(b => b.toString("base64"));
}

function extractImage(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return null;

  // path 1: message.images[]
  for (const img of (msg.images || [])) {
    const url = (img?.image_url?.url) || (typeof img === "string" ? img : "");
    if (url.includes("base64,")) return Buffer.from(url.split("base64,")[1], "base64");
  }

  // path 2: message.content list
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === "image_url") {
        const url = part.image_url?.url || "";
        if (url.includes("base64,")) return Buffer.from(url.split("base64,")[1], "base64");
      }
    }
  }

  // path 3: raw base64 string in content
  if (typeof content === "string" && content.includes("base64,")) {
    const b64 = content.split("base64,")[1]?.split('"')[0] || "";
    if (b64) return Buffer.from(b64, "base64");
  }

  return null;
}

async function generateSpritesheet(prompt, refB64) {
  const payload = {
    model: MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${refB64}` } },
      ],
    }],
    modalities: ["image", "text"],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const img = extractImage(data);
  if (!img) throw new Error("No image in API response");
  return img;
}

// ── Chromakey ────────────────────────────────────────────────────────────────

// Simplified green-screen removal: detect green background and make it transparent
async function removeGreenBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  // Detect background green
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  for (const x of [0, width - 1]) {
    for (const y of [0, height - 1]) {
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const pi = ((y + dy) * width + (x + dx)) * channels;
          totalR += pixels[pi];
          totalG += pixels[pi + 1];
          totalB += pixels[pi + 2];
          count++;
        }
      }
    }
  }
  const bgR = Math.round(totalR / count);
  const bgG = Math.round(totalG / count);
  const bgB = Math.round(totalB / count);
  console.log(`    [chromakey] Detected BG: rgb(${bgR},${bgG},${bgB})`);

  const HARD = 35;
  const SOFT = 65;

  function colorDist(r1, g1, b1) {
    return Math.sqrt((r1 - bgR) ** 2 + (g1 - bgG) ** 2 + (b1 - bgB) ** 2);
  }

  // Flood-fill from edges
  const state = new Uint8Array(width * height);
  const queue = [];
  const idx = (x, y) => y * width + x;
  const pixelIdx = (x, y) => (y * width + x) * channels;

  const seedIfBg = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pi = pixelIdx(x, y);
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
      const pi = pixelIdx(nx, ny);
      const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
      if (d < SOFT) {
        state[idx(nx, ny)] = d < HARD ? 1 : 2;
        queue.push(nx, ny);
      }
    }
  }

  // Apply transparency
  let removed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = state[idx(x, y)];
      const pi = pixelIdx(x, y);
      if (s === 1) { pixels[pi + 3] = 0; removed++; }
      else if (s === 2) {
        const d = colorDist(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
        const t = Math.max(0, Math.min(1, (d - HARD) / (SOFT - HARD)));
        pixels[pi + 3] = Math.min(pixels[pi + 3], Math.round(255 * t));
      }
    }
  }

  console.log(`    [chromakey] Removed ${removed}/${width * height} (${(100 * removed / (width * height)).toFixed(1)}%)`);
  return sharp(Buffer.from(pixels.buffer), { raw: { width, height, channels } }).png().toBuffer();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Batch Spritesheet Generation ===\n");
  console.log(`Total NPCs: ${NPCS.length}\n`);

  mkdirSync(OUTPUT_BASE, { recursive: true });

  for (const [i, npc] of NPCS.entries()) {
    const refPath = join(REF_DIR, npc.file);
    if (!existsSync(refPath)) {
      console.log(`[${i + 1}/${NPCS.length}] SKIP ${npc.id}: reference not found at ${refPath}`);
      continue;
    }

    const outputDir = join(OUTPUT_BASE, npc.id);
    mkdirSync(outputDir, { recursive: true });

    console.log(`[${i + 1}/${NPCS.length}] ${npc.id} (${npc.role})`);

    // Step 1: Generate spritesheet
    console.log(`  [gen] Loading reference: ${npc.file}`);
    const refB64 = await imgToB64(refPath);
    console.log(`  [gen] Sending to ${MODEL}...`);
    const prompt = buildSpritesheetPrompt(npc);

    let spriteBuffer;
    try {
      spriteBuffer = await generateSpritesheet(prompt, refB64);
      console.log(`  [gen] Received: ${(spriteBuffer.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error(`  [gen] FAILED: ${err.message}`);
      continue;
    }

    // Save raw
    const rawPath = join(outputDir, "spritesheet-raw.png");
    writeFileSync(rawPath, spriteBuffer);
    console.log(`  [gen] Saved raw: ${rawPath}`);

    // Step 2: Chromakey
    console.log(`  [ckey] Removing green background...`);
    let transparentBuffer;
    try {
      transparentBuffer = await removeGreenBackground(spriteBuffer);
    } catch (err) {
      console.error(`  [ckey] FAILED: ${err.message}`);
      continue;
    }

    const spritePath = join(outputDir, "spritesheet.png");
    writeFileSync(spritePath, transparentBuffer);
    console.log(`  [ckey] Saved: ${spritePath} (${(transparentBuffer.length / 1024).toFixed(0)} KB)`);

    // Step 3: Write metadata
    const meta = {
      id: npc.id,
      name: npc.role,
      description: npc.appearance,
      createdAt: new Date().toISOString(),
      sourceFile: npc.file,
    };
    const metaPath = join(outputDir, "metadata.json");
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // Step 4: Update manifest
    let manifest = [];
    if (existsSync(CHAR_MANIFEST)) {
      try { manifest = JSON.parse(readFileSync(CHAR_MANIFEST, "utf-8")); } catch { manifest = []; }
    }
    manifest.push({ id: npc.id, name: npc.role, description: npc.appearance, createdAt: meta.createdAt });
    writeFileSync(CHAR_MANIFEST, JSON.stringify(manifest, null, 2));

    console.log(`  [done] Complete!\n`);
  }

  console.log("=== All done! ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
