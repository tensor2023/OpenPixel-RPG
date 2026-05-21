import type { Perception } from "../types/index.js";
import type { WorldManager } from "../core/world-manager.js";
import type { CharacterManager } from "../core/character-manager.js";
import * as eventStore from "../store/event-store.js";

const INTERACTION_COOLDOWN_TICKS = 4;

export function buildActionMenu(
  charId: string,
  perception: Perception,
  worldManager: WorldManager,
  characterManager: CharacterManager,
): string {
  const state = characterManager.getState(charId);
  const profile = characterManager.getProfile(charId);
  const gameTime = worldManager.getCurrentTime();

  const recentInteractionIds = getRecentInteractionIds(charId, gameTime);
  const isAnchored = !!profile.anchor;
  const canInitiateDialogue = canInitiateDialogueHere(profile.anchor, state.location);

  const lines: string[] = [];
  let idx = 1;
  const sceneConfig = worldManager.getSceneConfig();

  const worldActionLines: string[] = [];
  const worldActions = worldManager.getWorldActions();
  for (const action of worldActions) {
    if (!action.repeatable && recentInteractionIds.has(action.id)) continue;

    const durationMin = action.duration * sceneConfig.tickDurationMinutes;
    const durationStr =
      durationMin >= 60
        ? `约${(durationMin / 60).toFixed(1).replace(/\.0$/, "")}小时`
        : `约${durationMin}分钟`;

    worldActionLines.push(
      `${idx}. [world_action] "${action.name}"(${action.id})（${durationStr}）`,
    );
    idx++;
  }

  if (worldActionLines.length > 0) {
    lines.push("【全局功能】");
    lines.push(...worldActionLines);
  }

  // Build anchor map: objectId / regionId → anchored character id
  const anchorCharMap = new Map<string, string>();
  for (const p of characterManager.getAllProfiles()) {
    if (p.anchor) {
      anchorCharMap.set(p.anchor.targetId, p.id);
    }
  }

  // Collect requiresAnchor interactions that should become talk_to motivations
  // key = anchored character id, value = list of interaction descriptions
  const anchorInteractionsByChar = new Map<string, string[]>();

  const objectLines: string[] = [];
  const objects = worldManager.getLocationObjects(state.location);
  for (const obj of objects) {
    if (obj.currentUsers.length >= obj.capacity) continue;

    const interactions = worldManager.getAvailableInteractions(obj.id);
    for (const inter of interactions) {
      if (!inter.repeatable && recentInteractionIds.has(inter.id)) continue;

      if (inter.requiresAnchor) {
        const anchoredCharId = anchorCharMap.get(obj.id);
        if (anchoredCharId && anchoredCharId !== charId) {
          const anchoredState = characterManager.getState(anchoredCharId);
          if (anchoredState.currentAction !== "in_conversation") {
            const existing = anchorInteractionsByChar.get(anchoredCharId) ?? [];
            existing.push(inter.name);
            anchorInteractionsByChar.set(anchoredCharId, existing);
            continue;
          }
        }
        // Fallback: no anchored character found, or character is busy —
        // show as normal interact_object for non-anchored visitors only.
      }

      if (isAnchored) continue;

      const durationMin = inter.duration * sceneConfig.tickDurationMinutes;
      const durationStr =
        durationMin >= 60
          ? `约${(durationMin / 60).toFixed(1).replace(/\.0$/, "")}小时`
          : `约${durationMin}分钟`;

      objectLines.push(
        `${idx}. [interact_object] ${obj.name}(${obj.id}) → "${inter.name}"(${inter.id})（${durationStr}）`,
      );
      idx++;
    }
  }

  if (objectLines.length > 0) {
    lines.push("【可交互物件】");
    lines.push(...objectLines);
  }

  if (!isAnchored) {
    const charLines: string[] = [];
    for (const c of perception.charactersHere) {
      const otherProfile = characterManager.getProfile(c.id);
      const otherState = characterManager.getState(c.id);
      if (!isLegalDirectTalkTarget(state.location, otherState.location)) continue;
      if (otherState.currentAction === "in_conversation") continue;
      const actionStr = c.currentAction ? `正在${c.currentAction}` : "空闲";
      const anchorServices = anchorInteractionsByChar.get(c.id);
      const serviceHint = anchorServices
        ? ` [可交互：${anchorServices.join("、")}]`
        : "";
      charLines.push(
        `${idx}. [talk_to] ${c.name}(${otherProfile.role}, ${c.id}) — ${actionStr}${serviceHint}`,
      );
      idx++;
    }

    // Also list anchored characters with services even if they weren't in
    // perception.charactersHere (e.g. just outside conversable range but the
    // character has anchor interactions available — rare but possible)
    for (const [ancCharId, services] of anchorInteractionsByChar) {
      if (charLines.some((line) => line.includes(ancCharId))) continue;
      const ancProfile = characterManager.getProfile(ancCharId);
      const ancState = characterManager.getState(ancCharId);
      if (!isLegalDirectTalkTarget(state.location, ancState.location)) continue;
      if (ancState.currentAction === "in_conversation") continue;
      const actionStr = ancState.currentAction ? `正在${ancState.currentAction}` : "空闲";
      charLines.push(
        `${idx}. [talk_to] ${ancProfile.name}(${ancProfile.role}, ${ancCharId}) — ${actionStr} [可交互：${services.join("、")}]`,
      );
      idx++;
    }

    if (charLines.length > 0) {
      lines.push("【在场的人】");
      lines.push(...charLines);
    }
  }

  if (canInitiateDialogue && isAnchored) {
    const charLines: string[] = [];
    for (const c of perception.charactersHere) {
      const otherProfile = characterManager.getProfile(c.id);
      const otherState = characterManager.getState(c.id);
      if (!isLegalDirectTalkTarget(state.location, otherState.location)) continue;
      if (otherState.currentAction === "in_conversation") continue;
      const actionStr = c.currentAction ? `正在${c.currentAction}` : "空闲";
      const anchorServices = anchorInteractionsByChar.get(c.id);
      const serviceHint = anchorServices
        ? ` [可交互：${anchorServices.join("、")}]`
        : "";
      charLines.push(
        `${idx}. [talk_to] ${c.name}(${otherProfile.role}, ${c.id}) — ${actionStr}${serviceHint}`,
      );
      idx++;
    }

    if (charLines.length > 0) {
      lines.push("【在场的人】");
      lines.push(...charLines);
    }
  }

  if (!isAnchored) {
    const adjacent = worldManager.getAdjacentLocations(state.location);
    const moveLines: string[] = [];
    if (state.location === "main_area" && worldManager.hasMultipleMainAreaPoints()) {
      const zones = worldManager.getAvailableMainAreaZones();
      const myZone = worldManager.getMainAreaPointZone(state.mainAreaPointId);
      if (zones.length > 1) {
        for (const z of zones) {
          if (z === myZone) continue;
          const label = z === "中" ? "中央" : `${z}侧`;
          moveLines.push(`${idx}. [move_within_main_area] 走到主区域${label}(main_area:${z})`);
          idx++;
        }
      } else {
        moveLines.push(`${idx}. [move_within_main_area] 在主区域内换个地方活动(main_area)`);
        idx++;
      }
    }
    if (adjacent.length > 0) {
      for (const locId of adjacent) {
        const loc = worldManager.getLocation(locId);
        if (loc) {
          moveLines.push(`${idx}. [move_to] ${loc.name}(${locId})`);
          idx++;
        }
      }
    }
    if (moveLines.length > 0) {
      lines.push("【移动】");
      lines.push(...moveLines);
    }
  }

  lines.push("【其他】");
  lines.push(`${idx}. [idle] 原地发呆/思考`);

  return lines.join("\n");
}

function getRecentInteractionIds(
  charId: string,
  gameTime: { day: number; tick: number },
): Set<string> {
  const fromTick = Math.max(0, gameTime.tick - INTERACTION_COOLDOWN_TICKS);
  const events = eventStore.queryEvents({
    actorId: charId,
    type: "action_start",
    fromDay: gameTime.day,
    fromTick,
    toDay: gameTime.day,
    toTick: gameTime.tick,
  });

  const ids = new Set<string>();
  for (const e of events) {
    if (
      (e.data?.actionType === "interact_object" || e.data?.actionType === "world_action") &&
      e.data?.interactionId
    ) {
      ids.add(e.data.interactionId as string);
    }
  }
  return ids;
}

function isLegalDirectTalkTarget(
  initiatorLocation: string,
  targetLocation: string,
): boolean {
  return initiatorLocation === targetLocation;
}

function canInitiateDialogueHere(
  anchor: { type: string; targetId: string } | undefined,
  currentLocation: string,
): boolean {
  if (!anchor) return true;
  return (
    anchor.type === "region" &&
    currentLocation !== "main_area" &&
    currentLocation === anchor.targetId
  );
}
