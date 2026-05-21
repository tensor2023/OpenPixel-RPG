import type { SimulationEvent, ContentCandidate } from "../types/index.js";
import type { CharacterManager } from "../core/character-manager.js";
import { generateId } from "../utils/id-generator.js";
import * as contentStore from "../store/content-store.js";

const EMOTION_KEYWORDS = [
  "害怕", "相信", "喜欢", "讨厌", "孤独", "感动", "心痛",
  "温暖", "悲伤", "愤怒", "快乐", "难过", "恐惧", "希望",
  "绝望", "感激", "嫉妒", "惊讶", "厌恶", "思念", "安心",
  "不安", "紧张", "兴奋", "失望", "骄傲", "羞愧", "爱",
];

const PHILOSOPHICAL_KEYWORDS = [
  "为什么", "真相", "意义", "存在", "自由", "命运", "灵魂",
  "记忆", "遗忘", "现实", "虚幻", "迷雾", "真实", "谎言",
  "选择", "代价", "本质", "目的", "觉醒", "永恒",
];

const QUOTE_THRESHOLD = 4;

export function extractQuotes(
  dialogueEvent: SimulationEvent,
  characterManager: CharacterManager,
): ContentCandidate[] {
  if (dialogueEvent.type !== "dialogue") return [];
  if (dialogueEvent.data?.phase === "turn") return [];

  const turns = dialogueEvent.data?.turns;
  if (!Array.isArray(turns)) return [];

  const candidates: ContentCandidate[] = [];

  for (const turn of turns) {
    const text: string = turn.content ?? "";
    const speaker: string = turn.speaker ?? "";
    let score = 0;

    const len = text.length;
    if (len >= 10 && len <= 50) score += 1;

    if (EMOTION_KEYWORDS.some((kw) => text.includes(kw))) score += 2;
    if (PHILOSOPHICAL_KEYWORDS.some((kw) => text.includes(kw))) score += 1;

    if (text.includes("…") || text.includes("...") || text.includes("！") || text.includes("!")) {
      score += 1;
    }

    try {
      const profile = characterManager.getProfile(speaker);
      if (
        profile.tags.includes("philosophical") ||
        profile.tags.includes("emotional")
      ) {
        score += 1;
      }
    } catch {
      // speaker might be a display name
    }

    if (score >= QUOTE_THRESHOLD) {
      const candidate: ContentCandidate = {
        id: generateId(),
        eventId: dialogueEvent.id,
        type: "quote",
        dramScore: score,
        content: text,
        characterId: speaker,
        context: `Day ${dialogueEvent.gameDay} Tick ${dialogueEvent.gameTick} @ ${dialogueEvent.location}`,
        tags: ["quote", ...dialogueEvent.tags],
        reviewed: false,
      };
      candidates.push(candidate);
      contentStore.insertCandidate(candidate);
    }
  }

  return candidates;
}
