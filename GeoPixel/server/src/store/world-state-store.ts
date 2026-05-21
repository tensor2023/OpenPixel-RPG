import { getDb } from "./db.js";
import type { LocationConfig, ObjectRuntimeState, WorldGlobalEntry } from "../types/index.js";

export function initWorldState(locations: LocationConfig[]): void {
  const db = getDb();

  const insertObj = db.prepare(
    `INSERT OR IGNORE INTO world_object_states (object_id, location_id, state, state_description, current_users)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const insertGlobal = db.prepare(
    `INSERT OR IGNORE INTO world_global_state (key, value) VALUES (?, ?)`,
  );

  db.transaction(() => {
    for (const loc of locations) {
      for (const obj of loc.objects) {
        insertObj.run(obj.id, obj.locationId, obj.defaultState, "", "[]");
      }
    }
    insertGlobal.run("current_day", "1");
    insertGlobal.run("current_tick", "0");
    insertGlobal.run("power", "on");
    insertGlobal.run("weather", "clear");
  })();
}

function rowToObjectState(row: any): ObjectRuntimeState {
  return {
    objectId: row.object_id,
    locationId: row.location_id,
    state: row.state,
    stateDescription: row.state_description,
    currentUsers: JSON.parse(row.current_users),
  };
}

export function getObjectState(objectId: string): ObjectRuntimeState {
  const row = getDb()
    .prepare("SELECT * FROM world_object_states WHERE object_id = ?")
    .get(objectId) as any;
  if (!row) throw new Error(`Object not found: ${objectId}`);
  return rowToObjectState(row);
}

export function getAllObjectStates(): ObjectRuntimeState[] {
  return (getDb().prepare("SELECT * FROM world_object_states").all() as any[]).map(
    rowToObjectState,
  );
}

export function getObjectsByLocation(locationId: string): ObjectRuntimeState[] {
  return (
    getDb()
      .prepare("SELECT * FROM world_object_states WHERE location_id = ?")
      .all(locationId) as any[]
  ).map(rowToObjectState);
}

export function updateObjectState(objectId: string, patch: Partial<ObjectRuntimeState>): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.state !== undefined) {
    sets.push("state = ?");
    params.push(patch.state);
  }
  if (patch.stateDescription !== undefined) {
    sets.push("state_description = ?");
    params.push(patch.stateDescription);
  }
  if (patch.currentUsers !== undefined) {
    sets.push("current_users = ?");
    params.push(JSON.stringify(patch.currentUsers));
  }
  if (patch.locationId !== undefined) {
    sets.push("location_id = ?");
    params.push(patch.locationId);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  params.push(objectId);

  getDb()
    .prepare(`UPDATE world_object_states SET ${sets.join(", ")} WHERE object_id = ?`)
    .run(...params);
}

export function addUserToObject(objectId: string, characterId: string): void {
  const state = getObjectState(objectId);
  if (!state.currentUsers.includes(characterId)) {
    state.currentUsers.push(characterId);
    updateObjectState(objectId, { currentUsers: state.currentUsers });
  }
}

export function removeUserFromObject(objectId: string, characterId: string): void {
  const state = getObjectState(objectId);
  const idx = state.currentUsers.indexOf(characterId);
  if (idx >= 0) {
    state.currentUsers.splice(idx, 1);
    updateObjectState(objectId, { currentUsers: state.currentUsers });
  }
}

export function getGlobalState(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM world_global_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setGlobalState(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO world_global_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

export function deleteGlobalState(key: string): void {
  getDb()
    .prepare("DELETE FROM world_global_state WHERE key = ?")
    .run(key);
}

export function getAllGlobalState(): WorldGlobalEntry[] {
  return (getDb().prepare("SELECT key, value FROM world_global_state").all() as any[]).map(
    (r) => ({ key: r.key, value: r.value }),
  );
}
