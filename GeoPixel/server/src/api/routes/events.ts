import { Router } from "express";
import * as eventStore from "../../store/event-store.js";
import type { SimEventType, SimulationEvent } from "../../types/index.js";
import { buildWorldTimeInfo, getSceneConfig, getTicksPerScene } from "../../utils/time-helpers.js";
import { appContext } from "../../services/app-context.js";
import { resolveActionLabel } from "../../utils/action-labels.js";

const router = Router();

// GET /events — flexible query
router.get("/", (req, res) => {
  const filter: eventStore.EventQueryFilter = {};
  if (req.query.fromDay) filter.fromDay = Number(req.query.fromDay);
  if (req.query.toDay) filter.toDay = Number(req.query.toDay);
  if (req.query.type) filter.type = req.query.type as SimEventType;
  if (req.query.actorId) filter.actorId = req.query.actorId as string;
  if (req.query.limit) filter.limit = Number(req.query.limit);
  if (req.query.offset) filter.offset = Number(req.query.offset);

  res.json(eventStore.queryEvents(filter).map(enrichEventTime));
});

// GET /events/range — time range query
router.get("/range", (req, res) => {
  const fromDay = Number(req.query.fromDay) || 1;
  const fromTick = Number(req.query.fromTick) || 0;
  const toDay = Number(req.query.toDay) || fromDay;
  const defaultToTick = Math.max(0, getTicksPerScene() - 1);
  const toTick = Number(req.query.toTick) || defaultToTick;

  res.json(
    eventStore.getEventsByTimeRange(
      { day: fromDay, tick: fromTick },
      { day: toDay, tick: toTick },
    ).map(enrichEventTime),
  );
});

// GET /events/highlights
router.get("/highlights", (req, res) => {
  const minScore = Number(req.query.minScore) || 6;
  const limit = Number(req.query.limit) || 20;

  res.json(
    eventStore.queryEvents({ minDramScore: minScore, limit }).map(enrichEventTime),
  );
});

export default router;

export function enrichEventTime(event: SimulationEvent) {
  const sceneConfig = getSceneConfig();
  const eventTime = buildWorldTimeInfo(
    { day: event.gameDay, tick: event.gameTick },
    { ...sceneConfig, sceneDay: event.gameDay },
  );
  const actionName =
    typeof event.data?.actionName === "string"
      ? event.data.actionName
      : typeof event.data?.interactionName === "string"
        ? event.data.interactionName
        : resolveActionLabel({
            actionId:
              typeof event.data?.action === "string"
                ? event.data.action
                : typeof event.data?.interactionId === "string"
                  ? event.data.interactionId
                  : null,
            targetId: typeof event.data?.targetId === "string" ? event.data.targetId : event.targetId,
            locationId: event.location,
            getWorldAction: (actionId) => appContext.worldManager.getWorldAction(actionId),
            getLocationObjects: (locationId) => appContext.worldManager.getLocationObjects(locationId),
          });

  return {
    ...event,
    data: actionName ? { ...event.data, actionName } : event.data,
    timeString: eventTime.timeString,
    period: eventTime.period,
  };
}
