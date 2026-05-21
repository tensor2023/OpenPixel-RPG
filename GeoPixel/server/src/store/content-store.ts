import { getDb } from "./db.js";
import type { ContentCandidate } from "../types/index.js";

function rowToCandidate(row: any): ContentCandidate {
  return {
    id: row.id,
    eventId: row.event_id,
    type: row.type as ContentCandidate["type"],
    dramScore: row.dram_score,
    content: row.content,
    characterId: row.character_id ?? undefined,
    context: row.context ?? undefined,
    tags: JSON.parse(row.tags),
    reviewed: row.reviewed === 1,
  };
}

const INSERT_SQL = `INSERT INTO content_candidates
  (id, event_id, type, dram_score, content, character_id, context, tags, reviewed)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function insertCandidate(candidate: ContentCandidate): void {
  getDb()
    .prepare(INSERT_SQL)
    .run(
      candidate.id,
      candidate.eventId,
      candidate.type,
      candidate.dramScore,
      candidate.content,
      candidate.characterId ?? null,
      candidate.context ?? null,
      JSON.stringify(candidate.tags),
      candidate.reviewed ? 1 : 0,
    );
}

export interface CandidateFilter {
  type?: ContentCandidate["type"];
  reviewed?: boolean;
  minDramScore?: number;
  limit?: number;
}

export function getCandidates(filter: CandidateFilter = {}): ContentCandidate[] {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (filter.type !== undefined) {
    conds.push("type = ?");
    params.push(filter.type);
  }
  if (filter.reviewed !== undefined) {
    conds.push("reviewed = ?");
    params.push(filter.reviewed ? 1 : 0);
  }
  if (filter.minDramScore !== undefined) {
    conds.push("dram_score >= ?");
    params.push(filter.minDramScore);
  }

  let sql = `SELECT * FROM content_candidates`;
  if (conds.length > 0) {
    sql += ` WHERE ${conds.join(" AND ")}`;
  }
  sql += ` ORDER BY dram_score DESC`;

  if (filter.limit !== undefined) {
    sql += ` LIMIT ?`;
    params.push(filter.limit);
  }

  return (getDb().prepare(sql).all(...params) as any[]).map(rowToCandidate);
}

export function markReviewed(id: string): void {
  getDb()
    .prepare("UPDATE content_candidates SET reviewed = 1 WHERE id = ?")
    .run(id);
}

export function deleteCandidate(id: string): void {
  getDb().prepare("DELETE FROM content_candidates WHERE id = ?").run(id);
}
