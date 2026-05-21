import fs from "node:fs";
import path from "node:path";
import { getDb, getDbPath, closeDb, initDatabase } from "./db.js";
import type { GameTime } from "../types/index.js";
import { generateId } from "../utils/id-generator.js";

export interface SnapshotMeta {
  id: string;
  gameDay: number;
  gameTick: number;
  description: string;
  filePath: string;
  createdAt: string;
}

function getSnapshotsDir(): string {
  try {
    return path.join(path.dirname(getDbPath()), "snapshots");
  } catch {
    return path.resolve("data/snapshots");
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function createSnapshot(gameTime: GameTime, description?: string): string {
  const SNAPSHOTS_DIR = getSnapshotsDir();
  ensureDir(SNAPSHOTS_DIR);

  const id = generateId();
  const fileName = `snapshot_${gameTime.day}_${gameTime.tick}_${id}.db`;
  const filePath = path.join(SNAPSHOTS_DIR, fileName);

  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");

  fs.copyFileSync(getDbPath(), filePath);

  db.prepare(
    `INSERT INTO snapshots (id, game_day, game_tick, description, file_path) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, gameTime.day, gameTime.tick, description ?? "", filePath);

  return id;
}

export function listSnapshots(): SnapshotMeta[] {
  return (
    getDb().prepare("SELECT * FROM snapshots ORDER BY created_at DESC").all() as any[]
  ).map((r) => ({
    id: r.id,
    gameDay: r.game_day,
    gameTick: r.game_tick,
    description: r.description,
    filePath: r.file_path,
    createdAt: r.created_at,
  }));
}

export function restoreSnapshot(snapshotId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId) as any;
  if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);

  const dbPath = getDbPath();
  const snapshotPath: string = row.file_path;

  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found: ${snapshotPath}`);
  }

  closeDb();

  for (const suffix of ["-wal", "-shm"]) {
    const f = dbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  fs.copyFileSync(snapshotPath, dbPath);
  initDatabase(dbPath);
}

export function deleteSnapshot(snapshotId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT file_path FROM snapshots WHERE id = ?").get(snapshotId) as
    | { file_path: string }
    | undefined;
  if (!row) return;

  if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);
  db.prepare("DELETE FROM snapshots WHERE id = ?").run(snapshotId);
}

export function createBranch(snapshotId: string, branchName: string): string {
  const db = getDb();
  const row = db.prepare("SELECT file_path FROM snapshots WHERE id = ?").get(snapshotId) as
    | { file_path: string }
    | undefined;
  if (!row) throw new Error(`Snapshot not found: ${snapshotId}`);
  if (!fs.existsSync(row.file_path)) {
    throw new Error(`Snapshot file not found: ${row.file_path}`);
  }

  const branchDir = path.resolve("data/branches");
  ensureDir(branchDir);

  const branchPath = path.join(branchDir, `${branchName}.db`);
  fs.copyFileSync(row.file_path, branchPath);
  return branchPath;
}
