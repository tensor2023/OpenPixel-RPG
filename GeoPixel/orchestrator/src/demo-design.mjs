#!/usr/bin/env node
/**
 * Quick demo: call the design-world LLM and print raw + normalized output.
 * Usage: node orchestrator/src/demo-design.mjs "你的世界描述"
 */
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
dotenv.config({ path: join(ROOT, ".env") });

const { chat } = await import("./models/llm-client.mjs");
const { normalizeWorldDesign } = await import("./world-design-utils.mjs");

const userPrompt = process.argv.slice(2).join(" ") ||
  "北宋汴京的一条夜市街，有卖炊饼的、算命的、当铺掌柜、捕快和一个穿越来的现代人";

const template = readFileSync(join(__dirname, "../prompts/design-world.md"), "utf-8");
const prompt = template.replace(/\{\{userPrompt\}\}/g, userPrompt);

console.log("━━━ Calling LLM ━━━");
console.log(`Prompt: ${userPrompt}\n`);

const raw = await chat(
  [
    { role: "system", content: "You are an expert world designer for AI social simulations. Always respond with valid JSON." },
    { role: "user", content: prompt },
  ],
  { temperature: 0.7, logStep: "demo" },
);

console.log("\n━━━ Raw LLM output ━━━");
console.log(raw);

try {
  const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
  console.log("\n━━━ Parsed timeConfig ━━━");
  console.log(JSON.stringify(parsed.timeConfig, null, 2));
  console.log("\n━━━ Parsed sceneType ━━━");
  console.log(parsed.sceneType);

  const normalized = normalizeWorldDesign(parsed);
  console.log("\n━━━ Normalized timeConfig ━━━");
  console.log(JSON.stringify(normalized.timeConfig, null, 2));
} catch (e) {
  console.error("\nJSON parse failed:", e.message);
  console.log("(raw output printed above for inspection)");
}
