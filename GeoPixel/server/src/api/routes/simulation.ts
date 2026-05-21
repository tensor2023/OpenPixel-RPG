import path from "node:path";
import { Router, type Request, type Response } from "express";
import { appContext } from "../../services/app-context.js";
import {
  beginSimulationTick,
  getActiveSimulationTicks,
  getSimulationBusyMessage,
  isSimulationBusy,
} from "../../services/simulation-activity.js";
import {
  buildWorldTimeInfo,
  getBatchTicksForOneCycle,
} from "../../utils/time-helpers.js";
import * as eventStore from "../../store/event-store.js";
import { enrichEventTime } from "./events.js";

const router = Router();

type SimStatus = "idle" | "running" | "paused";

let simStatus: SimStatus = "idle";
let simProgress = { current: 0, total: 0 };
let cancelRequested = false;

function getCurrentSimulationContext(): {
  worldId: string | null;
  timelineId: string | null;
} {
  const worldDir = appContext.getWorldDir();
  return {
    worldId: worldDir ? path.basename(worldDir) : null,
    timelineId: appContext.timelineManager.getCurrentTimelineId(),
  };
}

function rejectIfSimulationContextChanged(req: Request, res: Response): boolean {
  const expectedWorldId =
    typeof req.body?.worldId === "string" ? req.body.worldId : "";
  const expectedTimelineId =
    typeof req.body?.timelineId === "string" ? req.body.timelineId : "";
  const current = getCurrentSimulationContext();

  if (!current.worldId || !current.timelineId) {
    res.status(503).json({ error: "No active simulation context" });
    return true;
  }

  if (!expectedWorldId || !expectedTimelineId) {
    res.status(400).json({
      error: "worldId and timelineId are required for simulation ticks.",
      currentWorldId: current.worldId,
      currentTimelineId: current.timelineId,
    });
    return true;
  }

  if (
    expectedWorldId !== current.worldId ||
    expectedTimelineId !== current.timelineId
  ) {
    res.status(409).json({
      error: "Simulation context changed before this tick started. Discarding stale tick request.",
      currentWorldId: current.worldId,
      currentTimelineId: current.timelineId,
    });
    return true;
  }

  return false;
}

async function runGuardedSimulationTick() {
  const finishTick = beginSimulationTick();
  try {
    return await appContext.simulationEngine.simulateTick();
  } finally {
    finishTick();
  }
}

function buildSimulationActivityPayload() {
  const activeSimulationTicks = getActiveSimulationTicks();
  return {
    activeSimulationTicks,
    canSwitchContext: activeSimulationTicks === 0,
  };
}

// POST /simulation/tick — advance 1 tick
router.post("/tick", async (req, res) => {
  if (rejectIfSimulationContextChanged(req, res)) return;

  try {
    simStatus = "running";
    const events = await runGuardedSimulationTick();
    const gameTime = appContext.worldManager.getCurrentTime();
    const worldTime = buildWorldTimeInfo(gameTime);
    const persistedEvents = eventStore
      .getEventsByIds(events.map((event) => event.id))
      .map(enrichEventTime);

    appContext.eventBus.emit("tick_events", { gameTime, events });
    appContext.eventBus.emit("simulation_status", { status: "idle" });

    simStatus = "idle";
    res.json({
      ok: true,
      gameTime: worldTime,
      eventCount: events.length,
      events: persistedEvents,
      ...buildSimulationActivityPayload(),
    });
  } catch (err) {
    simStatus = "idle";
    res.status(500).json({ error: String(err) });
  }
});

// POST /simulation/day — simulate 1 full day
router.post("/day", async (_req, res) => {
  try {
    simStatus = "running";
    cancelRequested = false;
    const currentTime = appContext.worldManager.getCurrentTime();
    const sceneConfig = appContext.worldManager.getSceneConfig();
    const maxTicks = getBatchTicksForOneCycle({
      sceneType: sceneConfig.sceneType,
      startTime: sceneConfig.startTime,
      tickDurationMinutes: sceneConfig.tickDurationMinutes,
      maxTicks: sceneConfig.maxTicks,
      sceneDay: currentTime.day,
      displayFormat: sceneConfig.displayFormat,
      multiDay: sceneConfig.multiDay,
    });
    simProgress = { current: 0, total: maxTicks };

    appContext.eventBus.emit("simulation_status", {
      status: "running",
      progress: simProgress,
    });

    const allEvents: any[] = [];

    for (let i = 0; i < maxTicks; i++) {
      if (cancelRequested) {
        simStatus = "paused";
        appContext.eventBus.emit("simulation_status", { status: "paused" });
        res.json({
          ok: true,
          paused: true,
          gameTime: buildWorldTimeInfo(appContext.worldManager.getCurrentTime()),
          eventCount: allEvents.length,
          ticksCompleted: i,
        });
        return;
      }

      const events = await runGuardedSimulationTick();
      allEvents.push(...events);
      simProgress.current = i + 1;

      const gameTime = appContext.worldManager.getCurrentTime();
      appContext.eventBus.emit("tick_events", { gameTime, events });
    }

    simStatus = "idle";
    appContext.eventBus.emit("simulation_status", { status: "idle" });

    res.json({
      ok: true,
      gameTime: buildWorldTimeInfo(appContext.worldManager.getCurrentTime()),
      eventCount: allEvents.length,
    });
  } catch (err) {
    simStatus = "idle";
    res.status(500).json({ error: String(err) });
  }
});

// POST /simulation/days — simulate N days
router.post("/days", async (req, res) => {
  const count = req.body?.count ?? 1;
  if (typeof count !== "number" || count < 1 || count > 100) {
    res.status(400).json({ error: "count must be 1-100" });
    return;
  }

  try {
    simStatus = "running";
    cancelRequested = false;
    const currentTime = appContext.worldManager.getCurrentTime();
    const sceneConfig = appContext.worldManager.getSceneConfig();
    const maxTicks = getBatchTicksForOneCycle({
      sceneType: sceneConfig.sceneType,
      startTime: sceneConfig.startTime,
      tickDurationMinutes: sceneConfig.tickDurationMinutes,
      maxTicks: sceneConfig.maxTicks,
      sceneDay: currentTime.day,
      displayFormat: sceneConfig.displayFormat,
      multiDay: sceneConfig.multiDay,
    });
    const totalTicks = count * maxTicks;
    simProgress = { current: 0, total: totalTicks };

    appContext.eventBus.emit("simulation_status", {
      status: "running",
      progress: simProgress,
    });

    let totalEvents = 0;

    for (let d = 0; d < count; d++) {
      for (let t = 0; t < maxTicks; t++) {
        if (cancelRequested) {
          simStatus = "paused";
          appContext.eventBus.emit("simulation_status", { status: "paused" });
          res.json({
            ok: true,
            paused: true,
            gameTime: buildWorldTimeInfo(appContext.worldManager.getCurrentTime()),
            eventCount: totalEvents,
            ticksCompleted: simProgress.current,
          });
          return;
        }

        const events = await runGuardedSimulationTick();
        totalEvents += events.length;
        simProgress.current = d * maxTicks + t + 1;

        const gameTime = appContext.worldManager.getCurrentTime();
        appContext.eventBus.emit("tick_events", { gameTime, events });
      }
    }

    simStatus = "idle";
    appContext.eventBus.emit("simulation_status", { status: "idle" });

    res.json({
      ok: true,
      gameTime: buildWorldTimeInfo(appContext.worldManager.getCurrentTime()),
      eventCount: totalEvents,
    });
  } catch (err) {
    simStatus = "idle";
    res.status(500).json({ error: String(err) });
  }
});

// POST /simulation/pause
router.post("/pause", (_req, res) => {
  cancelRequested = true;
  res.json({ ok: true, ...buildSimulationActivityPayload() });
});

// POST /simulation/resume
router.post("/resume", (_req, res) => {
  cancelRequested = false;
  if (simStatus === "paused") simStatus = "idle";
  res.json({ ok: true });
});

// POST /simulation/reset
router.post("/reset", (_req, res) => {
  try {
    if (isSimulationBusy()) {
      res.status(409).json({ error: getSimulationBusyMessage(), ...buildSimulationActivityPayload() });
      return;
    }

    appContext.resetWorldState();
    const gameTime = buildWorldTimeInfo(appContext.worldManager.getCurrentTime());
    simStatus = "idle";
    res.json({ ok: true, gameTime });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /simulation/status
router.get("/status", (_req, res) => {
  const gameTime = buildWorldTimeInfo(appContext.worldManager.getCurrentTime());
  res.json({
    status: simStatus,
    gameTime,
    progress: simStatus === "running" ? simProgress : null,
    ...buildSimulationActivityPayload(),
  });
});

export default router;
