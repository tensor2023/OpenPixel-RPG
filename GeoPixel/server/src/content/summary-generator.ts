import type { ContentCandidate } from "../types/index.js";
import type { LLMClient } from "../llm/llm-client.js";
import { generateId } from "../utils/id-generator.js";
import * as eventStore from "../store/event-store.js";
import * as contentStore from "../store/content-store.js";
import { z } from "zod";

const DailySummarySchema = z.object({
  summary: z
    .array(z.string().min(5))
    .min(1)
    .max(8)
    .describe("每日速报条目，3-5条"),
});

const CharacterWeeklySchema = z.object({
  summary: z.string().min(20).describe("角色周报内容"),
});

export async function generateDailySummary(
  gameDay: number,
  llmClient: LLMClient,
): Promise<ContentCandidate> {
  const highlightEvents = eventStore
    .queryEvents({
      fromDay: gameDay,
      toDay: gameDay,
      minDramScore: 3,
      limit: 30,
    })
    .filter((e) => e.type !== "dialogue" || e.data?.phase !== "turn");

  const eventDescriptions = highlightEvents.map((e) => {
    const tick = `Tick ${e.gameTick}`;
    const loc = e.location;
    const actors = [e.actorId, e.targetId].filter(Boolean).join(" & ");
    let desc = `[${tick} @ ${loc}] ${e.type}`;
    if (actors) desc += ` (${actors})`;

    if (
      e.type === "dialogue" &&
      e.data?.phase !== "turn" &&
      Array.isArray(e.data?.turns)
    ) {
      const preview = e.data.turns
        .slice(0, 2)
        .map((t: any) => `${t.speaker}: ${t.content}`)
        .join(" / ");
      desc += ` — ${preview}`;
    } else if (e.data?.description) {
      desc += ` — ${e.data.description}`;
    }

    return desc;
  });

  const prompt =
    `你是迷雾镇的播报员。请根据以下第 ${gameDay} 天的事件，生成一份简短的每日速报（3-5 条）。\n` +
    `每条速报应简洁有趣，突出戏剧性和人际关系动态。\n\n` +
    `事件列表：\n${eventDescriptions.join("\n")}\n\n` +
    `请以JSON格式返回：{ "summary": ["条目1", "条目2", ...] }`;

  const result = await llmClient.call({
    messages: [{ role: "user", content: prompt }],
    schema: DailySummarySchema,
    options: { taskType: "summary" },
  });

  const content = result.data.summary.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const candidate: ContentCandidate = {
    id: generateId(),
    eventId: "",
    type: "summary",
    dramScore: 0,
    content,
    context: `Day ${gameDay} 每日速报`,
    tags: ["summary", "daily", `day_${gameDay}`],
    reviewed: false,
  };

  contentStore.insertCandidate(candidate);
  return candidate;
}

export async function generateCharacterWeekly(
  charId: string,
  fromDay: number,
  toDay: number,
  llmClient: LLMClient,
): Promise<ContentCandidate> {
  const events = eventStore
    .queryEvents({
      fromDay,
      toDay,
      actorId: charId,
      limit: 50,
    })
    .filter((e) => e.type !== "dialogue" || e.data?.phase !== "turn");

  const eventDescriptions = events.map((e) => {
    const day = `Day ${e.gameDay}`;
    const tick = `Tick ${e.gameTick}`;
    let desc = `[${day} ${tick}] ${e.type}`;
    if (e.targetId) desc += ` → ${e.targetId}`;

    if (
      e.type === "dialogue" &&
      e.data?.phase !== "turn" &&
      Array.isArray(e.data?.turns)
    ) {
      const preview = e.data.turns
        .slice(0, 2)
        .map((t: any) => `${t.speaker}: ${t.content}`)
        .join(" / ");
      desc += ` — ${preview}`;
    } else if (e.data?.content) {
      desc += ` — ${String(e.data.content).slice(0, 60)}`;
    }

    return desc;
  });

  const prompt =
    `你是迷雾镇的观察者。请为角色 ${charId} 生成第 ${fromDay}~${toDay} 天的周报。\n` +
    `内容应覆盖该角色这段时间的主要经历、情感变化和社交动态。\n\n` +
    `事件列表：\n${eventDescriptions.join("\n")}\n\n` +
    `请以JSON格式返回：{ "summary": "周报内容..." }`;

  const result = await llmClient.call({
    messages: [{ role: "user", content: prompt }],
    schema: CharacterWeeklySchema,
    options: { taskType: "summary", characterId: charId },
  });

  const candidate: ContentCandidate = {
    id: generateId(),
    eventId: "",
    type: "summary",
    dramScore: 0,
    content: result.data.summary,
    characterId: charId,
    context: `${charId} 周报 Day ${fromDay}-${toDay}`,
    tags: ["summary", "weekly", charId],
    reviewed: false,
  };

  contentStore.insertCandidate(candidate);
  return candidate;
}
