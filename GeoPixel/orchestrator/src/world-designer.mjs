import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeWorldDesign } from "./world-design-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function designWorld(userPrompt) {
  const { chatJSON } = await import("./models/llm-client.mjs");

  const template = readFileSync(join(__dirname, "../prompts/design-world.md"), "utf-8");
  const prompt = template.replace(/\{\{userPrompt\}\}/g, userPrompt);

  console.log("[WorldDesigner] Designing world from prompt...");

  const rawResult = await chatJSON({
    systemMessage: "You are an expert world designer for AI social simulations. Always respond with valid JSON.",
    userMessage: prompt,
    temperature: 0.7,
    maxTokens: 32768,
  });

  if (rawResult?.feasible === false) {
    const reason =
      typeof rawResult?.infeasibleReason === "string" && rawResult.infeasibleReason.trim()
        ? rawResult.infeasibleReason.trim()
        : "当前需求超出生成上限";
    const suggestions = Array.isArray(rawResult?.adjustmentSuggestions)
      ? rawResult.adjustmentSuggestions.filter((item) => typeof item === "string" && item.trim())
      : [];
    const suggestionText = suggestions.length
      ? ` Suggestions: ${suggestions.map((item) => item.trim()).join("；")}`
      : "";
    throw new Error(`无法生成该世界：${reason}.${suggestionText}`.trim());
  }

  const result = normalizeWorldDesign(rawResult);

  if (
    !result.worldName ||
    !result.mapDescription ||
    !result.characters?.length ||
    !result.worldActions?.length
  ) {
    throw new Error("WorldDesigner returned incomplete design");
  }

  const locationLikeCount =
    (Array.isArray(result.regions) ? result.regions.length : 0) +
    (Array.isArray(result.interactiveElements) ? result.interactiveElements.length : 0);

  if (result.characters.length > 8) {
    throw new Error(
      `无法生成该世界：角色数量超出上限（${result.characters.length}/8）。请减少角色数量后重试。`,
    );
  }

  if (locationLikeCount > 8) {
    throw new Error(
      `无法生成该世界：可行走区域与可交互元素总数超出上限（${locationLikeCount}/8）。请减少功能区或可交互元素数量后重试。`,
    );
  }

  console.log(`[WorldDesigner] Designed world: "${result.worldName}"`);
  console.log(`  Characters: ${result.characters.length}`);
  console.log(`  Regions: ${result.regions?.length || 0}`);
  console.log(`  World actions: ${result.worldActions?.length || 0}`);
  console.log(`  Scene type: ${result.sceneType}`);

  return result;
}
