import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

let db: Database.Database | null = null;
let currentDbPath: string | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  location TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  inner_monologue TEXT,
  dram_score REAL,
  tags TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(game_day, game_tick);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,
  emotional_valence REAL DEFAULT 0,
  emotional_intensity REAL DEFAULT 0,
  related_characters TEXT DEFAULT '[]',
  related_location TEXT DEFAULT '',
  related_objects TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  decay_factor REAL DEFAULT 1.0,
  access_count INTEGER DEFAULT 0,
  is_long_term INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mem_char ON memories(character_id);
CREATE INDEX IF NOT EXISTS idx_mem_importance ON memories(character_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_mem_time ON memories(character_id, game_day DESC, game_tick DESC);

CREATE TABLE IF NOT EXISTS character_states (
  character_id TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  main_area_point_id TEXT,
  current_action TEXT,
  current_action_target TEXT,
  action_start_tick INTEGER DEFAULT 0,
  action_end_tick INTEGER DEFAULT 0,
  emotion_valence REAL DEFAULT 0,
  emotion_arousal REAL DEFAULT 3,
  curiosity REAL DEFAULT 100,
  daily_plan TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_object_states (
  object_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  state TEXT DEFAULT 'normal',
  state_description TEXT DEFAULT '',
  current_users TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_global_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  game_day INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  game_day INTEGER NOT NULL,
  game_tick INTEGER NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS llm_call_logs (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  character_id TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_candidates (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  type TEXT NOT NULL,
  dram_score REAL DEFAULT 0,
  content TEXT NOT NULL,
  character_id TEXT,
  context TEXT,
  tags TEXT DEFAULT '[]',
  reviewed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export function initDatabase(dbPath?: string): Database.Database {
  const resolvedPath =
    dbPath ?? process.env.DB_PATH ?? path.resolve("data/mist-town.db");

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  currentDbPath = resolvedPath;
  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);

  runMigrations(db);

  return db;
}

function runMigrations(database: Database.Database): void {
  const hasColumn = database
    .prepare(`PRAGMA table_info(memories)`)
    .all()
    .some((col: any) => col.name === "embedding");
  if (!hasColumn) {
    database.exec(`ALTER TABLE memories ADD COLUMN embedding TEXT DEFAULT NULL`);
  }

  const hasMainAreaPointId = database
    .prepare(`PRAGMA table_info(character_states)`)
    .all()
    .some((col: any) => col.name === "main_area_point_id");
  if (!hasMainAreaPointId) {
    database.exec(`ALTER TABLE character_states ADD COLUMN main_area_point_id TEXT DEFAULT NULL`);
  }
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function getDbPath(): string {
  if (!currentDbPath) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return currentDbPath;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
