import type {
  ActionDecision,
  SimulationEvent,
  GameTime,
} from "../types/index.js";
import type { WorldManager, MainAreaZone } from "../core/world-manager.js";
import type { CharacterManager } from "../core/character-manager.js";
import { generateId } from "../utils/id-generator.js";
import { absoluteTick } from "../utils/time-helpers.js";
import { updateEmotion } from "../core/emotion-manager.js";

const WORLD_ACTION_TARGET_PREFIX = "world_action:";

export function executeAction(
  decision: ActionDecision,
  charId: string,
  worldManager: WorldManager,
  characterManager: CharacterManager,
  gameTime: GameTime,
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const state = characterManager.getState(charId);
  const profile = characterManager.getProfile(charId);
  const absNow = absoluteTick(gameTime);

  const innerMonologue =
    typeof decision.innerMonologue === "string" && decision.innerMonologue.trim().length > 0
      ? decision.innerMonologue.trim()
      : undefined;

  switch (decision.actionType) {
    case "interact_object": {
      if (profile.anchor) {
        console.warn(
          `[ActionExecutor] Dropping interact_object for ${charId}: character is anchored to ${profile.anchor.type}:${profile.anchor.targetId}`,
        );
        break;
      }
      const objects = worldManager.getLocationObjects(state.location);
      const obj = objects.find((o) => o.id === decision.targetId);
      if (!obj) {
        console.warn(
          `[ActionExecutor] Dropping interact_object for ${charId}: object "${decision.targetId}" not found in ${state.location}`,
        );
        break;
      }

      const interaction = obj.interactions.find(
        (i) => i.id === decision.interactionId,
      );
      if (!interaction) {
        console.warn(
          `[ActionExecutor] Dropping interact_object for ${charId}: interaction "${decision.interactionId}" not found on ${decision.targetId}`,
        );
        break;
      }

      const started = worldManager.characterStartUsingObject(
        decision.targetId,
        charId,
      );
      if (!started) {
        console.warn(
          `[ActionExecutor] Dropping interact_object for ${charId}: ${decision.targetId} is unavailable`,
        );
        break;
      }

      characterManager.updateState(charId, {
        currentAction: decision.interactionId!,
        currentActionTarget: decision.targetId,
        actionStartTick: absNow,
        actionEndTick: absNow + interaction.duration,
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_start",
        actorId: charId,
        targetId: decision.targetId,
        location: state.location,
        data: {
          actionType: "interact_object",
          objectName: obj.name,
          interactionName: interaction.name,
          interactionId: decision.interactionId,
          duration: interaction.duration,
          reason: decision.reason,
        },
        innerMonologue,
        tags: ["interact_object"],
      });
      break;
    }

    case "world_action": {
      const action = worldManager.getWorldAction(decision.targetId);
      if (!action) {
        console.warn(
          `[ActionExecutor] Dropping world_action for ${charId}: action "${decision.targetId}" not found`,
        );
        break;
      }

      characterManager.updateState(charId, {
        currentAction: action.id,
        currentActionTarget: `${WORLD_ACTION_TARGET_PREFIX}${action.id}`,
        actionStartTick: absNow,
        actionEndTick: absNow + action.duration,
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_start",
        actorId: charId,
        targetId: action.id,
        location: state.location,
        data: {
          actionType: "world_action",
          interactionName: action.name,
          interactionId: action.id,
          duration: action.duration,
          reason: decision.reason,
        },
        innerMonologue,
        tags: ["world_action"],
      });
      break;
    }

    case "talk_to": {
      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_start",
        actorId: charId,
        targetId: decision.targetId,
        location: state.location,
        data: { actionType: "talk_to", reason: decision.reason },
        innerMonologue,
        tags: ["talk_to"],
      });
      break;
    }

    case "move_to": {
      if (profile.anchor) {
        console.warn(
          `[ActionExecutor] Dropping move_to for ${charId}: character is anchored to ${profile.anchor.type}:${profile.anchor.targetId}`,
        );
        break;
      }
      const adjacent = worldManager.getAdjacentLocations(state.location);
      if (!adjacent.includes(decision.targetId)) {
        console.warn(
          `[ActionExecutor] Dropping move_to for ${charId}: "${decision.targetId}" is not adjacent to "${state.location}"`,
        );
        break;
      }

      const prevLocation = state.location;
      const prevPointId = state.mainAreaPointId;
      const nextPointId =
        decision.targetId === "main_area"
          ? worldManager.pickDistantMainAreaPointId(
              state.mainAreaPointId,
              `${charId}:${gameTime.day}:${gameTime.tick}:main_area`,
            )
          : null;
      characterManager.updateState(charId, {
        location: decision.targetId,
        mainAreaPointId: nextPointId,
        currentAction: "traveling",
        currentActionTarget: null,
        actionStartTick: absNow,
        actionEndTick: absNow + 1,
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "movement",
        actorId: charId,
        location: decision.targetId,
        data: {
          from: prevLocation,
          to: decision.targetId,
          fromPointId: prevPointId,
          toPointId: nextPointId,
          reason: decision.reason,
        },
        innerMonologue,
        tags: ["movement"],
      });
      break;
    }

    case "move_within_main_area": {
      if (profile.anchor) {
        console.warn(
          `[ActionExecutor] Dropping move_within_main_area for ${charId}: character is anchored to ${profile.anchor.type}:${profile.anchor.targetId}`,
        );
        break;
      }
      if (state.location !== "main_area") {
        console.warn(
          `[ActionExecutor] Dropping move_within_main_area for ${charId}: not currently in main_area`,
        );
        break;
      }

      const zoneSeed = `${charId}:${gameTime.day}:${gameTime.tick}:within`;
      const pointMatch = decision.targetId?.match(/^main_area_point:(.+)$/);
      const zoneMatch = decision.targetId?.match(/^main_area:(.+)$/);
      let nextPointId: string | null;
      if (pointMatch && worldManager.getMainAreaPoint(pointMatch[1])) {
        nextPointId = pointMatch[1];
      } else if (zoneMatch) {
        const targetZone = zoneMatch[1] as MainAreaZone;
        nextPointId = worldManager.pickPointInZone(targetZone, zoneSeed, state.mainAreaPointId)
          ?? worldManager.pickDistantMainAreaPointId(state.mainAreaPointId, zoneSeed);
      } else {
        nextPointId = worldManager.pickDistantMainAreaPointId(
          state.mainAreaPointId, zoneSeed,
        );
      }
      if (!nextPointId || nextPointId === state.mainAreaPointId) {
        break;
      }

      characterManager.updateState(charId, {
        location: "main_area",
        mainAreaPointId: nextPointId,
        currentAction: "traveling",
        currentActionTarget: null,
        actionStartTick: absNow,
        actionEndTick: absNow + 1,
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "movement",
        actorId: charId,
        location: "main_area",
        data: {
          actionType: "move_within_main_area",
          from: "main_area",
          to: "main_area",
          fromPointId: state.mainAreaPointId,
          toPointId: nextPointId,
          reason: decision.reason,
        },
        innerMonologue,
        tags: ["movement", "main_area"],
      });
      break;
    }

    case "idle": {
      const idleDuration = 1 + Math.floor(Math.random() * 2);
      characterManager.updateState(charId, {
        currentAction: "idle",
        currentActionTarget: null,
        actionStartTick: absNow,
        actionEndTick: absNow + idleDuration,
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_start",
        actorId: charId,
        location: state.location,
        data: {
          actionType: "idle",
          duration: idleDuration,
          reason: decision.reason,
        },
        innerMonologue,
        tags: ["idle"],
      });
      break;
    }

  }

  return events;
}

export function completeAction(
  charId: string,
  worldManager: WorldManager,
  characterManager: CharacterManager,
  gameTime: GameTime,
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const state = characterManager.getState(charId);

  if (!state.currentAction) return events;

  const actionName = state.currentAction;
  const targetId = state.currentActionTarget;

  // Apply object interaction effects
  if (targetId?.startsWith(WORLD_ACTION_TARGET_PREFIX)) {
    const actionId = targetId.slice(WORLD_ACTION_TARGET_PREFIX.length);
    const action = worldManager.getWorldAction(actionId);
    if (action) {
      for (const effect of action.effects) {
        applyEffect(effect, charId, characterManager, worldManager);
      }

      const location = worldManager.getLocation(state.location);
      const locationName = location?.name ?? state.location;

      characterManager.memoryManager.addMemory({
        characterId: charId,
        type: "experience",
        content: `我在${locationName}${action.name}`,
        gameTime,
        importance: 3,
        emotionalValence: 0,
        emotionalIntensity: 1,
        relatedLocation: state.location,
        relatedObjects: [],
        tags: ["experience", actionId],
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_end",
        actorId: charId,
        location: state.location,
        data: { action: actionName, actionName: action.name, targetId },
        tags: ["action_end"],
      });
      characterManager.updateState(charId, {
        currentAction: null,
        currentActionTarget: null,
        actionStartTick: 0,
        actionEndTick: 0,
      });
      return events;
    }
  } else if (targetId) {
    const objects = worldManager.getLocationObjects(state.location);
    const obj = objects.find((o) => o.id === targetId);
    if (obj) {
      const interaction = obj.interactions.find((i) => i.id === actionName);
      if (interaction) {
        for (const effect of interaction.effects) {
          applyEffect(effect, charId, characterManager, worldManager);
        }
      }
      worldManager.characterStopUsingObject(targetId, charId);

      const interactionName = interaction?.name ?? actionName;
      const location = worldManager.getLocation(state.location);
      const locationName = location?.name ?? state.location;

      characterManager.memoryManager.addMemory({
        characterId: charId,
        type: "experience",
        content: `我在${locationName}${interactionName}`,
        gameTime,
        importance: 3,
        emotionalValence: 0,
        emotionalIntensity: 1,
        relatedLocation: state.location,
        relatedObjects: [targetId],
        tags: ["experience", actionName],
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "action_end",
        actorId: charId,
        location: state.location,
        data: { action: actionName, actionName: interactionName, targetId },
        tags: ["action_end"],
      });
      characterManager.updateState(charId, {
        currentAction: null,
        currentActionTarget: null,
        actionStartTick: 0,
        actionEndTick: 0,
      });
      return events;
    }
  }

  characterManager.updateState(charId, {
    currentAction: null,
    currentActionTarget: null,
    actionStartTick: 0,
    actionEndTick: 0,
  });

  events.push({
    id: generateId(),
    gameDay: gameTime.day,
    gameTick: gameTime.tick,
    type: "action_end",
    actorId: charId,
    location: state.location,
    data: { action: actionName, targetId },
    tags: ["action_end"],
  });

  return events;
}

function applyEffect(
  effect: { type: string; target: string; value: any },
  charId: string,
  characterManager: CharacterManager,
  worldManager: WorldManager,
): void {
  switch (effect.type) {
    case "character_need": {
      const st = characterManager.getState(charId);
      const current = (st as any)[effect.target] ?? 0;
      const updated = Math.max(0, Math.min(100, current + effect.value));
      characterManager.updateState(charId, {
        [effect.target]: updated,
      } as any);
      break;
    }
    case "world_state": {
      worldManager.setGlobal(effect.target, String(effect.value));
      break;
    }
    case "character_emotion":
      applyEmotionEffect(effect, charId, characterManager);
      break;
    case "character_memory":
      break;
  }
}

function applyEmotionEffect(
  effect: { type: string; target: string; value: any },
  charId: string,
  characterManager: CharacterManager,
): void {
  const state = characterManager.getState(charId);
  const normalized = normalizeEmotionEffect(effect.value);
  const next = updateEmotion(
    {
      valence: state.emotionValence,
      arousal: state.emotionArousal,
    },
    normalized,
  );
  characterManager.updateState(charId, {
    emotionValence: next.valence,
    emotionArousal: next.arousal,
  });
}

function normalizeEmotionEffect(value: unknown): {
  valence: number;
  intensity: number;
} {
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      valence: Math.max(-3, Math.min(3, value)),
      intensity: Math.max(1, Math.min(8, Math.abs(value) * 2)),
    };
  }

  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>;
    const valence =
      typeof data.valence === "number" && Number.isFinite(data.valence)
        ? Math.max(-3, Math.min(3, data.valence))
        : 0;
    const intensitySource =
      typeof data.intensity === "number" && Number.isFinite(data.intensity)
        ? data.intensity
        : typeof data.arousal === "number" && Number.isFinite(data.arousal)
          ? data.arousal
          : Math.abs(valence) * 2;
    return {
      valence,
      intensity: Math.max(1, Math.min(8, intensitySource)),
    };
  }

  return { valence: 0, intensity: 1 };
}
