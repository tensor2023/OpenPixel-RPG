import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

let logFilePath = null;

/**
 * Initialize the pipeline logger. Call once at the start of a run.
 * @param {string} logDir - directory for pipeline logs
 * @param {string} fileName - log file name
 */
export function initLogger(logDir, fileName = "pipeline.log") {
  mkdirSync(logDir, { recursive: true });
  logFilePath = join(logDir, fileName);
  writeFileSync(logFilePath, `=== Pipeline Log — ${new Date().toISOString()} ===\n\n`);
}

/**
 * Append a log entry.
 * @param {string} step - e.g. "Step 3", "gemini-pro"
 * @param {string} event - e.g. "request", "response", "error"
 * @param {string|object} data - text or object to log
 */
export function log(step, event, data) {
  if (!logFilePath) return;
  const ts = new Date().toISOString();
  let body;
  if (typeof data === "string") {
    body = data;
  } else {
    try {
      body = JSON.stringify(data, null, 2);
    } catch {
      body = String(data);
    }
  }
  const entry = `[${ts}] [${step}] ${event}\n${body}\n\n`;
  try {
    appendFileSync(logFilePath, entry);
  } catch {
    // silently ignore write errors to not break the pipeline
  }
}

/**
 * Log a model call with prompt text and image references.
 */
export function logModelCall(step, model, promptText, imageRefs = []) {
  const imgInfo = imageRefs.length > 0
    ? `\nImages: ${imageRefs.join(", ")}`
    : "";
  log(step, `→ ${model} request`, `Prompt (${promptText.length} chars):\n${promptText}${imgInfo}`);
}

/**
 * Log a model response (text).
 */
export function logModelResponse(step, model, responseText) {
  log(step, `← ${model} response`, `Response (${responseText.length} chars):\n${responseText}`);
}

/**
 * Log a model response that is an image saved to disk.
 */
export function logModelImageResponse(step, model, savedPath, sizeBytes) {
  log(step, `← ${model} image response`, `Saved to: ${savedPath} (${sizeBytes} bytes)`);
}

/**
 * Log an error.
 */
export function logError(step, error) {
  log(step, "ERROR", `${error.message}\n${error.stack || ""}`);
}
