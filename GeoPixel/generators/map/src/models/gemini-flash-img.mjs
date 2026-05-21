/**
 * Image generation client — OpenAI-compatible chat completions with image output.
 * Reads IMAGE_GEN_* env vars. Default: OpenRouter + gemini-3.1-flash-image-preview.
 */

import { logModelCall, logModelResponse, logModelImageResponse, logError } from "../utils/logger.mjs";
import { getMapImageSizeLabel } from "../utils/generation-config.mjs";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3.1-flash-image-preview";
// Read lazily so dotenv.config() in the entry point takes effect before first call
const getModel = () => process.env.IMAGE_GEN_MODEL || DEFAULT_MODEL;
const getBaseUrl = () => process.env.IMAGE_GEN_BASE_URL || DEFAULT_BASE_URL;
const getProvider = () => (process.env.IMAGE_GEN_PROVIDER || "").trim().toLowerCase();
const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.IMAGE_GEN_TIMEOUT_MS || "180000", 10);
const MAX_CONSECUTIVE_FAILURES = 2;

async function withRetry(fn, logStep) {
  for (let attempt = 1; attempt <= MAX_CONSECUTIVE_FAILURES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt < MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[${logStep}] Attempt ${attempt} failed (${e.message}), retrying...`);
        continue;
      }
      throw e;
    }
  }
}

function resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey) {
  if (Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0) {
    return requestTimeoutMs;
  }

  if (timeoutEnvKey && process.env[timeoutEnvKey]) {
    const parsed = parseInt(process.env[timeoutEnvKey], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
}

// gpt-image-* and gpt-*-image-* use /images/edits (multipart), not chat completions
function useOpenAIImageEditsEndpoint() {
  const bare = getModel().replace(/^openai\//, "");
  return bare.startsWith("gpt-image") || /^gpt-[\d.]+[a-z]*-image/i.test(bare);
}

function imageSizeToOpenAI(imageSize) {
  // GeoPixel labels: "1K"→1024x1024, "2K"→1024x1024 (max for edits), "4K"→1024x1024
  return "1024x1024";
}

async function postOpenAIImageEdit(text, imageBuffer, { apiKey, signal, imageSize }) {
  const form = new FormData();
  const bare = getModel().replace(/^openai\//, "");
  form.append("model", bare);
  form.append("prompt", text);
  form.append("image[]", new Blob([imageBuffer], { type: "image/png" }), "map.png");
  form.append("n", "1");
  form.append("size", imageSizeToOpenAI(imageSize));
  form.append("response_format", "b64_json");
  return fetch(`${getBaseUrl()}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
}

function extractOpenAIEditsBuffer(data) {
  const b64 = data?.data?.[0]?.b64_json;
  if (b64) return Buffer.from(b64, "base64");
  throw new Error("No image found in OpenAI images/edits response");
}

function useGoogleNativeProvider() {
  const provider = getProvider();
  const baseUrl = getBaseUrl();
  return (
    provider === "google-native" ||
    provider === "google" ||
    (!provider && baseUrl.includes("generativelanguage.googleapis.com"))
  );
}

function getGoogleNativeBaseUrl() {
  const trimmed = getBaseUrl().replace(/\/+$/, "");
  return trimmed.endsWith("/openai")
    ? trimmed.slice(0, -"/openai".length)
    : trimmed;
}

function getGoogleNativeModel() {
  return getModel().replace(/^google\//, "").replace(/^models\//, "");
}

function buildGoogleNativeUrl(apiKey) {
  const model = encodeURIComponent(getGoogleNativeModel());
  return `${getGoogleNativeBaseUrl()}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function buildGoogleNativeBody(parts) {
  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };
}

async function postGoogleNativeImage(parts, { apiKey, signal }) {
  return fetch(buildGoogleNativeUrl(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGoogleNativeBody(parts)),
    signal,
  });
}

/**
 * Text-to-image generation.
 * @returns {Buffer} PNG image buffer
 */
export async function generateImage(
  prompt,
  { aspectRatio = "16:9", imageSize = getMapImageSizeLabel(), logStep = "flash-img-gen", requestTimeoutMs, timeoutEnvKey } = {},
) {
  return withRetry(async () => {
    const API_KEY = process.env.IMAGE_GEN_API_KEY || "";
    const MODEL = getModel();
    const BASE_URL = getBaseUrl();
    logModelCall(logStep, MODEL, prompt, [`config: aspect=${aspectRatio}, size=${imageSize}`]);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const nativePrompt = useGoogleNativeProvider()
        ? `${prompt}\n\nGenerate the image in ${aspectRatio} aspect ratio.`
        : prompt;
      const res = useGoogleNativeProvider()
        ? await postGoogleNativeImage([{ text: nativePrompt }], {
            apiKey: API_KEY,
            signal: controller.signal,
          })
        : await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: MODEL,
              messages: [{ role: "user", content: prompt }],
              modalities: ["image", "text"],
              image_config: { aspect_ratio: aspectRatio, image_size: imageSize },
            }),
            signal: controller.signal,
          });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Image Gen API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const buf = useGoogleNativeProvider()
        ? extractGoogleNativeImageBuffer(data)
        : extractImageBuffer(data);
      logModelImageResponse(logStep, MODEL, "(returned to caller)", buf.length);
      return buf;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Image Gen request timed out after ${timeoutMs / 1000}s`);
        logError(logStep, error);
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }, logStep);
}

/**
 * Image editing: pass an existing image + text instruction → modified image.
 * @param {string} text  - editing instruction
 * @param {Buffer} imageBuffer - source image
 * @returns {Buffer} PNG image buffer
 */
export async function editImage(text, imageBuffer, { imageSize = "2K", logStep = "flash-img-edit", requestTimeoutMs, timeoutEnvKey } = {}) {
  return withRetry(async () => {
    const API_KEY = process.env.IMAGE_GEN_API_KEY || "";
    const MODEL = getModel();
    const BASE_URL = getBaseUrl();
    logModelCall(logStep, MODEL, text, [`input_image: ${(imageBuffer.length / 1024).toFixed(0)}KB`, `config: size=${imageSize}`]);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const base64 = imageBuffer.toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let res;
      if (useOpenAIImageEditsEndpoint()) {
        res = await postOpenAIImageEdit(text, imageBuffer, {
          apiKey: API_KEY,
          signal: controller.signal,
          imageSize,
        });
      } else if (useGoogleNativeProvider()) {
        res = await postGoogleNativeImage(
          [
            { text },
            { inlineData: { mimeType: "image/png", data: base64 } },
          ],
          { apiKey: API_KEY, signal: controller.signal },
        );
      } else {
        res = await fetch(`${BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text },
                  {
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${base64}` },
                  },
                ],
              },
            ],
            modalities: ["image", "text"],
            image_config: { image_size: imageSize },
          }),
          signal: controller.signal,
        });
      }

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Image Gen Edit API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const buf = useOpenAIImageEditsEndpoint()
        ? extractOpenAIEditsBuffer(data)
        : useGoogleNativeProvider()
          ? extractGoogleNativeImageBuffer(data)
          : extractImageBuffer(data);
      logModelImageResponse(logStep, MODEL, "(returned to caller)", buf.length);
      return buf;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Image Gen Edit request timed out after ${timeoutMs / 1000}s`);
        logError(logStep, error);
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }, logStep);
}

function extractImageBuffer(data) {
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("No message in Image Gen response");

  if (message.images && message.images.length > 0) {
    const url = message.images[0].image_url.url;
    const b64 = url.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(b64, "base64");
  }

  if (message.content && typeof message.content === "string") {
    const match = message.content.match(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/);
    if (match) return Buffer.from(match[1], "base64");
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

  throw new Error("No image found in Image Gen response");
}

function extractGoogleNativeImageBuffer(data) {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate.content?.parts)
      ? candidate.content.parts
      : [];
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        return Buffer.from(inlineData.data, "base64");
      }
    }
  }

  throw new Error("No image found in Google native Image Gen response");
}
