import { getDb } from "../store/db.js";
import { generateId } from "../utils/id-generator.js";
import type { LLMCallLog } from "../types/index.js";

const DEFAULT_INPUT_PRICE_PER_1K = 0.001;
const DEFAULT_OUTPUT_PRICE_PER_1K = 0.002;

let tokenPricing: { input: number; output: number } = {
  input: DEFAULT_INPUT_PRICE_PER_1K,
  output: DEFAULT_OUTPUT_PRICE_PER_1K,
};

export function setTokenPricing(input: number, output: number): void {
  tokenPricing = { input, output };
}

export function calculateCost(
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1000) * tokenPricing.input +
    (completionTokens / 1000) * tokenPricing.output
  );
}

export function logCall(log: LLMCallLog): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO llm_call_logs (id, task_type, character_id, model, prompt_tokens, completion_tokens, cost, duration_ms, success, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    log.id || generateId(),
    log.taskType,
    log.characterId ?? null,
    log.model,
    log.promptTokens,
    log.completionTokens,
    log.cost,
    log.durationMs,
    log.success ? 1 : 0,
    log.error ?? null,
  );
}

export function getDailyCost(date?: string): number {
  const db = getDb();
  const dateFilter = date ?? new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost), 0) AS total FROM llm_call_logs WHERE date(created_at) = ?`,
    )
    .get(dateFilter) as { total: number };
  return row.total;
}

export function getCostByTaskType(
  fromDate?: string,
): { task_type: string; total_cost: number }[] {
  const db = getDb();
  let sql = `SELECT task_type, COALESCE(SUM(cost), 0) AS total FROM llm_call_logs`;
  const params: string[] = [];
  if (fromDate) {
    sql += ` WHERE created_at >= ?`;
    params.push(fromDate);
  }
  sql += ` GROUP BY task_type`;

  const rows = db.prepare(sql).all(...params) as {
    task_type: string;
    total: number;
  }[];

  return rows.map((row) => ({
    task_type: row.task_type,
    total_cost: row.total,
  }));
}

export function getCallStats(
  fromDate?: string,
): { total: number; success: number; failed: number; avgDuration: number } {
  const db = getDb();
  let sql = `SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
    COALESCE(AVG(duration_ms), 0) AS avg_duration
  FROM llm_call_logs`;
  const params: string[] = [];
  if (fromDate) {
    sql += ` WHERE created_at >= ?`;
    params.push(fromDate);
  }

  const row = db.prepare(sql).get(...params) as {
    total: number;
    success: number;
    failed: number;
    avg_duration: number;
  };

  return {
    total: row.total,
    success: row.success,
    failed: row.failed,
    avgDuration: Math.round(row.avg_duration),
  };
}
