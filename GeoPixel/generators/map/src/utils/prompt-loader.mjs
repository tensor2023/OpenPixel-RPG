import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

export function loadPrompt(filename, variables = {}) {
  const raw = readFileSync(join(PROMPTS_DIR, filename), "utf-8");
  let result = raw;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}
