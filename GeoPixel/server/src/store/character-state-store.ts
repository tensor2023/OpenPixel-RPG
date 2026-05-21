import { getDb } from "./db.js";
import type { CharacterState } from "../types/index.js";

function rowToState(row: any): CharacterState {
  return {
    characterId: row.character_id,
    location: row.location,
    mainAreaPointId: row.main_area_point_id ?? null,
    currentAction: row.current_action ?? null,
    currentActionTarget: row.current_action_target ?? null,
    actionStartTick: row.action_start_tick,
    actionEndTick: row.action_end_tick,
    emotionValence: row.emotion_valence,
    emotionArousal: row.emotion_arousal,
    curiosity: row.curiosity,
    dailyPlan: row.daily_plan ?? null,
  };
}

export function initCharacterState(state: CharacterState): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO character_states
       (character_id, location, main_area_point_id, current_action, current_action_target,
        action_start_tick, action_end_tick, emotion_valence, emotion_arousal,
        curiosity, daily_plan)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      state.characterId,
      state.location,
      state.mainAreaPointId,
      state.currentAction,
      state.currentActionTarget,
      state.actionStartTick,
      state.actionEndTick,
      state.emotionValence,
      state.emotionArousal,
      state.curiosity,
      state.dailyPlan,
    );
}

export function getCharacterState(id: string): CharacterState {
  const row = getDb()
    .prepare("SELECT * FROM character_states WHERE character_id = ?")
    .get(id) as any;
  if (!row) throw new Error(`Character state not found: ${id}`);
  return rowToState(row);
}

export function getAllCharacterStates(): CharacterState[] {
  return (getDb().prepare("SELECT * FROM character_states").all() as any[]).map(rowToState);
}

export function updateCharacterState(id: string, patch: Partial<CharacterState>): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.location !== undefined) {
    sets.push("location = ?");
    params.push(patch.location);
  }
  if (patch.mainAreaPointId !== undefined) {
    sets.push("main_area_point_id = ?");
    params.push(patch.mainAreaPointId);
  }
  if (patch.currentAction !== undefined) {
    sets.push("current_action = ?");
    params.push(patch.currentAction);
  }
  if (patch.currentActionTarget !== undefined) {
    sets.push("current_action_target = ?");
    params.push(patch.currentActionTarget);
  }
  if (patch.actionStartTick !== undefined) {
    sets.push("action_start_tick = ?");
    params.push(patch.actionStartTick);
  }
  if (patch.actionEndTick !== undefined) {
    sets.push("action_end_tick = ?");
    params.push(patch.actionEndTick);
  }
  if (patch.emotionValence !== undefined) {
    sets.push("emotion_valence = ?");
    params.push(patch.emotionValence);
  }
  if (patch.emotionArousal !== undefined) {
    sets.push("emotion_arousal = ?");
    params.push(patch.emotionArousal);
  }
  if (patch.curiosity !== undefined) {
    sets.push("curiosity = ?");
    params.push(patch.curiosity);
  }
  if (patch.dailyPlan !== undefined) {
    sets.push("daily_plan = ?");
    params.push(patch.dailyPlan);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  getDb()
    .prepare(`UPDATE character_states SET ${sets.join(", ")} WHERE character_id = ?`)
    .run(...params);
}

export function getCharactersByLocation(locationId: string): CharacterState[] {
  return (
    getDb()
      .prepare("SELECT * FROM character_states WHERE location = ?")
      .all(locationId) as any[]
  ).map(rowToState);
}
