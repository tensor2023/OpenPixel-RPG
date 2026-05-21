export const STRUCTURED_OUTPUT_MODES = {
  AUTO: "auto",
  JSON_OBJECT: "json_object",
  PROMPT_ONLY: "prompt_only",
};

export function resolveStructuredOutputMode(explicitMode, envMode, fallback = STRUCTURED_OUTPUT_MODES.AUTO) {
  const requested = (explicitMode || envMode || fallback || "").toLowerCase();
  if (
    requested === STRUCTURED_OUTPUT_MODES.AUTO ||
    requested === STRUCTURED_OUTPUT_MODES.JSON_OBJECT ||
    requested === STRUCTURED_OUTPUT_MODES.PROMPT_ONLY
  ) {
    return requested;
  }
  return fallback;
}

export function getStructuredOutputAttemptModes(mode, capabilityHint) {
  if (mode === STRUCTURED_OUTPUT_MODES.JSON_OBJECT) {
    return [STRUCTURED_OUTPUT_MODES.JSON_OBJECT];
  }
  if (mode === STRUCTURED_OUTPUT_MODES.PROMPT_ONLY) {
    return [STRUCTURED_OUTPUT_MODES.PROMPT_ONLY];
  }
  if (capabilityHint === STRUCTURED_OUTPUT_MODES.PROMPT_ONLY) {
    return [STRUCTURED_OUTPUT_MODES.PROMPT_ONLY];
  }
  return [STRUCTURED_OUTPUT_MODES.JSON_OBJECT, STRUCTURED_OUTPUT_MODES.PROMPT_ONLY];
}

export function isUnsupportedJsonModeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("response_format.type") &&
    message.includes("json_object") &&
    (message.includes("not supported") || message.includes("not valid"))
  );
}

export function stripMarkdownFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractJSONObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return text.slice(start);
}

export function escapeControlCharsInStrings(text) {
  let result = "";
  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaping) {
        result += ch;
        escaping = false;
        continue;
      }

      if (ch === "\\") {
        result += ch;
        escaping = true;
        continue;
      }

      if (ch === "\"") {
        result += ch;
        inString = false;
        continue;
      }

      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }
    } else if (ch === "\"") {
      inString = true;
    }

    result += ch;
  }

  return result;
}

export function cleanupTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

export function parsePossiblyMalformedJSON(raw) {
  const cleaned = stripMarkdownFences(raw);
  const extracted = extractJSONObject(cleaned) || cleaned;
  const candidates = [
    extracted,
    cleanupTrailingCommas(extracted),
    escapeControlCharsInStrings(extracted),
    cleanupTrailingCommas(escapeControlCharsInStrings(extracted)),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate
    }
  }

  throw new Error(`Failed to parse JSON response: ${raw.slice(0, 500)}`);
}
