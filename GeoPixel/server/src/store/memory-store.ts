import { getDb } from "./db.js";
import type { MemoryEntry, MemoryType } from "../types/index.js";

function rowToMemory(row: any): MemoryEntry {
  return {
    id: row.id,
    characterId: row.character_id,
    type: row.type as MemoryType,
    content: row.content,
    gameDay: row.game_day,
    gameTick: row.game_tick,
    importance: row.importance,
    emotionalValence: row.emotional_valence,
    emotionalIntensity: row.emotional_intensity,
    relatedCharacters: JSON.parse(row.related_characters),
    relatedLocation: row.related_location,
    relatedObjects: JSON.parse(row.related_objects),
    tags: JSON.parse(row.tags),
    decayFactor: row.decay_factor,
    accessCount: row.access_count,
    isLongTerm: row.is_long_term === 1,
    embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
  };
}

const INSERT_SQL = `INSERT INTO memories
  (id, character_id, type, content, game_day, game_tick, importance,
   emotional_valence, emotional_intensity, related_characters, related_location,
   related_objects, tags, decay_factor, access_count, is_long_term, embedding)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function memoryToParams(m: MemoryEntry): unknown[] {
  return [
    m.id,
    m.characterId,
    m.type,
    m.content,
    m.gameDay,
    m.gameTick,
    m.importance,
    m.emotionalValence,
    m.emotionalIntensity,
    JSON.stringify(m.relatedCharacters),
    m.relatedLocation,
    JSON.stringify(m.relatedObjects),
    JSON.stringify(m.tags),
    m.decayFactor,
    m.accessCount,
    m.isLongTerm ? 1 : 0,
    m.embedding ? JSON.stringify(m.embedding) : null,
  ];
}

export function insertMemory(memory: MemoryEntry): void {
  getDb().prepare(INSERT_SQL).run(...memoryToParams(memory));
}

export function hasMemory(
  characterId: string,
  type: MemoryType,
  content: string,
  gameDay: number,
  gameTick: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1
       FROM memories
       WHERE character_id = ?
         AND type = ?
         AND content = ?
         AND game_day = ?
         AND game_tick = ?
       LIMIT 1`,
    )
    .get(characterId, type, content, gameDay, gameTick);
  return Boolean(row);
}

export function insertMemories(memories: MemoryEntry[]): void {
  const db = getDb();
  const stmt = db.prepare(INSERT_SQL);
  db.transaction((mems: MemoryEntry[]) => {
    for (const m of mems) stmt.run(...memoryToParams(m));
  })(memories);
}

export interface MemoryQueryOptions {
  limit?: number;
  isLongTerm?: boolean;
  minImportance?: number;
  types?: MemoryType[];
  tags?: string[];
}

export function getMemoriesByCharacter(
  charId: string,
  options?: MemoryQueryOptions,
): MemoryEntry[] {
  const conds: string[] = ["character_id = ?"];
  const params: unknown[] = [charId];

  if (options?.isLongTerm !== undefined) {
    conds.push("is_long_term = ?");
    params.push(options.isLongTerm ? 1 : 0);
  }
  if (options?.minImportance !== undefined) {
    conds.push("importance >= ?");
    params.push(options.minImportance);
  }
  if (options?.types && options.types.length > 0) {
    const placeholders = options.types.map(() => "?").join(", ");
    conds.push(`type IN (${placeholders})`);
    params.push(...options.types);
  }

  let sql = `SELECT * FROM memories WHERE ${conds.join(" AND ")} ORDER BY game_day DESC, game_tick DESC`;

  if (options?.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  let results = (getDb().prepare(sql).all(...params) as any[]).map(rowToMemory);

  if (options?.tags && options.tags.length > 0) {
    results = results.filter((m) =>
      options.tags!.some((t) => m.tags.includes(t)),
    );
  }

  return results;
}

export function getMemory(id: string): MemoryEntry {
  const row = getDb()
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as any;
  if (!row) throw new Error(`Memory not found: ${id}`);
  return rowToMemory(row);
}

export function updateMemory(id: string, patch: Partial<MemoryEntry>): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.importance !== undefined) {
    sets.push("importance = ?");
    params.push(patch.importance);
  }
  if (patch.accessCount !== undefined) {
    sets.push("access_count = ?");
    params.push(patch.accessCount);
  }
  if (patch.isLongTerm !== undefined) {
    sets.push("is_long_term = ?");
    params.push(patch.isLongTerm ? 1 : 0);
  }
  if (patch.decayFactor !== undefined) {
    sets.push("decay_factor = ?");
    params.push(patch.decayFactor);
  }
  if (patch.tags !== undefined) {
    sets.push("tags = ?");
    params.push(JSON.stringify(patch.tags));
  }
  if (patch.content !== undefined) {
    sets.push("content = ?");
    params.push(patch.content);
  }
  if (patch.emotionalValence !== undefined) {
    sets.push("emotional_valence = ?");
    params.push(patch.emotionalValence);
  }
  if (patch.emotionalIntensity !== undefined) {
    sets.push("emotional_intensity = ?");
    params.push(patch.emotionalIntensity);
  }
  if ("embedding" in patch) {
    sets.push("embedding = ?");
    params.push(patch.embedding ? JSON.stringify(patch.embedding) : null);
  }

  if (sets.length === 0) return;

  params.push(id);
  getDb()
    .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
}

export function deleteMemory(id: string): void {
  getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
}

export function countMemoriesByTag(charId: string, tag: string): number {
  const memories = getMemoriesByCharacter(charId);
  return memories.filter((m) => m.tags.includes(tag)).length;
}
