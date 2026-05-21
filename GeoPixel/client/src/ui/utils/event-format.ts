import i18n from "../../i18n";
import type { CharacterInfo, LocationInfo, SimulationEvent } from "../../types/api";

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

const EVENT_TYPE_KEY_MAP: Record<string, string> = {
  dialogue: "eventFormat.typeDialogue",
  movement: "eventFormat.typeMovement",
  action_start: "eventFormat.typeActionStart",
  action_end: "eventFormat.typeActionEnd",
  event_triggered: "eventFormat.typeEventTriggered",
  emotion_shift: "eventFormat.typeEmotionShift",
  reflection: "eventFormat.typeReflection",
  memory_formed: "eventFormat.typeMemoryFormed",
};

const ACTION_KEY_MAP: Record<string, string> = {
  sleep: "eventFormat.actionSleep",
  cook: "eventFormat.actionCook",
  eat: "eventFormat.actionEat",
  read: "eventFormat.actionRead",
  read_bulletin: "eventFormat.actionReadBulletin",
  write_diary: "eventFormat.actionWriteDiary",
  talk: "eventFormat.actionTalk",
  in_conversation: "eventFormat.actionInConversation",
  traveling: "eventFormat.actionTraveling",
  idle: "eventFormat.actionIdle",
  fish: "eventFormat.actionFish",
  explore: "eventFormat.actionExplore",
  repair: "eventFormat.actionRepair",
  think_in_bed: "eventFormat.actionThinkInBed",
  lock_door: "eventFormat.actionLockDoor",
  unlock_door: "eventFormat.actionUnlockDoor",
  people_watch: "eventFormat.actionPeopleWatch",
  use_computer: "eventFormat.actionUseComputer",
  have_drink: "eventFormat.actionHaveDrink",
  craft: "eventFormat.actionCraft",
  stroll: "eventFormat.actionStroll",
  tend_garden: "eventFormat.actionTendGarden",
  post_message: "eventFormat.actionPostMessage",
  move_within_main_area: "eventFormat.actionMoveWithinMainArea",
};

type EventFormatContext = {
  characterNames?: Record<string, string>;
  locationNames?: Record<string, string>;
};

export function buildCharacterNameMap(characters: CharacterInfo[]): Record<string, string> {
  return Object.fromEntries(characters.map((character) => [character.id, character.name]));
}

export function buildLocationNameMap(locations: LocationInfo[]): Record<string, string> {
  return Object.fromEntries(locations.map((location) => [location.id, location.name]));
}

export function formatEventType(type: string): string {
  const key = EVENT_TYPE_KEY_MAP[type];
  return key ? t(key) : prettifyToken(type);
}

export function formatEventSummary(
  event: SimulationEvent,
  context: EventFormatContext = {},
): string {
  const actorName = formatCharacterName(event.actorId, context.characterNames);
  const targetName = formatCharacterName(event.targetId, context.characterNames);
  const currentLocation = formatLocationName(event.location, context.locationNames);
  const actionName = formatActionName(
    event.data?.actionName ?? event.data?.interactionName ?? event.data?.action ?? event.data?.interactionId ?? event.data?.actionType,
  );

  switch (event.type) {
    case "movement": {
      if (event.data?.actionType === "move_within_main_area") {
        return actorName
          ? t("eventFormat.moveWithinMainArea", { name: actorName })
          : t("eventFormat.moveWithinMainAreaNoName");
      }
      const destination = formatLocationName(
        event.data?.to ?? event.data?.toLocation ?? event.location,
        context.locationNames,
      );
      return actorName
        ? t("eventFormat.moveTo", { name: actorName, destination })
        : t("eventFormat.moveToNoName", { destination });
    }
    case "action_start":
      if (actorName && currentLocation !== t("eventFormat.unknownLocation")) {
        return t("eventFormat.actionStartAtLocation", { name: actorName, location: currentLocation, action: actionName });
      }
      return actorName
        ? t("eventFormat.actionStartSimple", { name: actorName, action: actionName })
        : t("eventFormat.actionStartNoName", { action: actionName });
    case "action_end":
      return actorName
        ? t("eventFormat.actionEndSimple", { name: actorName, action: actionName })
        : t("eventFormat.actionEndNoName", { action: actionName });
    case "dialogue": {
      const phase = event.data?.phase;
      const turnCount = event.data?.turns?.length || 0;
      if (phase === "turn") {
        const preview = event.data?.turns?.[0]?.content;
        if (actorName && targetName && preview) {
          return t("eventFormat.dialogueTurnPreview", { name: actorName, target: targetName, preview });
        }
        return actorName
          ? t("eventFormat.dialogueTurnSimple", { name: actorName })
          : t("eventFormat.dialogueTurnNoName");
      }
      if (actorName && targetName) {
        return t("eventFormat.dialogueComplete", { name: actorName, target: targetName, count: turnCount });
      }
      return actorName
        ? t("eventFormat.dialogueCompleteOneParty", { name: actorName, count: turnCount })
        : t("eventFormat.dialogueCompleteNoName", { count: turnCount });
    }
    case "emotion_shift": {
      const needName = formatNeedName(event.data?.urgentNeed);
      const value =
        typeof event.data?.value === "number" ? Math.round(event.data.value) : null;
      if (actorName) {
        return value == null
          ? t("eventFormat.emotionUrgent", { name: actorName, need: needName })
          : t("eventFormat.emotionUrgentWithValue", { name: actorName, need: needName, value });
      }
      return t("eventFormat.emotionUrgentNoName", { need: needName });
    }
    case "reflection":
      return actorName
        ? t("eventFormat.reflectionDone", { name: actorName })
        : t("eventFormat.reflectionNoName");
    case "memory_formed":
      return actorName
        ? t("eventFormat.memoryFormed", { name: actorName })
        : t("eventFormat.memoryNoName");
    case "event_triggered":
      return event.data?.title || event.data?.name || event.data?.summary || t("eventFormat.eventTriggeredFallback");
    default:
      if (actorName) return `${actorName}: ${summarizePayload(event.data)}`;
      return summarizePayload(event.data);
  }
}

function formatCharacterName(
  characterId: string | undefined,
  nameMap: Record<string, string> | undefined,
): string {
  if (!characterId) return "";
  return nameMap?.[characterId] || prettifyToken(characterId.replace(/^char_/, ""));
}

function formatLocationName(
  locationId: string | undefined,
  nameMap: Record<string, string> | undefined,
): string {
  if (!locationId) return t("eventFormat.unknownLocation");
  return nameMap?.[locationId] || prettifyToken(locationId);
}

export function formatActionName(action: string | undefined): string {
  if (!action) return t("eventFormat.defaultAction");
  const key = ACTION_KEY_MAP[action];
  return key ? t(key) : prettifyToken(action);
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return t("eventFormat.defaultSummary");
  const namedPayload = payload as Record<string, unknown>;
  if (typeof namedPayload.summary === "string") return namedPayload.summary;
  if (typeof namedPayload.actionName === "string") return namedPayload.actionName;
  if (typeof namedPayload.interactionName === "string") return namedPayload.interactionName;
  if (typeof namedPayload.action === "string") return formatActionName(namedPayload.action);
  if (typeof namedPayload.interactionId === "string") return formatActionName(namedPayload.interactionId);
  if (typeof namedPayload.toLocation === "string") return t("eventFormat.moveToNoName", { destination: prettifyToken(namedPayload.toLocation) });
  if (typeof namedPayload.to === "string") return t("eventFormat.moveToNoName", { destination: prettifyToken(namedPayload.to) });
  return t("eventFormat.defaultSummary");
}

function prettifyToken(token: string): string {
  return token
    .replace(/^char_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatNeedName(need: unknown): string {
  if (need === "curiosity") return t("eventFormat.needCuriosity");
  return typeof need === "string" ? prettifyToken(need) : t("eventFormat.needDefault");
}
