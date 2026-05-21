/**
 * Vision review client — OpenAI-compatible chat completions with multimodal input.
 * Reads VISION_* env vars. Simplified client for sprite sheet review.
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
const MODEL = process.env.VISION_MODEL || DEFAULT_MODEL;
const BASE_URL = process.env.VISION_BASE_URL || DEFAULT_BASE_URL;
const REQUEST_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || "180000", 10);

/**
 * Vision request: text + image -> JSON response.
 * @param {string} text
 * @param {Buffer[]} imageBuffers
 */
export async function geminiProVisionJSON(text, imageBuffers, { temperature = 0.3 } = {}) {
  const API_KEY = process.env.VISION_API_KEY || "";
  const content = [
    { type: "text", text },
    ...imageBuffers.map((buf) => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${buf.toString("base64")}` },
    })),
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content }],
        temperature,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Vision API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "";

    try {
      const match = raw.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : JSON.parse(raw);
    } catch {
      throw new Error(`Failed to parse Vision JSON: ${raw.slice(0, 500)}`);
    }
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`Vision request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
