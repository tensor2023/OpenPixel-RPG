import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { syncCharacterAssetsToWorld } from "../utils/sync-character-assets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// `server/src/core` is 3 levels below GeoPixel root.
const WORLDSPARK_ROOT = path.resolve(__dirname, "../../..");
const ORCHESTRATOR_ENTRY = path.join(WORLDSPARK_ROOT, "orchestrator/src/index.mjs");
const GENERATED_WORLDS_DIR = path.join(WORLDSPARK_ROOT, "output/worlds");
const JOB_LOG_DIRNAME = "logs";
const JOB_LOG_FILENAME = "generation.log";

const HARD_TIMEOUT_MS = parseInt(process.env.CREATE_JOB_HARD_TIMEOUT_MS || `${30 * 60 * 1000}`, 10);
const MAX_EVENT_BUFFER = 500;
const MAX_LOG_BUFFER = 2000;

type PhaseId = 1 | 2 | 3 | 4;

export type JobEvent =
  | { kind: "job_started"; at: number; jobId: string; prompt: string; sizeK: 1 | 2 | 4 }
  | { kind: "phase"; at: number; phase: PhaseId; label: string }
  | { kind: "step"; at: number; phase: PhaseId; step: string; label: string }
  | { kind: "info"; at: number; label: string }
  | { kind: "world_id"; at: number; worldId: string }
  | { kind: "log"; at: number; stream: "stdout" | "stderr"; line: string }
  | { kind: "job_done"; at: number; worldId: string; worldName?: string }
  | { kind: "job_error"; at: number; message: string; tail: string[] };

export interface JobSnapshot {
  jobId: string;
  status: "running" | "done" | "error";
  prompt: string;
  sizeK: 1 | 2 | 4;
  phase: PhaseId | null;
  step: string | null;
  startedAt: number;
  finishedAt: number | null;
  worldId: string | null;
  worldName: string | null;
  error: string | null;
}

interface ActiveJob {
  jobId: string;
  prompt: string;
  sizeK: 1 | 2 | 4;
  child: ChildProcess;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "done" | "error";
  phase: PhaseId | null;
  step: string | null;
  worldId: string | null;
  worldName: string | null;
  error: string | null;
  events: JobEvent[];
  logTail: string[];
  pendingPersistedLogs: Array<{ stream: "stdout" | "stderr"; line: string }>;
  persistedLogPath: string | null;
  hardTimeoutHandle: NodeJS.Timeout | null;
}

class CreateJobManager extends EventEmitter {
  private current: ActiveJob | null = null;

  hasActiveJob(): boolean {
    return this.current !== null && this.current.status === "running";
  }

  getJob(jobId: string): ActiveJob | null {
    if (this.current && this.current.jobId === jobId) return this.current;
    return null;
  }

  getCurrentJobId(): string | null {
    return this.current?.jobId ?? null;
  }

  getSnapshot(jobId: string): JobSnapshot | null {
    const job = this.getJob(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      status: job.status,
      prompt: job.prompt,
      sizeK: job.sizeK,
      phase: job.phase,
      step: job.step,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      worldId: job.worldId,
      worldName: job.worldName,
      error: job.error,
    };
  }

  getHistory(jobId: string): JobEvent[] {
    const job = this.getJob(jobId);
    return job ? [...job.events] : [];
  }

  cancelJob(jobId: string): void {
    const job = this.getJob(jobId);
    if (!job) {
      throw new Error("Job not found");
    }
    if (job.status !== "running") {
      throw new Error("Job is not running");
    }

    this.recordEvent(job, {
      kind: "log",
      at: Date.now(),
      stream: "stderr",
      line: "[CreateJobManager] Generation cancelled by user.",
    });
    try {
      job.child.kill("SIGTERM");
      setTimeout(() => {
        try {
          if (!job.child.killed) job.child.kill("SIGKILL");
        } catch {
          // Ignore kill errors during shutdown.
        }
      }, 5000).unref();
    } catch {
      // Ignore kill errors.
    }
    this.finishError(job, "Generation stopped by user");
  }

  startJob(params: { prompt: string; sizeK: 1 | 2 | 4; keepArtifacts?: boolean }): { jobId: string } {
    if (this.hasActiveJob()) {
      throw new JobConflictError(this.current!.jobId);
    }

    const prompt = params.prompt.trim();
    if (!prompt) {
      throw new Error("prompt is required");
    }
    if (![1, 2, 4].includes(params.sizeK)) {
      throw new Error("sizeK must be 1, 2, or 4");
    }

    const jobId = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const child = spawn(
      process.execPath,
      [ORCHESTRATOR_ENTRY, prompt],
      {
        cwd: WORLDSPARK_ROOT,
        env: {
          ...process.env,
          MAP_IMAGE_SIZE_K: String(params.sizeK),
          KEEP_GENERATION_ARTIFACTS: params.keepArtifacts ? "1" : "0",
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const job: ActiveJob = {
      jobId,
      prompt,
      sizeK: params.sizeK,
      child,
      startedAt: Date.now(),
      finishedAt: null,
      status: "running",
      phase: null,
      step: null,
      worldId: null,
      worldName: null,
      error: null,
      events: [],
      logTail: [],
      pendingPersistedLogs: [],
      persistedLogPath: null,
      hardTimeoutHandle: null,
    };

    this.current = job;

    this.recordEvent(job, {
      kind: "job_started",
      at: job.startedAt,
      jobId,
      prompt,
      sizeK: params.sizeK,
    });

    this.attachLineReaders(job);

    child.on("error", (err) => {
      this.finishError(job, `failed to spawn orchestrator: ${err.message}`);
    });

    child.on("close", (code, signal) => {
      if (job.status !== "running") return;
      if (code === 0) {
        this.finishSuccess(job);
      } else {
        const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
        this.finishError(job, `Generation failed (${reason})`);
      }
    });

    job.hardTimeoutHandle = setTimeout(() => {
      if (job.status !== "running") return;
      this.recordEvent(job, {
        kind: "log",
        at: Date.now(),
        stream: "stderr",
        line: `[CreateJobManager] Hard timeout (${HARD_TIMEOUT_MS}ms) reached, killing process...`,
      });
      try {
        job.child.kill("SIGTERM");
        setTimeout(() => {
          try {
            if (!job.child.killed) job.child.kill("SIGKILL");
          } catch {
            // Ignore kill errors during shutdown.
          }
        }, 5000).unref();
      } catch {
        // Ignore kill errors.
      }
      this.finishError(job, `Generation hard-timed out after ${HARD_TIMEOUT_MS}ms`);
    }, HARD_TIMEOUT_MS);
    job.hardTimeoutHandle.unref?.();

    return { jobId };
  }

  private attachLineReaders(job: ActiveJob) {
    if (!job.child.stdout || !job.child.stderr) return;

    const stdoutReader = readline.createInterface({ input: job.child.stdout });
    stdoutReader.on("line", (line) => this.handleLine(job, line, "stdout"));

    const stderrReader = readline.createInterface({ input: job.child.stderr });
    stderrReader.on("line", (line) => this.handleLine(job, line, "stderr"));
  }

  private handleLine(job: ActiveJob, rawLine: string, stream: "stdout" | "stderr") {
    const line = stripAnsi(rawLine).trimEnd();
    if (line.length === 0) return;

    job.logTail.push(line);
    if (job.logTail.length > MAX_LOG_BUFFER) {
      job.logTail.splice(0, job.logTail.length - MAX_LOG_BUFFER);
    }

    if (job.persistedLogPath) {
      this.appendPersistedLogEntry(job.persistedLogPath, stream, line);
    } else {
      job.pendingPersistedLogs.push({ stream, line });
      if (job.pendingPersistedLogs.length > MAX_LOG_BUFFER) {
        job.pendingPersistedLogs.splice(0, job.pendingPersistedLogs.length - MAX_LOG_BUFFER);
      }
      this.maybeInitializePersistedLog(job, line);
    }

    this.recordEvent(job, { kind: "log", at: Date.now(), stream, line });

    this.parseProgress(job, line);
  }

  private maybeInitializePersistedLog(job: ActiveJob, line: string) {
    if (job.persistedLogPath) return;
    const worldIdMatch = line.match(/^World ID:\s+(world_[^\s]+)/);
    const worldId = worldIdMatch?.[1];
    if (!worldId) return;

    try {
      const logsDir = path.join(GENERATED_WORLDS_DIR, worldId, JOB_LOG_DIRNAME);
      mkdirSync(logsDir, { recursive: true });
      const logPath = path.join(logsDir, JOB_LOG_FILENAME);
      writeFileSync(
        logPath,
        [
          `=== GeoPixel Generation Log — ${new Date(job.startedAt).toISOString()} ===`,
          `Job ID: ${job.jobId}`,
          `World ID: ${worldId}`,
          `Prompt: ${job.prompt}`,
          "",
        ].join("\n"),
      );
      job.persistedLogPath = logPath;
      for (const entry of job.pendingPersistedLogs) {
        this.appendPersistedLogEntry(logPath, entry.stream, entry.line);
      }
      job.pendingPersistedLogs = [];
    } catch {
      // Do not break generation if log persistence fails.
    }
  }

  private parseProgress(job: ActiveJob, line: string) {
    // World ID (printed near the top of orchestrator main)
    const worldIdMatch = line.match(/^World ID:\s+(world_[^\s]+)/);
    if (worldIdMatch) {
      job.worldId = worldIdMatch[1];
      this.recordEvent(job, { kind: "world_id", at: Date.now(), worldId: worldIdMatch[1] });
      return;
    }

    // Phase banners from orchestrator: ━━━ Phase N: Label ━━━ or ━━━ Phase 2 + Phase 3: ...
    const phaseBannerMatch = line.match(/━━━\s+Phase\s+([\d+\s]+):\s+(.+?)\s+━━━/);
    if (phaseBannerMatch) {
      const nums = phaseBannerMatch[1]
        .split(/[+\s]+/)
        .map((s) => parseInt(s, 10))
        .filter((n) => n >= 1 && n <= 4) as PhaseId[];
      const label = phaseBannerMatch[2].trim();
      const primary = (nums[0] ?? null) as PhaseId | null;
      if (primary !== null) {
        job.phase = primary;
        job.step = null;
        this.recordEvent(job, { kind: "phase", at: Date.now(), phase: primary, label });
      }
      return;
    }

    // Step banner inside phases:
    //   ═══ Phase 2 · Step N: Label ═══   (after installPhaseStepLogPrefix)
    //   ═══ Step N: Label ═══             (raw, if prefix not applied on that line)
    const stepBannerMatch = line.match(/═══\s+(?:Phase\s+([234])\s+·\s+)?Step\s+([\w.]+):\s+(.+?)\s+═══/);
    if (stepBannerMatch) {
      const phase = (stepBannerMatch[1] ? parseInt(stepBannerMatch[1], 10) : job.phase ?? 2) as PhaseId;
      const step = stepBannerMatch[2];
      const label = stepBannerMatch[3].trim();
      job.phase = phase;
      job.step = `Step ${step}`;
      this.recordEvent(job, {
        kind: "step",
        at: Date.now(),
        phase,
        step,
        label,
      });
      return;
    }

    // Step bracket markers: [Phase 2 · Step N] or [Step N]
    const stepBracketMatch = line.match(/\[(?:Phase\s+([234])\s+·\s+)?Step\s+([\w.]+)\](.*)$/);
    if (stepBracketMatch) {
      const phase = (stepBracketMatch[1] ? parseInt(stepBracketMatch[1], 10) : job.phase ?? 2) as PhaseId;
      const step = stepBracketMatch[2];
      const trailing = stepBracketMatch[3].trim();
      const nextStepKey = `Step ${step}`;
      if (job.step !== nextStepKey || job.phase !== phase) {
        job.phase = phase;
        job.step = nextStepKey;
        this.recordEvent(job, {
          kind: "step",
          at: Date.now(),
          phase,
          step,
          label: trailing || nextStepKey,
        });
      }
      return;
    }

    // Character progress inside Phase 3: "Generating character i/n: name"
    const charMatch = line.match(/^Generating character\s+(\d+)\/(\d+):\s*(.+)$/);
    if (charMatch) {
      const [, idx, total, name] = charMatch;
      job.phase = 3;
      job.step = `char ${idx}/${total}`;
      this.recordEvent(job, {
        kind: "step",
        at: Date.now(),
        phase: 3,
        step: `char-${idx}`,
        label: `Character ${idx}/${total}: ${name.trim()}`,
      });
      return;
    }

    // World designer summary
    const designedMatch = line.match(/\[WorldDesigner\]\s+Designed world:\s+"(.+?)"/);
    if (designedMatch) {
      job.worldName = designedMatch[1];
      this.recordEvent(job, {
        kind: "info",
        at: Date.now(),
        label: `World designed: ${designedMatch[1]}`,
      });
      return;
    }

    // ConfigGenerator done marker
    if (line.startsWith("[ConfigGenerator] Generated configs:")) {
      job.phase = 4;
      this.recordEvent(job, {
        kind: "info",
        at: Date.now(),
        label: "Configs generated",
      });
      return;
    }
  }

  private finishSuccess(job: ActiveJob) {
    if (job.status !== "running") return;
    job.status = "done";
    job.finishedAt = Date.now();
    this.clearHardTimeout(job);

    // Copy spritesheets to the newly generated world so the client can
    // serve them as static assets (char_player, app_npc_*, etc.)
    if (job.worldId) {
      try {
        syncCharacterAssetsToWorld(path.join(GENERATED_WORLDS_DIR, job.worldId));
      } catch (err) {
        console.warn("[CreateJobManager] Failed to sync character assets:", err);
      }
    }

    this.recordEvent(job, {
      kind: "job_done",
      at: job.finishedAt,
      worldId: job.worldId ?? "",
      worldName: job.worldName ?? undefined,
    });
  }

  private finishError(job: ActiveJob, message: string) {
    if (job.status !== "running") return;
    job.status = "error";
    job.finishedAt = Date.now();
    job.error = this.withLogHint(message, job.worldId);
    this.clearHardTimeout(job);
    this.recordEvent(job, {
      kind: "job_error",
      at: job.finishedAt,
      message: job.error,
      tail: job.logTail.slice(-30),
    });
  }

  private clearHardTimeout(job: ActiveJob) {
    if (job.hardTimeoutHandle) {
      clearTimeout(job.hardTimeoutHandle);
      job.hardTimeoutHandle = null;
    }
  }

  private recordEvent(job: ActiveJob, event: JobEvent) {
    job.events.push(event);
    if (job.events.length > MAX_EVENT_BUFFER) {
      job.events.splice(0, job.events.length - MAX_EVENT_BUFFER);
    }
    this.emit("event", job.jobId, event);
  }

  private appendPersistedLogEntry(
    logPath: string,
    stream: "stdout" | "stderr",
    line: string,
  ) {
    try {
      appendFileSync(logPath, `[${new Date().toISOString()}] [${stream}] ${line}\n`);
    } catch {
      // Do not break generation if log persistence fails.
    }
  }

  private withLogHint(message: string, worldId: string | null): string {
    if (!worldId) return message;
    return `${message}. Check logs in output/worlds/${worldId}/${JOB_LOG_DIRNAME}/`;
  }
}

export class JobConflictError extends Error {
  constructor(public readonly activeJobId: string) {
    super(`Another world generation is already running: ${activeJobId}`);
    this.name = "JobConflictError";
  }
}

// Minimal ANSI color stripper; keeps the output readable for UI.
function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\u001B\[[0-9;]*[a-zA-Z]/g, "");
}

export const createJobManager = new CreateJobManager();
