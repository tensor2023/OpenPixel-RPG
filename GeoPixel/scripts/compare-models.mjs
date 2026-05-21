import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const BASE_URL = process.env.ORCHESTRATOR_BASE_URL || "https://openrouter.ai/api/v1";
const API_KEY = process.env.ORCHESTRATOR_API_KEY || "";
const TIMEOUT_MS = parseInt(process.env.ORCHESTRATOR_TIMEOUT_MS || "30000", 10);

const MODELS = ["doubao-seed-2.0-pro", "ark-code-latest"];

const plainMessages = [
  {
    role: "system",
    content: "You are a concise assistant.",
  },
  {
    role: "user",
    content: "Reply in exactly one line: MODEL_OK",
  },
];

const jsonMessages = [
  {
    role: "system",
    content: "You are a precise assistant. Return valid JSON only.",
  },
  {
    role: "user",
    content:
      'Return exactly one JSON object with keys "status" and "numbers", where status is "ok" and numbers is [1,2,3].',
  },
];

async function main() {
  if (!API_KEY) {
    console.error("Missing ORCHESTRATOR_API_KEY in .env");
    process.exit(1);
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms`);
  console.log("");

  for (const model of MODELS) {
    console.log(`=== ${model} ===`);
    const plainResult = await callModel({
      model,
      messages: plainMessages,
      jsonMode: false,
      label: "plain_text",
    });
    printResult(plainResult);

    const jsonResult = await callModel({
      model,
      messages: jsonMessages,
      jsonMode: true,
      label: "json_mode",
    });
    printResult(jsonResult);

    console.log("");
  }
}

async function callModel({ model, messages, jsonMode, label }) {
  const body = {
    model,
    messages,
    temperature: 0,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

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

    const elapsedMs = Date.now() - startedAt;
    const text = await res.text();

    if (!res.ok) {
      return {
        label,
        ok: false,
        status: res.status,
        elapsedMs,
        summary: summarize(text),
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        label,
        ok: false,
        status: res.status,
        elapsedMs,
        summary: `Non-JSON HTTP body: ${summarize(text)}`,
      };
    }

    const content = parsed?.choices?.[0]?.message?.content ?? "";
    return {
      label,
      ok: true,
      status: res.status,
      elapsedMs,
      summary: summarize(typeof content === "string" ? content : JSON.stringify(content)),
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message =
      error?.name === "AbortError"
        ? `Request timed out after ${TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error);

    return {
      label,
      ok: false,
      status: "ERR",
      elapsedMs,
      summary: summarize(message),
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(text) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, 220);
}

function printResult(result) {
  console.log(
    `[${result.label}] status=${result.status} ok=${result.ok} elapsed=${result.elapsedMs}ms`,
  );
  console.log(`  ${result.summary}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
