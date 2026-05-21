/**
 * Orchestrator LLM client — OpenAI-compatible chat completions.
 * Shares ORCHESTRATOR_* env vars with the orchestrator package.
 */

import { logModelCall, logModelResponse, logError } from "../utils/logger.mjs";
import {
  STRUCTURED_OUTPUT_MODES,
  resolveStructuredOutputMode,
  getStructuredOutputAttemptModes,
  isUnsupportedJsonModeError,
  parsePossiblyMalformedJSON,
} from "../../../../shared/structured-output.mjs";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "google/gemini-2.5-pro-preview";
const DEFAULT_REQUEST_TIMEOUT_MS = parseInt(process.env.ORCHESTRATOR_TIMEOUT_MS || "120000", 10);
const DEFAULT_STRUCTURED_OUTPUT_MODE = resolveStructuredOutputMode(
  undefined,
  process.env.ORCHESTRATOR_STRUCTURED_OUTPUT_MODE,
  STRUCTURED_OUTPUT_MODES.PROMPT_ONLY,
);
const structuredOutputCapabilityCache = new Map();

export async function chat(messages, { temperature = 0.3, logStep = "orchestrator", requestTimeoutMs, responseFormatType } = {}) {
  const BASE_URL = process.env.ORCHESTRATOR_BASE_URL || DEFAULT_BASE_URL;
  const API_KEY = process.env.ORCHESTRATOR_API_KEY || "";
  const MODEL = process.env.ORCHESTRATOR_MODEL || DEFAULT_MODEL;
  const timeoutMs =
    Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;

  const promptSummary = messages.map((m) => `[${m.role}] ${m.content.slice(0, 500)}`).join("\n");
  logModelCall(logStep, MODEL, promptSummary);

  async function sendRequest() {
    const body = {
      model: MODEL,
      messages,
      temperature,
    };
    if (responseFormatType) {
      body.response_format = { type: responseFormatType };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(`Orchestrator API error ${res.status}: ${err}`);
        logError(logStep, error);
        throw error;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      logModelResponse(logStep, MODEL, text);
      return text;
    } catch (e) {
      if (e.name === "AbortError") {
        const error = new Error(`Orchestrator request timed out after ${timeoutMs / 1000}s`);
        logError(logStep, error);
        throw error;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return sendRequest();
}

export async function chatJSON(messages, opts = {}) {
  const structuredOutputMode = resolveStructuredOutputMode(
    opts.structuredOutputMode,
    process.env.ORCHESTRATOR_STRUCTURED_OUTPUT_MODE,
    DEFAULT_STRUCTURED_OUTPUT_MODE,
  );
  const baseURL = process.env.ORCHESTRATOR_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.ORCHESTRATOR_MODEL || DEFAULT_MODEL;
  const capabilityKey = `${baseURL}::${model}`;

  let lastError = null;
  const retries = opts.jsonRetries ?? parseInt(process.env.ORCHESTRATOR_JSON_RETRIES || "3", 10);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const attemptModes = getStructuredOutputAttemptModes(
      structuredOutputMode,
      structuredOutputCapabilityCache.get(capabilityKey),
    );

    for (const mode of attemptModes) {
      try {
        const raw = await chat(messages, {
          ...opts,
          responseFormatType:
            mode === STRUCTURED_OUTPUT_MODES.JSON_OBJECT ? "json_object" : undefined,
        });
        return parsePossiblyMalformedJSON(raw);
      } catch (error) {
        lastError = error;

        if (
          mode === STRUCTURED_OUTPUT_MODES.JSON_OBJECT &&
          isUnsupportedJsonModeError(error)
        ) {
          structuredOutputCapabilityCache.set(
            capabilityKey,
            STRUCTURED_OUTPUT_MODES.PROMPT_ONLY,
          );
          if (structuredOutputMode === STRUCTURED_OUTPUT_MODES.AUTO) {
            console.warn(
              `[${opts.logStep || "orchestrator"}] json_object unsupported, falling back to prompt-only JSON.`,
            );
            continue;
          }
        }

        if (
          structuredOutputMode === STRUCTURED_OUTPUT_MODES.AUTO &&
          mode === STRUCTURED_OUTPUT_MODES.JSON_OBJECT &&
          attemptModes.includes(STRUCTURED_OUTPUT_MODES.PROMPT_ONLY)
        ) {
          console.warn(
            `[${opts.logStep || "orchestrator"}] structured JSON request failed, retrying with prompt-only JSON.`,
          );
          continue;
        }

        if (attempt < retries) {
          console.warn(
            `[${opts.logStep || "orchestrator"}] JSON parse/request failed on attempt ${attempt}/${retries} (${mode}), retrying...`,
          );
        }
        break;
      }
    }
  }

  throw lastError || new Error("Failed to parse Orchestrator JSON response");
}
