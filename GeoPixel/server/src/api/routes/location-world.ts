import Database from "better-sqlite3";
import { Router } from "express";
import type { Request, Response } from "express";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  locationJobManager,
  LocationJobConflictError,
  type LocationJobEvent,
} from "../../core/location-job-manager.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORLDSPARK_ROOT = path.resolve(__dirname, "../../../..");
const TILES_CACHE_DIR = path.join(WORLDSPARK_ROOT, "output/location-tiles");
const MANIFEST_PATH = path.join(TILES_CACHE_DIR, "manifest.json");

// ── isometric-nyc tile lookup ──────────────────────────────────────────────
const ISO_NYC_DB_PATH = path.resolve(WORLDSPARK_ROOT, "../ref/isometric-nyc-main/generations/tiny-nyc/quadrants.db");

/** Manhattan bounding box covered by isometric-nyc quadrants.db */
const NYC_BOUNDS = {
  minLat: 40.726,
  maxLat: 40.771,
  minLng: -74.010,
  maxLng: -73.961,
} as const;

interface NycTileResult {
  filePath: string;
  filename: string;
  quadrantX: number;
  quadrantY: number;
  tileLat: number;
  tileLng: number;
}

const STITCH_SCRIPT = path.resolve(__dirname, "utils", "stitch_tiles.py");

async function fetchIsometricNycTile(lat: number, lng: number, location: string): Promise<NycTileResult | null> {
  if (lat < NYC_BOUNDS.minLat || lat > NYC_BOUNDS.maxLat ||
      lng < NYC_BOUNDS.minLng || lng > NYC_BOUNDS.maxLng) {
    return null;
  }

  let db: ReturnType<typeof Database> | null = null;
  try {
    if (!existsSync(ISO_NYC_DB_PATH)) {
      console.warn("[LocationWorld] isometric-nyc DB not found at", ISO_NYC_DB_PATH);
      return null;
    }
    db = new Database(ISO_NYC_DB_PATH, { readonly: true });

    const row = db.prepare(`
      SELECT quadrant_x, quadrant_y, lat, lng, LENGTH(generation) as gen_len
      FROM quadrants
      WHERE generation IS NOT NULL
      ORDER BY (lat-?)*(lat-?)+(lng-?)*(lng-?)
      LIMIT 1
    `).get(lat, lat, lng, lng) as { quadrant_x: number; quadrant_y: number; lat: number; lng: number; gen_len: number } | undefined;

    if (!row || row.gen_len === 0) {
      console.warn("[LocationWorld] No generated tile near", lat, lng);
      return null;
    }

    const { quadrant_x: qx, quadrant_y: qy, lat: centerLat, lng: centerLng } = row;

    // Determine 2×2 block: nearest tile is bottom-right corner
    // TL=(qx-1, qy-1), TR=(qx, qy-1), BL=(qx-1, qy), BR=(qx, qy)
    const tileCoords: Array<[number, number, string]> = [
      [qx - 1, qy - 1, "tl"],
      [qx,     qy - 1, "tr"],
      [qx - 1, qy,     "bl"],
      [qx,     qy,     "br"],
    ];

    const allInBounds = tileCoords.every(([x, y]) => x >= -10 && x <= 10 && y >= -10 && y <= 10);
    const getGen = (x: number, y: number): Buffer | null =>
      db!.prepare("SELECT generation FROM quadrants WHERE quadrant_x=? AND quadrant_y=?").pluck().get(x, y) as Buffer | undefined ?? null;

    if (!allInBounds) {
      // Near grid edge: fall back to single tile
      const blob = getGen(qx, qy);
      if (!blob) return null;
      mkdirSync(TILES_CACHE_DIR, { recursive: true });
      const t = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const s = location.replace(/[^\w一-鿿]/g, "_").slice(0, 40);
      const fn = `${t}-nyc-${qx}_${qy}-${s}.png`;
      const fp = path.join(TILES_CACHE_DIR, fn);
      writeFileSync(fp, blob);
      console.log(`[LocationWorld] Single tile fallback → ${fp} (${blob.length} bytes)`);
      return { filePath: fp, filename: fn, quadrantX: qx, quadrantY: qy, tileLat: centerLat, tileLng: centerLng };
    }

    // Fetch all 4 blobs
    const blobs = tileCoords.map(([x, y]) => getGen(x, y));
    if (blobs.some((b) => !b)) {
      // Missing tile: fall back to single nearest tile
      const blob = getGen(qx, qy);
      if (!blob) return null;
      mkdirSync(TILES_CACHE_DIR, { recursive: true });
      const t = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const s = location.replace(/[^\w一-鿿]/g, "_").slice(0, 40);
      const fn = `${t}-nyc-${qx}_${qy}-${s}.png`;
      const fp = path.join(TILES_CACHE_DIR, fn);
      writeFileSync(fp, blob);
      console.log(`[LocationWorld] Single tile fallback (missing neighbor) → ${fp} (${blob.length} bytes)`);
      return { filePath: fp, filename: fn, quadrantX: qx, quadrantY: qy, tileLat: centerLat, tileLng: centerLng };
    }

    // Write 4 temp tiles
    mkdirSync(TILES_CACHE_DIR, { recursive: true });
    const t = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const s = location.replace(/[^\w一-鿿]/g, "_").slice(0, 40);
    const tmpPaths = tileCoords.map(([x, y, tag]) => {
      const p = path.join(TILES_CACHE_DIR, `${t}-nyc-${tag}-${x}_${y}-${s}.png`);
      writeFileSync(p, blobs[tileCoords.findIndex((c) => c[2] === tag)]!);
      return p;
    });

    // Stitch into 2×2 composite (1024×1024)
    const outputFn = `${t}-nyc-${qx}_${qy}-${s}.png`;
    const outputPath = path.join(TILES_CACHE_DIR, outputFn);
    await execFileAsync("python3", [STITCH_SCRIPT, ...tmpPaths, outputPath]);

    // Clean up temp tiles
    for (const p of tmpPaths) {
      try { unlinkSync(p); } catch {}
    }

    console.log(`[LocationWorld] Stitched 4 tiles → ${outputPath}`);
    return { filePath: outputPath, filename: outputFn, quadrantX: qx, quadrantY: qy, tileLat: centerLat, tileLng: centerLng };
  } catch (err) {
    console.warn("[LocationWorld] isometric-nyc tile lookup failed:", err);
    return null;
  } finally {
    if (db) db.close();
  }
}

const router = Router();

// ── proxy-aware HTTP helper using curl ────────────────────────────────────
// Node's built-in fetch does not honour HTTPS_PROXY; curl does.

async function curlGetBuffer(url: string): Promise<Buffer> {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "";
  const args = ["--silent", "--location", "--max-time", "30", "--fail"];
  if (proxy) args.push("--proxy", proxy);
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, {
    maxBuffer: 20 * 1024 * 1024,
    encoding: "buffer" as unknown as BufferEncoding,
  } as Parameters<typeof execFileAsync>[2]);

  return stdout as unknown as Buffer;
}

// ── helpers ───────────────────────────────────────────────────────────────

async function geocodeLocation(location: string): Promise<{ lat: number; lng: number }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set in .env");

  const candidates: string[] = [location];

  // Generate alternative query formats when the user's natural language input fails
  const trimmed = location.trim();
  // "New York XXX" or "XXX New York" → try "XXX, New York"
  const nyMatch = trimmed.match(/^(?:New\s+York\s+)?(.+?)(?:\s+New\s+York)?$/i);
  if (nyMatch && nyMatch[1] !== trimmed) {
    candidates.push(`${nyMatch[1]}, New York`);
    candidates.push(`${nyMatch[1]}, NYC`);
  }
  // "纽约市XXX" → try "XXX,纽约"
  const cnMatch = trimmed.match(/^纽约市(.+)/);
  if (cnMatch) {
    candidates.push(`${cnMatch[1]},纽约`);
    candidates.push(`${cnMatch[1]},New York`);
  }

  let lastError = "";
  for (const query of candidates) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;
    const buf = await curlGetBuffer(url);
    let data: { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }>; error_message?: string };
    try {
      data = JSON.parse(buf.toString("utf8"));
    } catch {
      lastError = `Invalid response for "${query}"`;
      continue;
    }
    if (data.status === "OK" && data.results?.[0]) {
      console.log(`[LocationWorld] Geocoded "${query}" → ${data.results[0].geometry.location.lat}, ${data.results[0].geometry.location.lng}`);
      return data.results[0].geometry.location;
    }
    lastError = `Geocode failed: ${data.status} for "${query}"${data.error_message ? ` — ${data.error_message}` : ""}`;
  }

  throw new Error(lastError);
}

async function fetchMapTile(
  lat: number,
  lng: number,
  location: string,
): Promise<{ filePath: string; filename: string }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY not set in .env");

  // size=512x512 + scale=2 → 1024×1024 pixels, matching nyc_source_tiles format
  const url =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${lat},${lng}&zoom=15&size=512x512&scale=2` +
    `&maptype=satellite&key=${apiKey}`;

  const imageBuf = await curlGetBuffer(url);

  // Basic sanity check: PNG starts with 0x89 PNG header
  if (imageBuf.length < 8 || imageBuf[0] !== 0x89) {
    throw new Error(
      `Static Maps returned unexpected data (${imageBuf.length} bytes): ${imageBuf.slice(0, 80).toString("utf8")}`,
    );
  }

  mkdirSync(TILES_CACHE_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = location.replace(/[^\w一-鿿]/g, "_").slice(0, 40);
  const filename = `${timestamp}-${safeName}.png`;
  const filePath = path.join(TILES_CACHE_DIR, filename);

  writeFileSync(filePath, imageBuf);
  console.log(`[LocationWorld] Saved tile: ${filePath} (${imageBuf.length} bytes)`);
  return { filePath, filename };
}

// ── manifest helpers ──────────────────────────────────────────────────────

interface ManifestEntry {
  location: string;
  worldId: string;
  worldName: string;
  tileFilename: string;
  createdAt: string;
}

function readManifest(): ManifestEntry[] {
  try {
    if (!existsSync(MANIFEST_PATH)) return [];
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestEntry[];
  } catch {
    return [];
  }
}

function appendManifest(entry: ManifestEntry): void {
  const list = readManifest().filter((e) => e.worldId !== entry.worldId);
  list.unshift(entry);
  mkdirSync(TILES_CACHE_DIR, { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(list, null, 2));
  console.log(`[LocationWorld] Manifest updated: ${entry.location} → ${entry.worldId}`);
}

// ── routes ────────────────────────────────────────────────────────────────

// Step 1: Geocode + fetch satellite tile only (no pipeline)
router.post("/fetch-tile", async (req: Request, res: Response) => {
  const location = typeof req.body?.location === "string" ? req.body.location.trim() : "";
  if (!location) {
    res.status(400).json({ error: "location is required" });
    return;
  }

  try {
    const { lat, lng } = await geocodeLocation(location);
    console.log(`[LocationWorld] Geocoded "${location}" → ${lat}, ${lng}`);

    // Try isometric-nyc pixel tile first (for Manhattan locations)
    const nycTile = await fetchIsometricNycTile(lat, lng, location);
    if (nycTile) {
      const fileSize = statSync(nycTile.filePath).size;
      res.json({
        ok: true,
        filename: nycTile.filename,
        fileSize,
        lat,
        lng,
        source: "isometric-nyc",
        tileX: nycTile.quadrantX,
        tileY: nycTile.quadrantY,
        tileLat: nycTile.tileLat,
        tileLng: nycTile.tileLng,
        previewUrl: `/api/location/tiles/${encodeURIComponent(nycTile.filename)}`,
      });
      return;
    }

    // Fallback: Google Static Maps satellite tile
    const { filePath, filename } = await fetchMapTile(lat, lng, location);
    const fileSize = statSync(filePath).size;

    res.json({
      ok: true,
      filename,
      fileSize,
      lat,
      lng,
      source: "satellite",
      previewUrl: `/api/location/tiles/${encodeURIComponent(filename)}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[LocationWorld] fetch-tile failed:", message);
    res.status(500).json({ error: message });
  }
});

// Serve cached tile PNG
router.get("/tiles/:filename", (req: Request, res: Response) => {
  const filename = String(req.params.filename);
  if (!filename || filename.includes("..") || filename.includes("/")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  res.sendFile(filename, { root: TILES_CACHE_DIR, dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) {
      const nodeErr = err as NodeJS.ErrnoException & { status?: number };
      if (nodeErr.status === 404 || nodeErr.code === "ENOENT") {
        res.status(404).json({ error: "Tile not found" });
      } else {
        res.status(500).json({ error: "Failed to serve tile" });
      }
    }
  });
});

// History: list all previously generated location worlds
router.get("/history", (_req, res) => {
  res.json(readManifest());
});

// Step 2: Start GeoPixel pipeline with a pre-fetched tile
router.post("/create-world", async (req: Request, res: Response) => {
  const tileFilename = typeof req.body?.tileFilename === "string" ? req.body.tileFilename.trim() : "";
  const location = typeof req.body?.location === "string" ? req.body.location.trim() : "";
  const fastMode = req.body?.fastMode === true;

  if (!tileFilename || !location) {
    res.status(400).json({ error: "tileFilename and location are required" });
    return;
  }
  if (tileFilename.includes("..") || tileFilename.includes("/")) {
    res.status(400).json({ error: "Invalid tileFilename" });
    return;
  }

  const imagePath = path.join(TILES_CACHE_DIR, tileFilename);

  try {
    const { jobId } = locationJobManager.startJob({ imagePath, locationDescription: location, fastMode });

    // Write manifest when job completes successfully
    const listener = (eventJobId: string, event: LocationJobEvent) => {
      if (eventJobId !== jobId) return;
      if (event.kind === "job_done") {
        const worldId = event.worldId;
        if (worldId) {
          appendManifest({
            location,
            worldId,
            worldName: worldId,
            tileFilename,
            createdAt: new Date().toISOString(),
          });
        }
        locationJobManager.off("event", listener);
      } else if (event.kind === "job_error") {
        locationJobManager.off("event", listener);
      }
    };
    locationJobManager.on("event", listener);

    res.json({ ok: true, jobId });
  } catch (err) {
    if (err instanceof LocationJobConflictError) {
      res.status(409).json({ error: err.message, activeJobId: err.activeJobId });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[LocationWorld] create-world failed:", message);
    res.status(500).json({ error: message });
  }
});

// Query current job
router.get("/jobs/current", (_req, res) => {
  const jobId = locationJobManager.getCurrentJobId();
  if (!jobId) {
    res.json({ jobId: null });
    return;
  }
  res.json({ jobId, snapshot: locationJobManager.getSnapshot(jobId) });
});

// Snapshot
router.get("/jobs/:jobId", (req, res) => {
  const snapshot = locationJobManager.getSnapshot(String(req.params.jobId));
  if (!snapshot) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(snapshot);
});

// Cancel
router.post("/jobs/:jobId/cancel", (req, res) => {
  try {
    locationJobManager.cancelJob(String(req.params.jobId));
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(409).json({ error: message });
  }
});

// SSE event stream
router.get("/jobs/:jobId/events", (req: Request, res: Response) => {
  const jobId = String(req.params.jobId);
  const snapshot = locationJobManager.getSnapshot(jobId);
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

  const writeEvent = (event: LocationJobEvent) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {}
  };

  for (const event of locationJobManager.getHistory(jobId)) {
    writeEvent(event);
  }

  if (snapshot.status !== "running") {
    res.end();
    return;
  }

  const listener = (eventJobId: string, event: LocationJobEvent) => {
    if (eventJobId !== jobId) return;
    writeEvent(event);
    if (event.kind === "job_done" || event.kind === "job_error") {
      setTimeout(() => res.end(), 50);
    }
  };

  locationJobManager.on("event", listener);

  const heartbeat = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 15_000);
  heartbeat.unref?.();

  req.on("close", () => {
    locationJobManager.off("event", listener);
    clearInterval(heartbeat);
  });
});

export default router;
