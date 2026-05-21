import { Router } from "express";
import type { Request, Response } from "express";
import {
  createJobManager,
  JobConflictError,
  type JobEvent,
} from "../../core/create-job-manager.js";

const router = Router();

router.post("/create", (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
  const sizeKRaw = req.body?.sizeK;
  const sizeK = Number(sizeKRaw) as 1 | 2 | 4;
  const keepArtifacts = req.body?.keepArtifacts === true;

  if (!prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  if (![1, 2, 4].includes(sizeK)) {
    res.status(400).json({ error: "sizeK must be 1, 2, or 4" });
    return;
  }

  try {
    const { jobId } = createJobManager.startJob({ prompt, sizeK, keepArtifacts });
    res.json({ ok: true, jobId });
  } catch (err) {
    if (err instanceof JobConflictError) {
      res.status(409).json({
        error: "Another generation is already running",
        activeJobId: err.activeJobId,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.get("/jobs/current", (_req, res) => {
  const jobId = createJobManager.getCurrentJobId();
  if (!jobId) {
    res.json({ jobId: null });
    return;
  }
  res.json({ jobId, snapshot: createJobManager.getSnapshot(jobId) });
});

router.get("/jobs/:jobId", (req, res) => {
  const snapshot = createJobManager.getSnapshot(String(req.params.jobId));
  if (!snapshot) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(snapshot);
});

router.post("/jobs/:jobId/cancel", (req, res) => {
  try {
    createJobManager.cancelJob(String(req.params.jobId));
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === "Job not found" ? 404 : 409;
    res.status(status).json({ error: message });
  }
});

router.get("/jobs/:jobId/events", (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const snapshot = createJobManager.getSnapshot(jobId);
  if (!snapshot) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const writeEvent = (event: JobEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Socket likely closed; listener cleanup happens in close handler.
    }
  };

  for (const event of createJobManager.getHistory(jobId)) {
    writeEvent(event);
  }

  if (snapshot.status !== "running") {
    res.end();
    return;
  }

  const listener = (eventJobId: string, event: JobEvent) => {
    if (eventJobId !== jobId) return;
    writeEvent(event);
    if (event.kind === "job_done" || event.kind === "job_error") {
      // Give the client a moment to flush, then close the stream.
      setTimeout(() => res.end(), 50);
    }
  };

  createJobManager.on("event", listener);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // Ignore; cleanup handled on close.
    }
  }, 15_000);
  heartbeat.unref?.();

  req.on("close", () => {
    createJobManager.off("event", listener);
    clearInterval(heartbeat);
  });
});

export default router;
