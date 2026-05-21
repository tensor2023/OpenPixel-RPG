import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORLDSPARK_ROOT = path.resolve(__dirname, "../../..");
const IMAGE_ENTRY = path.join(WORLDSPARK_ROOT, "generators/map/src/index-from-image.mjs");
const HARD_TIMEOUT_MS = parseInt(process.env.LOCATION_JOB_HARD_TIMEOUT_MS || `${25 * 60 * 1000}`, 10);
const MAX_EVENT_BUFFER = 500;
const MAX_LOG_BUFFER = 2000;

export type LocationJobEvent =
  | { kind: "job_started"; at: number; jobId: string; location: string }
  | { kind: "step"; at: number; phase: number; step: string; label: string }
  | { kind: "info"; at: number; label: string }
  | { kind: "world_id"; at: number; worldId: string }
  | { kind: "log"; at: number; stream: "stdout" | "stderr"; line: string }
  | { kind: "job_done"; at: number; worldId: string }
  | { kind: "job_error"; at: number; message: string; tail: string[] };

export interface LocationJobSnapshot {
  jobId: string;
  status: "running" | "done" | "error";
  location: string;
  phase: number | null;
  step: string | null;
  startedAt: number;
  finishedAt: number | null;
  worldId: string | null;
  error: string | null;
}

interface ActiveJob {
  jobId: string;
  location: string;
  child: ChildProcess;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "done" | "error";
  phase: number | null;
  step: string | null;
  worldId: string | null;
  error: string | null;
  events: LocationJobEvent[];
  logTail: string[];
  hardTimeoutHandle: NodeJS.Timeout | null;
}

export class LocationJobConflictError extends Error {
  constructor(public readonly activeJobId: string) {
    super(`Another location world generation is already running: ${activeJobId}`);
    this.name = "LocationJobConflictError";
  }
}

class LocationJobManager extends EventEmitter {
  private current: ActiveJob | null = null;

  hasActiveJob(): boolean {
    return this.current !== null && this.current.status === "running";
  }

  getCurrentJobId(): string | null {
    return this.current?.jobId ?? null;
  }

  getSnapshot(jobId: string): LocationJobSnapshot | null {
    if (!this.current || this.current.jobId !== jobId) return null;
    const j = this.current;
    return {
      jobId: j.jobId,
      status: j.status,
      location: j.location,
      phase: j.phase,
      step: j.step,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      worldId: j.worldId,
      error: j.error,
    };
  }

  getHistory(jobId: string): LocationJobEvent[] {
    if (!this.current || this.current.jobId !== jobId) return [];
    return [...this.current.events];
  }

  cancelJob(jobId: string): void {
    if (!this.current || this.current.jobId !== jobId) throw new Error("Job not found");
    if (this.current.status !== "running") throw new Error("Job is not running");
    const job = this.current;
    try { job.child.kill("SIGTERM"); } catch {}
    this.finishError(job, "Cancelled by user");
  }

  startJob(params: { imagePath: string; locationDescription: string; fastMode?: boolean }): { jobId: string } {
    if (this.hasActiveJob()) {
      throw new LocationJobConflictError(this.current!.jobId);
    }

    const jobId = `locjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const child = spawn(
      process.execPath,
      [IMAGE_ENTRY, "--image", params.imagePath, params.locationDescription],
      {
        cwd: WORLDSPARK_ROOT,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          ...(params.fastMode ? { STEP4_FAST_MODE: "true" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const job: ActiveJob = {
      jobId,
      location: params.locationDescription,
      child,
      startedAt: Date.now(),
      finishedAt: null,
      status: "running",
      phase: null,
      step: null,
      worldId: null,
      error: null,
      events: [],
      logTail: [],
      hardTimeoutHandle: null,
    };

    this.current = job;
    this.recordEvent(job, { kind: "job_started", at: job.startedAt, jobId, location: params.locationDescription });
    this.attachLineReaders(job);

    child.on("error", (err) => this.finishError(job, `spawn failed: ${err.message}`));
    child.on("close", (code, signal) => {
      if (job.status !== "running") return;
      if (code === 0) {
        this.finishSuccess(job);
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        this.finishError(job, `Pipeline failed (${reason})`);
      }
    });

    job.hardTimeoutHandle = setTimeout(() => {
      if (job.status !== "running") return;
      try { job.child.kill("SIGTERM"); } catch {}
      this.finishError(job, `Location pipeline timed out after ${HARD_TIMEOUT_MS}ms`);
    }, HARD_TIMEOUT_MS);
    job.hardTimeoutHandle.unref?.();

    return { jobId };
  }

  private attachLineReaders(job: ActiveJob) {
    if (!job.child.stdout || !job.child.stderr) return;
    const out = readline.createInterface({ input: job.child.stdout });
    out.on("line", (l) => this.handleLine(job, l, "stdout"));
    const err = readline.createInterface({ input: job.child.stderr });
    err.on("line", (l) => this.handleLine(job, l, "stderr"));
  }

  private handleLine(job: ActiveJob, rawLine: string, stream: "stdout" | "stderr") {
    const line = stripAnsi(rawLine).trimEnd();
    if (!line) return;
    job.logTail.push(line);
    if (job.logTail.length > MAX_LOG_BUFFER) job.logTail.splice(0, job.logTail.length - MAX_LOG_BUFFER);
    this.recordEvent(job, { kind: "log", at: Date.now(), stream, line });
    this.parseProgress(job, line);
  }

  private parseProgress(job: ActiveJob, line: string) {
    // "  Run ID:     2024-05-18T10-30-45" → world ID
    const runIdMatch = line.match(/^\s*Run ID:\s+(.+)$/);
    if (runIdMatch) {
      const worldId = runIdMatch[1].trim();
      if (worldId && !job.worldId) {
        job.worldId = worldId;
        this.recordEvent(job, { kind: "world_id", at: Date.now(), worldId });
      }
      return;
    }

    // "[World] Registered world → /abs/path/worldId"
    const regMatch = line.match(/\[World\] Registered world → (.+)/);
    if (regMatch && !job.worldId) {
      const worldId = path.basename(regMatch[1].trim());
      job.worldId = worldId;
      this.recordEvent(job, { kind: "world_id", at: Date.now(), worldId });
      return;
    }

    // "═══ Phase 2 · Step N: Label ═══"
    const stepMatch = line.match(/═══\s+(?:Phase\s+(\d+)\s+·\s+)?Step\s+([\w.]+):\s+(.+?)\s+═══/);
    if (stepMatch) {
      const phase = stepMatch[1] ? parseInt(stepMatch[1], 10) : 2;
      const step = stepMatch[2];
      const label = stepMatch[3].trim();
      job.phase = phase;
      job.step = `Step ${step}`;
      this.recordEvent(job, { kind: "step", at: Date.now(), phase, step, label });
      return;
    }

    if (line.includes("Map generation complete")) {
      this.recordEvent(job, { kind: "info", at: Date.now(), label: "地图生成完成，正在整理输出…" });
    }
  }

  private finishSuccess(job: ActiveJob) {
    if (job.status !== "running") return;
    job.status = "done";
    job.finishedAt = Date.now();
    this.clearTimeout(job);
    this.recordEvent(job, { kind: "job_done", at: job.finishedAt, worldId: job.worldId ?? "" });
  }

  private finishError(job: ActiveJob, message: string) {
    if (job.status !== "running") return;
    job.status = "error";
    job.finishedAt = Date.now();
    job.error = message;
    this.clearTimeout(job);
    this.recordEvent(job, { kind: "job_error", at: job.finishedAt, message, tail: job.logTail.slice(-30) });
  }

  private clearTimeout(job: ActiveJob) {
    if (job.hardTimeoutHandle) {
      clearTimeout(job.hardTimeoutHandle);
      job.hardTimeoutHandle = null;
    }
  }

  private recordEvent(job: ActiveJob, event: LocationJobEvent) {
    job.events.push(event);
    if (job.events.length > MAX_EVENT_BUFFER) job.events.splice(0, job.events.length - MAX_EVENT_BUFFER);
    this.emit("event", job.jobId, event);
  }
}

function stripAnsi(input: string): string {
  return input.replace(/\[[0-9;]*[a-zA-Z]/g, "");
}

export const locationJobManager = new LocationJobManager();
