import { Router } from "express";
import type { Request, Response } from "express";
import { appContext } from "../../services/app-context.js";
import * as eventStore from "../../store/event-store.js";
import { generateId } from "../../utils/id-generator.js";
import type { SimulationEvent, MemoryType } from "../../types/index.js";

const router = Router();

/**
 * POST /api/god/broadcast
 * body: { content: string, scope?: "global" | "location:<id>", tone?: string, tags?: string[] }
 *
 * 向整个世界（或指定地点）注入一条 event_triggered，让所有感知范围内的角色下一次
 * decision / dialogue 都能看到"[广播] <content>"。可选：向每个在范围内的角色补写一条
 * 低重要性 observation 记忆，方便日后回忆。
 */
router.post("/broadcast", (req: Request, res: Response) => {
  const { content, scope, tone, tags, writeMemory } = req.body ?? {};

  if (typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "content is required" });
  }

  const trimmed = content.trim();
  const rawScope = typeof scope === "string" && scope.trim().length > 0 ? scope.trim() : "global";
  const location = rawScope === "global" ? "global" : rawScope.startsWith("location:")
    ? rawScope.slice("location:".length)
    : rawScope;

  const gameTime = appContext.worldManager.getCurrentTime();

  const event: SimulationEvent = {
    id: generateId(),
    gameDay: gameTime.day,
    gameTick: gameTime.tick,
    type: "event_triggered",
    location,
    data: {
      description: trimmed,
      source: "god",
      tone: typeof tone === "string" ? tone : undefined,
    },
    tags: Array.isArray(tags) ? ["god", "broadcast", ...tags.filter((t: unknown): t is string => typeof t === "string")] : ["god", "broadcast"],
  };

  eventStore.appendEvent(event);
  appContext.eventBus.emit("tick_events", { gameTime, events: [event] });

  let memoryCount = 0;
  if (writeMemory !== false) {
    const profiles = appContext.characterManager.getAllProfiles();
    for (const p of profiles) {
      if (location !== "global") {
        const s = appContext.characterManager.getState(p.id);
        if (s.location !== location) continue;
      }
      appContext.characterManager.memoryManager.addMemory({
        characterId: p.id,
        type: "observation",
        content: `[广播] ${trimmed}`,
        gameTime,
        importance: 5,
        emotionalValence: 0,
        emotionalIntensity: 2,
        tags: ["god", "broadcast"],
      });
      memoryCount += 1;
    }
  }

  res.json({
    ok: true,
    event,
    memoryWrittenTo: memoryCount,
  });
});

/**
 * POST /api/god/whisper
 * body: { characterId: string, content: string, importance?: number, type?: MemoryType, tags?: string[] }
 *
 * 向指定角色耳语 / 托梦，新增一条记忆。默认 type="observation"，importance=8。
 */
router.post("/whisper", (req: Request, res: Response) => {
  const { characterId, content, importance, type, tags, emotionalValence, emotionalIntensity } =
    req.body ?? {};

  if (typeof characterId !== "string" || characterId.trim().length === 0) {
    return res.status(400).json({ error: "characterId is required" });
  }
  if (typeof content !== "string" || content.trim().length === 0) {
    return res.status(400).json({ error: "content is required" });
  }

  try {
    appContext.characterManager.getProfile(characterId);
  } catch {
    return res.status(404).json({ error: "character not found" });
  }

  const gameTime = appContext.worldManager.getCurrentTime();
  const memoryType: MemoryType =
    type === "dream" || type === "reflection" || type === "experience" || type === "observation"
      ? type
      : "observation";
  const safeImportance =
    typeof importance === "number" && importance >= 1 && importance <= 10
      ? Math.round(importance)
      : 8;

  const memory = appContext.characterManager.memoryManager.addMemory({
    characterId,
    type: memoryType,
    content: content.trim(),
    gameTime,
    importance: safeImportance,
    emotionalValence: typeof emotionalValence === "number" ? emotionalValence : 0,
    emotionalIntensity: typeof emotionalIntensity === "number" ? emotionalIntensity : 4,
    tags: Array.isArray(tags)
      ? ["god", "whisper", ...tags.filter((t: unknown): t is string => typeof t === "string")]
      : ["god", "whisper"],
  });

  res.json({ ok: true, memory });
});

export default router;
