/**
 * Vision review client — OpenAI-compatible chat completions with multimodal input.
 * Reads VISION_* env vars. Default: OpenRouter + gemini-3.1-pro-preview.
 */

import { logModelCall, logModelResponse, logError } from "../utils/logger.mjs";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-3.1-pro-preview";
const getModel = () => process.env.VISION_MODEL || DEFAULT_MODEL;
const getBaseUrl = () => process.env.VISION_BASE_URL || DEFAULT_BASE_URL;
const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.VISION_TIMEOUT_MS || "180000", 10);
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

/**
 * Send a text-only chat to Gemini Pro.
 */
export async function geminiProChat(prompt, { temperature = 0.3, logStep = "gemini-pro", requestTimeoutMs, timeoutEnvKey } = {}) {
  return withRetry(async () => {
    const API_KEY = process.env.VISION_API_KEY || "";
    const MODEL = getModel();
    const BASE_URL = getBaseUrl();
    logModelCall(logStep, MODEL, prompt);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Vision API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      logModelResponse(logStep, MODEL, text);
      return text;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Vision request timed out after ${timeoutMs / 1000}s`);
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
 * Send a vision request: text + one or more images (base64 PNG/JPEG).
 * @param {string} text
 * @param {Buffer[]} imageBuffers
 */
export async function geminiProVision(text, imageBuffers, { temperature = 0.3, logStep = "gemini-pro-vision", requestTimeoutMs, timeoutEnvKey } = {}) {
  return withRetry(async () => {
    const API_KEY = process.env.VISION_API_KEY || "";
    const MODEL = getModel();
    const BASE_URL = getBaseUrl();
    const imageRefs = imageBuffers.map((buf, i) => `[image_${i} ${(buf.length / 1024).toFixed(0)}KB]`);
    logModelCall(logStep, MODEL, text, imageRefs);
    const timeoutMs = resolveRequestTimeoutMs(requestTimeoutMs, timeoutEnvKey);

    const content = [
      { type: "text", text },
      ...imageBuffers.map((buf) => ({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${buf.toString("base64")}` },
      })),
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        const error = new Error(`Vision API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const result = data.choices?.[0]?.message?.content ?? "";
      logModelResponse(logStep, MODEL, result || "(empty response)");
      return result;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Vision request timed out after ${timeoutMs / 1000}s`);
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
 * Vision request that parses response as JSON.
 */
export async function geminiProVisionJSON(text, imageBuffers, opts = {}) {
  const raw = await geminiProVision(text, imageBuffers, opts);
  if (!raw || !raw.trim()) {
    throw new Error("Empty Vision JSON response");
  }
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse Vision JSON: ${raw.slice(0, 500)}`);
  }
}
