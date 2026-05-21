import fs from "node:fs";
import path from "node:path";
import { Router, type Response } from "express";
import { appContext } from "../../services/app-context.js";
import {
  getActiveSimulationTicks,
  getSimulationBusyMessage,
  isSimulationBusy,
} from "../../services/simulation-activity.js";
import { buildSceneRuntimeInfo, buildWorldTimeInfo } from "../../utils/time-helpers.js";
import * as worldStateStore from "../../store/world-state-store.js";
import {
  GENERATED_WORLDS_DIR,
  LIBRARY_WORLDS_DIR,
  listGeneratedWorlds,
  listLibraryWorlds,
  findWorldById,
} from "../../utils/world-directories.js";
import { getWorldNews } from "../../utils/world-news-injector.js";

const router = Router();

function rejectIfSimulationBusy(res: Response): boolean {
  if (!isSimulationBusy()) return false;
  res.status(409).json({
    error: getSimulationBusyMessage(),
    activeSimulationTicks: getActiveSimulationTicks(),
    canSwitchContext: false,
  });
  return true;
}

router.get("/time", (_req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  res.json(buildWorldTimeInfo(appContext.worldManager.getCurrentTime()));
});

router.get("/info", (_req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  const wm = appContext.worldManager;
  const currentWorldDir = appContext.getWorldDir();
  res.json({
    worldName: wm.getWorldName(),
    worldDescription: wm.getWorldDescription(),
    originalPrompt: wm.getOriginalPrompt(),
    currentWorldId: currentWorldDir ? path.basename(currentWorldDir) : null,
    currentTimelineId: appContext.timelineManager.getCurrentTimelineId(),
    sceneConfig: wm.getSceneConfig(),
    sceneRuntime: buildSceneRuntimeInfo(wm.getSceneConfig()),
    worldActions: wm.getWorldActions(),
    mainAreaPoints: wm.getMainAreaPoints(),
    worldSize: wm.getWorldSize(),
    mainAreaDialogueRadiusPx: wm.getMainAreaDialogueDistanceThreshold(),
    timelineTickCount: appContext.timelineManager.getTickCount(),
  });
});

router.post("/dev/tick-duration", (req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }

  const tickDurationMinutes = Number(req.body?.tickDurationMinutes);
  if (![15, 30, 60].includes(tickDurationMinutes)) {
    res.status(400).json({ error: "tickDurationMinutes must be one of 15, 30, 60" });
    return;
  }
  if (rejectIfSimulationBusy(res)) return;

  appContext.setDevTickDurationMinutes(tickDurationMinutes);
  const wm = appContext.worldManager;
  res.json({
    ok: true,
    gameTime: buildWorldTimeInfo(wm.getCurrentTime(), wm.getSceneConfig()),
    sceneConfig: wm.getSceneConfig(),
    sceneRuntime: buildSceneRuntimeInfo(wm.getSceneConfig()),
  });
});

router.get("/worlds", (_req, res) => {
  const currentWorldDir = appContext.getWorldDir();
  const currentWorldId = currentWorldDir ? path.basename(currentWorldDir) : null;

  const mapWorld = (world: { id: string; worldName: string; dir: string; source: string }) => ({
    id: world.id,
    worldName: world.worldName,
    source: world.source,
    isCurrent: world.id === currentWorldId,
    timelineCount: appContext.timelineManager.listTimelines(world.dir).length,
  });

  res.json({
    currentWorldId,
    currentTimelineId: appContext.timelineManager.getCurrentTimelineId(),
    worlds: listGeneratedWorlds().map(mapWorld),
    libraryWorlds: listLibraryWorlds().map(mapWorld),
  });
});

router.post("/select", (req, res) => {
  const worldId = typeof req.body?.worldId === "string" ? req.body.worldId : "";
  if (!worldId) {
    res.status(400).json({ error: "worldId is required" });
    return;
  }

  const world = findWorldById(worldId);
  if (!world) {
    res.status(404).json({ error: "World not found" });
    return;
  }
  if (rejectIfSimulationBusy(res)) return;

  appContext.switchWorld(world.dir);
  res.json({
    ok: true,
    currentWorldId: world.id,
    worldName: world.worldName,
  });
});

router.delete("/worlds/:worldId", (req, res) => {
  const worldId = String(req.params.worldId);
  if (!worldId || worldId.includes("..") || worldId.includes("/") || worldId.includes("\\")) {
    res.status(400).json({ error: "Invalid world id" });
    return;
  }

  const world = findWorldById(worldId);
  if (!world) {
    res.status(404).json({ error: "World not found" });
    return;
  }

  if (world.source === "library") {
    res.status(403).json({ error: "Sample worlds cannot be deleted" });
    return;
  }

  const resolvedDir = path.resolve(world.dir);
  const resolvedRoot = path.resolve(GENERATED_WORLDS_DIR);
  if (!resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) {
    res.status(400).json({ error: "World path is outside the generated worlds directory" });
    return;
  }

  const currentWorldDir = appContext.getWorldDir();
  if (currentWorldDir && path.resolve(currentWorldDir) === resolvedDir) {
    res.status(409).json({
      error: "Cannot delete the currently active world. Switch to another world first.",
    });
    return;
  }

  try {
    fs.rmSync(resolvedDir, { recursive: true, force: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to delete world: ${message}` });
    return;
  }

  res.json({ ok: true, deletedWorldId: worldId });
});

router.get("/news", (_req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  const worldDir = appContext.getWorldDir()!;
  const worldName = appContext.worldManager.getWorldName();
  getWorldNews(worldDir, worldName)
    .then((items) => res.json({ worldName, items }))
    .catch((e) => res.status(500).json({ error: String(e) }));
});

router.get("/locations", (_req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  res.json(appContext.worldManager.getAllLocations());
});

router.get("/locations/:id/state", (req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  const loc = appContext.worldManager.getLocation(req.params.id);
  if (!loc) {
    res.status(404).json({ error: "Location not found" });
    return;
  }

  const objects = appContext.worldManager.getLocationObjects(loc.id);
  const chars = appContext.characterManager.getCharactersAtLocation(loc.id);

  res.json({
    location: loc,
    objects: objects.map((o) => ({
      objectId: o.objectId,
      state: o.state,
      stateDescription: o.stateDescription,
      currentUsers: o.currentUsers,
    })),
    characters: chars.map((c) => ({
      id: c.profile.id,
      name: c.profile.name,
      action: c.state.currentAction,
    })),
  });
});

router.get("/global-state", (_req, res) => {
  if (!appContext.hasWorld) {
    res.status(503).json({ error: "No world loaded" });
    return;
  }
  res.json(worldStateStore.getAllGlobalState());
});

export default router;
