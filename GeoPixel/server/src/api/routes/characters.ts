import { Router } from "express";
import type { Request, Response } from "express";
import { appContext } from "../../services/app-context.js";
import { getEmotionLabel } from "../../core/emotion-manager.js";
import { CharacterManager } from "../../core/character-manager.js";
import { resolveActionLabel } from "../../utils/action-labels.js";
import { getAllAppearanceIds } from "./npc-generate.js";

const router = Router();

// GET /characters
router.get("/", (_req, res) => {
  const profiles = appContext.characterManager.getAllProfiles();
  const result = profiles.map((p) => {
    const s = appContext.characterManager.getState(p.id);
    const currentActionLabel = resolveActionLabel({
      actionId: s.currentAction,
      targetId: s.currentActionTarget,
      locationId: s.location,
      getWorldAction: (actionId) => appContext.worldManager.getWorldAction(actionId),
      getLocationObjects: (locationId) => appContext.worldManager.getLocationObjects(locationId),
    });
    return {
      id: p.id,
      name: p.name,
      role: p.role,
      nickname: p.nickname,
      location: s.location,
      mainAreaPointId: s.mainAreaPointId,
      emotion: getEmotionLabel(s.emotionValence, s.emotionArousal),
      currentAction: s.currentAction,
      currentActionLabel,
      anchor: p.anchor || null,
      appearanceId: p.appearanceId || null,
    };
  });
  res.json(result);
});

// GET /appearances — 预置外观列表（客户端用于预加载精灵图）
router.get("/appearances", (_req, res) => {
  res.json(getAllAppearanceIds());
});

// GET /characters/:id
router.get("/:id", (req, res) => {
  try {
    const profile = appContext.characterManager.getProfile(req.params.id);
    const state = appContext.characterManager.getState(req.params.id);
    const currentActionLabel = resolveActionLabel({
      actionId: state.currentAction,
      targetId: state.currentActionTarget,
      locationId: state.location,
      getWorldAction: (actionId) => appContext.worldManager.getWorldAction(actionId),
      getLocationObjects: (locationId) => appContext.worldManager.getLocationObjects(locationId),
    });
    res.json({
      profile,
      state: {
        ...state,
        currentActionLabel,
      },
      emotionLabel: getEmotionLabel(state.emotionValence, state.emotionArousal),
    });
  } catch {
    res.status(404).json({ error: "Character not found" });
  }
});

// GET /characters/:id/diary
router.get("/:id/diary", (req, res) => {
  const gameDay = req.query.day ? Number(req.query.day) : undefined;
  const entries = appContext.characterManager.getDiaryEntries(
    req.params.id,
    gameDay,
  );
  res.json(entries);
});

// PATCH /characters/:id/profile
router.patch("/:id/profile", (req: Request, res: Response) => {
  const charId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    appContext.characterManager.getProfile(charId);
  } catch {
    return res.status(404).json({ error: "Character not found" });
  }
  const patch = req.body ?? {};
  const allowed = CharacterManager.EDITABLE_FIELDS as readonly string[];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Non-editable fields: ${unknown.join(", ")}` });
  }
  const updated = appContext.characterManager.patchProfile(charId, patch);
  res.json({ ok: true, profile: updated });
});

// PATCH /characters/:id/runtime-state
router.patch("/:id/runtime-state", (req: Request, res: Response) => {
  const charId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    appContext.characterManager.getProfile(charId);
  } catch {
    return res.status(404).json({ error: "Character not found" });
  }

  const { mainAreaPointId } = req.body ?? {};
  if (mainAreaPointId !== undefined && mainAreaPointId !== null && typeof mainAreaPointId !== "string") {
    return res.status(400).json({ error: "mainAreaPointId must be a string or null" });
  }

  appContext.characterManager.updateState(charId, {
    mainAreaPointId: mainAreaPointId ?? null,
  });
  const state = appContext.characterManager.getState(charId);
  res.json({ ok: true, state });
});

// GET /characters/:id/memories — public memories (limited, excludes internal tags)
router.get("/:id/memories", (req, res) => {
  const memories = appContext.characterManager.memoryManager.getRecentMemories(
    req.params.id,
    20,
  );
  const result = memories.map((m) => ({
    content: m.content,
    gameDay: m.gameDay,
    type: m.type,
  }));
  res.json(result);
});

export default router;
