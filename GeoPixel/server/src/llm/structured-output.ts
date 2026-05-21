export type StructuredOutputMode = "auto" | "json_object" | "prompt_only";

export function resolveStructuredOutputMode(
  explicitMode?: string,
  envMode?: string,
  fallback: StructuredOutputMode = "auto",
): StructuredOutputMode {
  const requested = (explicitMode || envMode || fallback || "").toLowerCase();
  if (
    requested === "auto" ||
    requested === "json_object" ||
    requested === "prompt_only"
  ) {
    return requested;
  }
  return fallback;
}

export function getStructuredOutputAttemptModes(
  mode: StructuredOutputMode,
  capabilityHint?: StructuredOutputMode,
): StructuredOutputMode[] {
  if (mode === "json_object") return ["json_object"];
  if (mode === "prompt_only") return ["prompt_only"];
  if (capabilityHint === "prompt_only") return ["prompt_only"];
  return ["json_object", "prompt_only"];
}

export function isUnsupportedJsonModeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("response_format.type") &&
    message.includes("json_object") &&
    (message.includes("not supported") || message.includes("not valid"))
  );
}

export function parsePossiblyMalformedJSON(raw: string): unknown {
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
      // Try next candidate.
    }
  }

  throw new Error(`Failed to parse JSON response: ${raw.slice(0, 500)}`);
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJSONObject(text: string): string | null {
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

function cleanupTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function escapeControlCharsInStrings(text: string): string {
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
