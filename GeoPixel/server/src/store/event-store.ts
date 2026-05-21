import { getDb } from "./db.js";
import type { SimulationEvent, SimEventType, GameTime } from "../types/index.js";

export interface EventQueryFilter {
  fromDay?: number;
  toDay?: number;
  fromTick?: number;
  toTick?: number;
  type?: SimEventType;
  actorId?: string;
  location?: string;
  minDramScore?: number;
  limit?: number;
  offset?: number;
}

function rowToEvent(row: any): SimulationEvent {
  return {
    id: row.id,
    gameDay: row.game_day,
    gameTick: row.game_tick,
    type: row.type as SimEventType,
    actorId: row.actor_id ?? undefined,
    targetId: row.target_id ?? undefined,
    location: row.location,
    data: JSON.parse(row.data),
    innerMonologue: row.inner_monologue ?? undefined,
    dramScore: row.dram_score ?? undefined,
    tags: JSON.parse(row.tags),
  };
}

const INSERT_SQL = `INSERT INTO events
  (id, game_day, game_tick, type, actor_id, target_id, location, data, inner_monologue, dram_score, tags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function eventToParams(e: SimulationEvent): unknown[] {
  return [
    e.id,
    e.gameDay,
    e.gameTick,
    e.type,
    e.actorId ?? null,
    e.targetId ?? null,
    e.location,
    JSON.stringify(e.data),
    e.innerMonologue ?? null,
    e.dramScore ?? null,
    JSON.stringify(e.tags),
  ];
}

export function appendEvent(event: SimulationEvent): void {
  getDb().prepare(INSERT_SQL).run(...eventToParams(event));
}

export function appendEvents(events: SimulationEvent[]): void {
  const db = getDb();
  const stmt = db.prepare(INSERT_SQL);
  const tx = db.transaction((evts: SimulationEvent[]) => {
    for (const e of evts) stmt.run(...eventToParams(e));
  });
  tx(events);
}

function buildWhereClause(filter: EventQueryFilter): { sql: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filter.fromDay !== undefined) {
    conds.push("game_day >= ?");
    params.push(filter.fromDay);
  }
  if (filter.toDay !== undefined) {
    conds.push("game_day <= ?");
    params.push(filter.toDay);
  }
  if (filter.fromTick !== undefined) {
    conds.push("game_tick >= ?");
    params.push(filter.fromTick);
  }
  if (filter.toTick !== undefined) {
    conds.push("game_tick <= ?");
    params.push(filter.toTick);
  }
  if (filter.type !== undefined) {
    conds.push("type = ?");
    params.push(filter.type);
  }
  if (filter.actorId !== undefined) {
    conds.push("actor_id = ?");
    params.push(filter.actorId);
  }
  if (filter.location !== undefined) {
    conds.push("location = ?");
    params.push(filter.location);
  }
  if (filter.minDramScore !== undefined) {
    conds.push("dram_score >= ?");
    params.push(filter.minDramScore);
  }

  const sql = conds.length > 0 ? "WHERE " + conds.join(" AND ") : "";
  return { sql, params };
}

export function queryEvents(filter: EventQueryFilter): SimulationEvent[] {
  const { sql: where, params } = buildWhereClause(filter);
  let sql = `SELECT * FROM events ${where} ORDER BY game_day, game_tick, rowid`;

  if (filter.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(filter.limit);
    if (filter.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(filter.offset);
    }
  } else if (filter.offset !== undefined) {
    sql += " LIMIT -1 OFFSET ?";
    params.push(filter.offset);
  }

  return (getDb().prepare(sql).all(...params) as any[]).map(rowToEvent);
}

export function getEventsByTimeRange(from: GameTime, to: GameTime): SimulationEvent[] {
  const sql = `
    SELECT * FROM events
    WHERE (game_day > ? OR (game_day = ? AND game_tick >= ?))
      AND (game_day < ? OR (game_day = ? AND game_tick <= ?))
    ORDER BY game_day, game_tick, rowid`;
  const rows = getDb()
    .prepare(sql)
    .all(from.day, from.day, from.tick, to.day, to.day, to.tick) as any[];
  return rows.map(rowToEvent);
}

export function getEventsByIds(ids: string[]): SimulationEvent[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const sql = `SELECT * FROM events WHERE id IN (${placeholders})`;
  const rows = (getDb().prepare(sql).all(...ids) as any[]).map(rowToEvent);
  const byId = new Map(rows.map((event) => [event.id, event]));
  return ids
    .map((id) => byId.get(id))
    .filter((event): event is SimulationEvent => !!event);
}

export function getLatestEvents(count: number): SimulationEvent[] {
  const sql = `SELECT * FROM events ORDER BY game_day DESC, game_tick DESC, rowid DESC LIMIT ?`;
  return (getDb().prepare(sql).all(count) as any[]).map(rowToEvent);
}

export function countEvents(filter?: EventQueryFilter): number {
  const { sql: where, params } = buildWhereClause(filter ?? {});
  const sql = `SELECT COUNT(*) as cnt FROM events ${where}`;
  return (getDb().prepare(sql).get(...params) as { cnt: number }).cnt;
}
