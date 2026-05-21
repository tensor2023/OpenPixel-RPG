import { Router } from "express";
import type { Request, Response } from "express";
import { appContext } from "../../services/app-context.js";
import { CharacterManager } from "../../core/character-manager.js";
import { listPersistedNpcIds, deleteNpcProfileFromDisk } from "./npc-generate.js";
import path from "node:path";
import fs from "node:fs";

const router = Router();

/**
 * GET /api/npc/manage — 列出所有已持久化的NPC（含完整人设）
 */
router.get("/", (_req: Request, res: Response) => {
  const worldDir = appContext.getWorldDir();
  if (!worldDir) {
    return res.json([]);
  }

  const npcsDir = path.join(worldDir, "npcs");
  if (!fs.existsSync(npcsDir)) {
    return res.json([]);
  }

  const files = fs.readdirSync(npcsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return res.json([]);

  const result: Array<Record<string, unknown>> = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(npcsDir, file), "utf-8");
      const profile = JSON.parse(raw) as Record<string, unknown>;
      result.push({
        id: profile.id,
        name: profile.name,
        role: profile.role,
        nickname: profile.nickname,
        appearanceId: profile.appearanceId || null,
        backstory: profile.backstory || "",
        coreMotivation: profile.coreMotivation || "",
        speakingStyle: profile.speakingStyle || "",
        coreValues: profile.coreValues || [],
        fears: profile.fears || [],
        preferredActivities: profile.preferredActivities || [],
        socialStyle: profile.socialStyle || "extrovert",
        personality: profile.personality || "",
      });
    } catch (err) {
      console.warn(`[NPC Manage] Failed to read ${file}:`, err);
    }
  }

  res.json(result);
});

/**
 * DELETE /api/npc/manage/:id — 删除 NPC（磁盘 + 运行时）
 */
router.delete("/:id", (req: Request, res: Response) => {
  const charId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!charId) {
    return res.status(400).json({ error: "Missing NPC id" });
  }

  // Remove from character manager
  const removed = appContext.characterManager.removeDynamicCharacter(charId);

  // Remove from disk
  deleteNpcProfileFromDisk(charId);

  res.json({ ok: true, removed });
});

/**
 * PATCH /api/npc/manage/:id — 更新 NPC 人设字段并持久化
 */
router.patch("/:id", (req: Request, res: Response) => {
  const charId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!charId) {
    return res.status(400).json({ error: "Missing NPC id" });
  }

  const patch = req.body ?? {};
  const allowed = CharacterManager.EDITABLE_FIELDS as readonly string[];
  const unknown = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Non-editable fields: ${unknown.join(", ")}` });
  }

  try {
    const updated = appContext.characterManager.updateDynamicProfile(charId, patch);

    // Persist updated profile to disk
    const worldDir = appContext.getWorldDir();
    if (worldDir) {
      const npcsDir = path.join(worldDir, "npcs");
      fs.mkdirSync(npcsDir, { recursive: true });
      fs.writeFileSync(path.join(npcsDir, `${charId}.json`), JSON.stringify(updated, null, 2));
    }

    res.json({ ok: true, profile: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

export default router;
