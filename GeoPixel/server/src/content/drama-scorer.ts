import type { SimulationEvent, ContentCandidate } from "../types/index.js";
import type { CharacterManager } from "../core/character-manager.js";
import { generateId } from "../utils/id-generator.js";
import * as contentStore from "../store/content-store.js";

const TAG_SCORES: Record<string, number> = {
  confession: 3,
  betrayal: 3,
  romance: 2,
  conflict: 2,
  mystery: 2,
  fourth_wall: 4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateDramScore(
  event: SimulationEvent,
  _characterManager: CharacterManager,
): number {
  let score = 0;

  switch (event.type) {
    case "dialogue": {
      if (event.data?.phase === "turn") {
        score = 0;
        break;
      }
      score = 3;
      for (const tag of event.tags) {
        if (TAG_SCORES[tag]) score += TAG_SCORES[tag];
      }
      const turns = event.data?.turns;
      if (Array.isArray(turns)) {
        const speakers = new Set(turns.map((t: any) => t.speaker));
        if (speakers.size > 2) score += 1;
      }
      break;
    }

    case "emotion_shift": {
      score = 1;
      const intensity = event.data?.emotionalIntensity ?? event.data?.value;
      if (typeof intensity === "number" && intensity >= 7) score += 2;
      break;
    }

    case "event_triggered": {
      score = 5;
      break;
    }

    default: {
      score = event.tags.length > 0 ? 1 : 0;
      break;
    }
  }

  return clamp(score, 0, 10);
}

export function flagHighDramaEvents(
  events: SimulationEvent[],
  threshold: number = 6.0,
): void {
  for (const event of events) {
    if (event.dramScore === undefined) continue;
    if (event.dramScore < threshold) continue;

    const candidate: ContentCandidate = {
      id: generateId(),
      eventId: event.id,
      type: "highlight",
      dramScore: event.dramScore,
      content: summarizeEvent(event),
      characterId: event.actorId,
      context: `Day ${event.gameDay} Tick ${event.gameTick} @ ${event.location}`,
      tags: [...event.tags],
      reviewed: false,
    };

    contentStore.insertCandidate(candidate);
  }
}

function summarizeEvent(event: SimulationEvent): string {
  switch (event.type) {
    case "dialogue": {
      if (event.data?.phase === "turn") {
        const turn = event.data?.turns?.[0];
        if (turn?.content) {
          return `[对话进行中] ${turn.speaker}: ${turn.content}`;
        }
        return `[对话进行中] ${event.actorId} → ${event.targetId}`;
      }
      const turns = event.data?.turns;
      if (Array.isArray(turns) && turns.length > 0) {
        const preview = turns
          .slice(0, 3)
          .map((t: any) => `${t.speaker}: ${t.content}`)
          .join("\n");
        return preview + (turns.length > 3 ? "\n..." : "");
      }
      return `[对话事件] ${event.actorId} → ${event.targetId}`;
    }
    case "event_triggered":
      return event.data?.description ?? event.data?.name ?? "[叙事事件]";
    default:
      return `[${event.type}] ${JSON.stringify(event.data).slice(0, 120)}`;
  }
}
