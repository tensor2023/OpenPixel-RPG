/**
 * Character sprite generator — text-to-image via TokenRouter
 * Try: openai/gpt-image-2 (OpenAI images/generations endpoint)
 * Fallback: google/gemini-2.5-flash-image (chat completions + modalities)
 *
 * Usage: node generate.mjs [--model <model>]
 * Output: char1_female.png, char2_child.png, char3_male.png
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://api.tokenrouter.com/v1";
const API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH";

// Parse --model flag
const modelArg = process.argv.indexOf("--model");
const FORCED_MODEL = modelArg !== -1 ? process.argv[modelArg + 1] : null;

const PRIMARY_MODEL = "openai/gpt-image-2";
const FALLBACK_MODEL = "google/gemini-2.5-flash-image";

const STYLE_BASE =
  "pixel art RPG character sprite sheet, chibi Q-version style, 2.5 head-to-body ratio, " +
  "JRPG retro 16-bit aesthetic, solid limited color palette, black outlines, " +
  "white background, front-facing idle standing pose, full body visible, no cropping";

const CHARACTERS = [
  {
    id: "char1_female",
    name: "角色1 (女主角)",
    prompt:
      `${STYLE_BASE}, 20-year-old young woman, ` +
      "blue denim overalls/dungarees, black shoulder-length straight hair, red beret hat",
  },
  {
    id: "char2_child",
    name: "角色2 (小孩)",
    prompt:
      `${STYLE_BASE}, small child character, ` +
      "very short stature (half adult height), pink dress/frock, purple medium-length hair",
  },
  {
    id: "char3_male",
    name: "角色3 (男角色)",
    prompt:
      `${STYLE_BASE}, 20-year-old young man, ` +
      "white shirt/top, khaki pants/trousers, brown hair",
  },
];

// ── OpenAI images/generations endpoint (for gpt-image-2) ──
async function generateWithOpenAIImages(prompt, model) {
  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.replace(/^openai\//, ""),
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No b64_json in response: " + JSON.stringify(data).slice(0, 200));
  return Buffer.from(b64, "base64");
}

// ── OpenAI-compatible chat completions with image modality (for gemini) ──
async function generateWithChatCompletions(prompt, model) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("No message in response");

  // Try multiple extraction paths used by different providers
  if (message.images?.length > 0) {
    const url = message.images[0].image_url?.url || message.images[0];
    const b64 = String(url).replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(b64, "base64");
  }

  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url") {
        const url = part.image_url?.url || "";
        const b64 = url.replace(/^data:image\/\w+;base64,/, "");
        if (b64) return Buffer.from(b64, "base64");
      }
    }
  }

  if (typeof message.content === "string") {
    const match = message.content.match(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/);
    if (match) return Buffer.from(match[1], "base64");
  }

  throw new Error("No image found in response: " + JSON.stringify(message).slice(0, 300));
}

async function generateCharacter(char) {
  const model = FORCED_MODEL || PRIMARY_MODEL;
  const isGptImage = model.replace(/^openai\//, "").startsWith("gpt-image");

  console.log(`\n[${char.name}] Model: ${model}`);
  console.log(`  Prompt: ${char.prompt.slice(0, 80)}...`);

  try {
    const buf = isGptImage
      ? await generateWithOpenAIImages(char.prompt, model)
      : await generateWithChatCompletions(char.prompt, model);

    const outPath = path.join(__dirname, `${char.id}.png`);
    fs.writeFileSync(outPath, buf);
    console.log(`  ✓ Saved: ${char.id}.png  (${(buf.length / 1024).toFixed(0)} KB)`);
    return { success: true, model };
  } catch (primaryErr) {
    console.warn(`  ✗ ${model} failed: ${primaryErr.message}`);

    if (FORCED_MODEL) throw primaryErr; // no fallback if model was explicitly forced

    // Fallback to gemini
    console.log(`  → Fallback: ${FALLBACK_MODEL}`);
    try {
      const buf = await generateWithChatCompletions(char.prompt, FALLBACK_MODEL);
      const outPath = path.join(__dirname, `${char.id}.png`);
      fs.writeFileSync(outPath, buf);
      console.log(`  ✓ Saved via fallback: ${char.id}.png  (${(buf.length / 1024).toFixed(0)} KB)`);
      return { success: true, model: FALLBACK_MODEL, usedFallback: true };
    } catch (fallbackErr) {
      throw new Error(`Both models failed:\n  ${model}: ${primaryErr.message}\n  ${FALLBACK_MODEL}: ${fallbackErr.message}`);
    }
  }
}

async function main() {
  console.log("=== Character Sprite Generator ===");
  console.log(`Primary model:  ${FORCED_MODEL || PRIMARY_MODEL}`);
  console.log(`Fallback model: ${FALLBACK_MODEL}`);
  console.log(`Output dir:     ${__dirname}`);

  const results = {};

  for (const char of CHARACTERS) {
    try {
      results[char.id] = await generateCharacter(char);
    } catch (e) {
      console.error(`  FAILED [${char.name}]: ${e.message}`);
      results[char.id] = { success: false, error: e.message };
    }
    // Rate limit buffer between requests
    if (char !== CHARACTERS[CHARACTERS.length - 1]) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\n=== Summary ===");
  for (const [id, r] of Object.entries(results)) {
    if (r.success) {
      const note = r.usedFallback ? ` (fallback: ${r.model})` : ` (${r.model})`;
      console.log(`  ✓ ${id}${note}`);
    } else {
      console.log(`  ✗ ${id}: ${r.error}`);
    }
  }

  const allOk = Object.values(results).every((r) => r.success);
  const usedFallback = Object.values(results).some((r) => r.usedFallback);
  if (usedFallback) {
    console.log("\n[!] gpt-image-2 unavailable — used gemini-2.5-flash-image as fallback.");
    console.log("    To force gemini directly: node generate.mjs --model google/gemini-2.5-flash-image");
  }
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
