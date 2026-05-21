import type { Perception, GameTime } from "../types/index.js";
import type { WorldManager } from "../core/world-manager.js";
import type { CharacterManager } from "../core/character-manager.js";
import { getEmotionLabel } from "../core/emotion-manager.js";
import * as eventStore from "../store/event-store.js";

export function buildPerception(
  charId: string,
  worldManager: WorldManager,
  characterManager: CharacterManager,
  gameTime: GameTime,
): Perception {
  const state = characterManager.getState(charId);
  const location = worldManager.getLocation(state.location);

  if (!location) {
    return {
      currentLocation: state.location,
      locationDescription: "",
      objectsHere: [],
      charactersHere: [],
      recentEnvironmentChanges: [],
      recentActions: [],
    };
  }

  const objects = worldManager.getLocationObjects(state.location);
  const objectsHere = objects.map((obj) => {
    const interactions = worldManager.getAvailableInteractions(obj.id);
    return {
      id: obj.id,
      name: obj.name,
      state: obj.state,
      stateDescription: obj.stateDescription,
      availableInteractions: interactions.map((i) => i.name),
    };
  });

  const charsAtLoc =
    state.location === "main_area"
      ? characterManager.getAllStates().map((s) => ({
          profile: characterManager.getProfile(s.characterId),
          state: s,
        }))
      : characterManager.getCharactersAtLocation(state.location);
  const hasZones = worldManager.getAvailableMainAreaZones().length > 1;
  const charactersHere = charsAtLoc
    .filter((c) => c.profile.id !== charId)
    .map((c) => {
      const visiblyEmotional =
        Math.abs(c.state.emotionValence) >= 2 || c.state.emotionArousal >= 7;
      const targetLocation =
        worldManager.getLocation(c.state.location)?.name ?? c.state.location;
      const zone =
        hasZones && c.state.location === "main_area"
          ? worldManager.getMainAreaPointZone(c.state.mainAreaPointId)
          : undefined;
      return {
        id: c.profile.id,
        name: c.profile.name,
        currentAction: c.state.currentAction,
        appearanceHint: c.profile.appearanceHint,
        locationId: c.state.location,
        locationName: targetLocation,
        emotionLabel: visiblyEmotional
          ? getEmotionLabel(c.state.emotionValence, c.state.emotionArousal)
          : undefined,
        zone,
      };
    });

  const recentEvents = eventStore.queryEvents({
    type: "event_triggered",
    location: state.location,
    fromDay: gameTime.day,
    fromTick: Math.max(0, gameTime.tick - 2),
    toDay: gameTime.day,
    toTick: gameTime.tick,
  });
  const globalEvents = eventStore.queryEvents({
    type: "event_triggered",
    location: "global",
    fromDay: gameTime.day,
    fromTick: Math.max(0, gameTime.tick - 2),
    toDay: gameTime.day,
    toTick: gameTime.tick,
  });
  const describeEventData = (e: (typeof recentEvents)[number]): string =>
    typeof e.data?.description === "string"
      ? e.data.description
      : JSON.stringify(e.data);
  const globalChanges = globalEvents.map((e) => `[广播] ${describeEventData(e)}`);
  const localChanges = recentEvents.map(describeEventData);
  const recentEnvironmentChanges = [...globalChanges, ...localChanges];

  const recentActions = getRecentActionDescriptions(charId, gameTime);

  const myZone =
    hasZones && state.location === "main_area"
      ? worldManager.getMainAreaPointZone(state.mainAreaPointId)
      : undefined;

  return {
    currentLocation: location.name,
    locationDescription: location.description,
    myZone,
    objectsHere,
    charactersHere,
    recentEnvironmentChanges,
    recentActions,
  };
}

function getRecentActionDescriptions(
  charId: string,
  gameTime: GameTime,
): string[] {
  const lookbackTicks = 6;
  const fromTick = Math.max(0, gameTime.tick - lookbackTicks);
  const events = eventStore.queryEvents({
    actorId: charId,
    fromDay: gameTime.day,
    fromTick,
    toDay: gameTime.day,
    toTick: gameTime.tick,
  });

  const descriptions: string[] = [];
  for (const e of events) {
    if (e.type === "action_start") {
      const d = e.data;
      if (d?.actionType === "interact_object" && d.objectName) {
        descriptions.push(`${d.objectName}${d.interactionName ?? d.interactionId}`);
      } else if (d?.actionType === "world_action" && d.interactionName) {
        descriptions.push(d.interactionName);
      } else if (d?.actionType === "move_within_main_area") {
        descriptions.push("在主区域换了个位置");
      } else if (d?.actionType === "idle") {
        descriptions.push("发呆/思考");
      }
    } else if (e.type === "movement") {
      descriptions.push(`前往${e.data?.to ?? e.location}`);
    } else if (e.type === "dialogue" && e.data?.phase !== "turn") {
      descriptions.push(`和${e.targetId ?? "某人"}聊天`);
    }
  }
  return descriptions;
}
