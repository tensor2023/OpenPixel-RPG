import { useEffect, useState, useCallback, useRef } from "react";
import Phaser from "phaser";
import { apiClient } from "../services/api-client";
import { translationStore } from "../services/translation-store";
import type { GeneratedWorldSummary, CreateJobEvent } from "../services/api-client";
import type { ManagedNpcInfo } from "../../types/api";

export function MapControls({
  eventBus,
}: {
  eventBus: Phaser.Events.EventEmitter;
  presentationMode?: boolean;
}) {
  const getInitialControlMode = (): "player" | "camera" => {
    try { return (localStorage.getItem("control-mode") as "player" | "camera") ?? "player"; } catch { return "player"; }
  };
  const [controlMode, setControlMode] = useState<"player" | "camera">(getInitialControlMode);
  const [showWorldSelector, setShowWorldSelector] = useState(false);
  const [showNpcPanel, setShowNpcPanel] = useState(false);
  const [showMapCreator, setShowMapCreator] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [npcDropdownOpen, setNpcDropdownOpen] = useState(false);
  const [npcCustomMode, setNpcCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [npcBusy, setNpcBusy] = useState(false);
  const [npcResult, setNpcResult] = useState<string | null>(null);
  const [npcError, setNpcError] = useState<string | null>(null);
  const [translationEnabled, setTranslationEnabled] = useState(translationStore.enabled);

  const toggleControlMode = useCallback(() => {
    const next: "player" | "camera" = controlMode === "player" ? "camera" : "player";
    setControlMode(next);
    try { localStorage.setItem("control-mode", next); } catch {}
    eventBus.emit("set_control_mode", next);
  }, [controlMode, eventBus]);

  return (
    <>
      {showWorldSelector && (
        <WorldSelectorModal onClose={() => setShowWorldSelector(false)} />
      )}

      {showNpcPanel && (
        <NpcGeneratePanel
          locationInput={locationInput}
          setLocationInput={setLocationInput}
          npcDropdownOpen={npcDropdownOpen}
          setNpcDropdownOpen={setNpcDropdownOpen}
          npcCustomMode={npcCustomMode}
          setNpcCustomMode={setNpcCustomMode}
          customName={customName}
          setCustomName={setCustomName}
          customRole={customRole}
          setCustomRole={setCustomRole}
          npcBusy={npcBusy}
          setNpcBusy={setNpcBusy}
          npcResult={npcResult}
          setNpcResult={setNpcResult}
          npcError={npcError}
          setNpcError={setNpcError}
          eventBus={eventBus}
          onClose={() => {
            setShowNpcPanel(false);
            setNpcDropdownOpen(false);
            setNpcCustomMode(false);
          }}
        />
      )}

      {showMapCreator && (
        <MapCreatorPanel onClose={() => setShowMapCreator(false)} />
      )}

      {/* Top-right HUD bar */}
      <div style={{
        position: "fixed", top: 12, right: 12, zIndex: 90,
        pointerEvents: "auto",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        {/* Worlds + Control mode */}
        <div style={groupStyle}>
          <HudBtn
            onClick={() => setShowWorldSelector(true)}
            title="Switch or delete worlds"
            color="#a29bfe"
            bgColor="rgba(108,92,231,0.15)"
            borderColor="rgba(108,92,231,0.35)"
          >
            🌍 Worlds
          </HudBtn>
          <Divider />
          <HudBtn
            onClick={toggleControlMode}
            title={controlMode === "player" ? "Switch to camera" : "Switch to player"}
            color={controlMode === "player" ? "#74b9ff" : "#888"}
            bgColor={controlMode === "player" ? "rgba(100,180,255,0.15)" : "transparent"}
            borderColor="transparent"
          >
            {controlMode === "player" ? "🎮 Player" : "📷 Camera"}
          </HudBtn>
        </div>

        {/* City Map — amber */}
        <div style={mapGroupStyle}>
          <HudBtn
            onClick={() => setShowMapCreator(true)}
            title="Enter city landmark to generate pixel map world"
            color="#ffeaa7"
            bgColor="rgba(253,203,110,0.15)"
            borderColor="rgba(253,203,110,0.35)"
          >
            🗺️ City Map
          </HudBtn>
        </div>

        {/* NPC — green */}
        <div style={createGroupStyle}>
          <HudBtn
            onClick={() => setShowNpcPanel(true)}
            title="Generate location-related NPCs"
            color="#55efc4"
            bgColor="rgba(85,239,196,0.15)"
            borderColor="rgba(85,239,196,0.35)"
          >
            ✨ Spawn NPC
          </HudBtn>
        </div>

        {/* Refresh */}
        <div style={refreshGroupStyle}>
          <HudBtn
            onClick={() => window.location.reload()}
            title="Refresh page"
            color="#aaa"
            bgColor="transparent"
            borderColor="transparent"
          >
            🔄 Refresh
          </HudBtn>
        </div>

        {/* Translate to CN toggle */}
        <div style={translateGroupStyle}>
          <HudBtn
            onClick={() => {
              translationStore.toggle();
              setTranslationEnabled(translationStore.enabled);
              eventBus.emit("translation_toggle", translationStore.enabled);
            }}
            title={translationEnabled ? "Translate NPC speech to Chinese" : "Translation off"}
            color={translationEnabled ? "#ff7675" : "#888"}
            bgColor={translationEnabled ? "rgba(255,118,117,0.15)" : "transparent"}
            borderColor="transparent"
          >
            {translationEnabled ? "CN ON" : "CN OFF"}
          </HudBtn>
        </div>
      </div>
    </>
  );
}

// ─── Shared UI atoms ────────────────────────────────────────────────────────

function HudBtn({
  children, onClick, title, color, bgColor, borderColor,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  color: string;
  bgColor: string;
  borderColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "4px 10px", borderRadius: 6, cursor: "pointer",
        border: `1px solid ${borderColor}`,
        background: hovered
          ? (bgColor === "transparent" ? "rgba(255,255,255,0.08)" : bgColor.replace(/[\d.]+\)$/, "0.28)"))
          : bgColor,
        color,
        fontSize: 11, fontWeight: 600, userSelect: "none", whiteSpace: "nowrap",
        transition: "background 0.12s",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.15)", margin: "0 2px" }} />;
}

const groupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 2,
  background: "rgba(12,12,28,0.88)", backdropFilter: "blur(8px)",
  borderRadius: 8, border: "1px solid rgba(108,92,231,0.25)", padding: "3px 4px",
};
const mapGroupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center",
  background: "rgba(12,12,28,0.88)", backdropFilter: "blur(8px)",
  borderRadius: 8, border: "1px solid rgba(253,203,110,0.25)", padding: "3px 4px",
};
const createGroupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center",
  background: "rgba(12,12,28,0.88)", backdropFilter: "blur(8px)",
  borderRadius: 8, border: "1px solid rgba(85,239,196,0.25)", padding: "3px 4px",
};
const refreshGroupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center",
  background: "rgba(12,12,28,0.75)", backdropFilter: "blur(8px)",
  borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", padding: "3px 4px",
};
const translateGroupStyle: React.CSSProperties = {
  display: "flex", alignItems: "center",
  background: "rgba(12,12,28,0.75)", backdropFilter: "blur(8px)",
  borderRadius: 8, border: "1px solid rgba(255,118,117,0.2)", padding: "3px 4px",
};

// ─── Panel base style ────────────────────────────────────────────────────────

function panelBase(accentColor: string): React.CSSProperties {
  return {
    position: "fixed", top: 60, right: 12, zIndex: 150,
    width: 340, maxHeight: "calc(100vh - 80px)",
    background: "rgba(10,12,26,0.97)",
    border: `1px solid ${accentColor}`,
    borderRadius: 14,
    boxShadow: "0 20px 48px rgba(0,0,0,0.55)",
    backdropFilter: "blur(12px)",
    display: "flex", flexDirection: "column",
    pointerEvents: "auto",
    overflow: "hidden",
  };
}

const labelSt: React.CSSProperties = { fontSize: 11, color: "#9aa5cb", marginBottom: 4 };
const inputSt: React.CSSProperties = {
  width: "100%", background: "rgba(8,10,24,0.8)",
  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
  color: "#f3f6ff", padding: "7px 10px", fontSize: 13,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
};

// ─── MapCreatorPanel ─────────────────────────────────────────────────────────

interface TileInfo {
  filename: string;
  fileSize: number;
  lat: number;
  lng: number;
  source: "isometric-nyc" | "satellite";
  tileX?: number;
  tileY?: number;
  tileLat?: number;
  tileLng?: number;
  previewUrl: string;
}

interface HistoryEntry {
  location: string;
  worldId: string;
  worldName: string;
  tileFilename: string;
  createdAt: string;
}

type MapCreatorStep = "input" | "fetching-tile" | "tile-ready" | "building" | "done" | "error";

function MapCreatorPanel({ onClose }: { onClose: () => void }) {
  const [location, setLocation] = useState("");
  const [step, setStep] = useState<MapCreatorStep>("input");
  const [tile, setTile] = useState<TileInfo | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<CreateJobEvent[]>([]);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [fastMode, setFastMode] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // load history on mount
  useEffect(() => {
    apiClient.getLocationHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  // auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // elapsed timer when building
  useEffect(() => {
    if (step !== "building") { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  // SSE subscription when building
  useEffect(() => {
    if (!jobId) return;
    const unsub = apiClient.subscribeLocationJobEvents(jobId, (ev) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.kind === "world_id") {
        setWorldId((ev as { kind: "world_id"; worldId: string }).worldId);
      }
      if (ev.kind === "job_done") {
        setStep("done");
        setElapsed(0);
      }
      if (ev.kind === "job_error") {
        setError((ev as { kind: "job_error"; message: string }).message);
        setStep("error");
        setElapsed(0);
      }
    });
    return unsub;
  }, [jobId]);

  const cachedEntry = history.find(
    (h) => h.location === location.trim(),
  );

  const handleFetchTile = async () => {
    if (!location.trim()) return;
    setStep("fetching-tile");
    setTile(null);
    setError(null);
    try {
      const info = await apiClient.fetchLocationTile({ location: location.trim() });
      setTile(info);
      setStep("tile-ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const handleBuildGame = async () => {
    if (!tile) return;
    setStep("building");
    setEvents([]);
    setWorldId(null);
    setError(null);
    try {
      const res = await apiClient.createWorldFromLocation({
        tileFilename: tile.filename,
        location: location.trim(),
        fastMode,
      });
      setJobId(res.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const handleEnterWorld = async (wid: string) => {
    try {
      await apiClient.switchWorld(wid);
      window.location.reload();
    } catch (e) {
      alert("Switch failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const reset = () => {
    setStep("input");
    setTile(null);
    setJobId(null);
    setEvents([]);
    setWorldId(null);
    setError(null);
  };

  // milestone events for progress display
  const milestones = events
    .filter((e) => e.kind === "step" || e.kind === "info")
    .slice(-5).reverse();

  const logLines = events.filter(
    (e): e is CreateJobEvent & { kind: "log" } => e.kind === "log",
  );

  return (
    <div style={panelBase("rgba(253,203,110,0.3)")}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}>
        <span style={{ color: "#ffeaa7", fontWeight: 700, fontSize: 13 }}>🗺️ City Pixel Map</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── Input & Step 1 ── */}
        <div>
          <div style={labelSt}>Enter city landmark</div>
          <input
            style={inputSt}
            value={location}
            onChange={(e) => { setLocation(e.target.value); reset(); }}
            placeholder='e.g., 纽约市中央公园 or Central Park, NYC'
            spellCheck={false}
            onKeyDown={(e) => e.key === "Enter" && step === "input" && handleFetchTile()}
          />
        </div>

        {/* cached entry hint */}
        {cachedEntry && step === "input" && (
          <div style={{
            background: "rgba(162,155,254,0.08)", border: "1px solid rgba(162,155,254,0.25)",
            borderRadius: 8, padding: "8px 10px", fontSize: 12,
          }}>
            <div style={{ color: "#a29bfe", fontWeight: 600, marginBottom: 4 }}>📦 Cached World</div>
            <div style={{ color: "#9aa5cb" }}>{cachedEntry.worldName}</div>
            <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>
              {new Date(cachedEntry.createdAt).toLocaleString("en-US")}
            </div>
            <button
              onClick={() => handleEnterWorld(cachedEntry.worldId)}
              style={{
                marginTop: 8, background: "rgba(162,155,254,0.2)",
                border: "1px solid rgba(162,155,254,0.4)", color: "#a29bfe",
                borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              🎮 Enter World
            </button>
            <button
              onClick={() => setStep("input")}
              style={{
                marginLeft: 6, background: "transparent",
                border: "1px solid rgba(255,255,255,0.1)", color: "#666",
                borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer",
              }}
            >
              Regenerate
            </button>
          </div>
        )}

        {/* Step 1: Generate Pixel Map */}
        {(step === "input" || step === "fetching-tile" || step === "tile-ready") && !cachedEntry && (
          <div>
            <button
              onClick={handleFetchTile}
              disabled={!location.trim() || step === "fetching-tile"}
              style={{
                width: "100%", padding: "9px 0", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: step === "fetching-tile"
                  ? "rgba(255,255,255,0.06)"
                  : "linear-gradient(120deg,#fdcb6e,#e17055)",
                border: "none", color: step === "fetching-tile" ? "#555" : "#1a1a2e",
              }}
            >
              {step === "fetching-tile" ? "⏳ Fetching satellite image…" : "📷 Step 1: Generate Pixel Map"}
            </button>

            {step === "tile-ready" && tile && (
              <div style={{
                marginTop: 8, background: "rgba(85,239,196,0.06)",
                border: "1px solid rgba(85,239,196,0.2)", borderRadius: 8, padding: "8px 10px",
              }}>
                <div style={{ fontSize: 11, color: "#55efc4", fontWeight: 600 }}>
                  {tile.source === "isometric-nyc"
                    ? `✅ NYC Pixel Tile — ${(tile.fileSize / 1024).toFixed(0)} KB (1024×1024)`
                    : `✅ Satellite image ready — ${(tile.fileSize / 1024).toFixed(0)} KB (1024×1024)`
                  }
                </div>
                <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                  Coords: {tile.lat.toFixed(5)}, {tile.lng.toFixed(5)}
                  {tile.source === "isometric-nyc" && tile.tileX != null && tile.tileY != null &&
                    ` · Tile (${tile.tileX},${tile.tileY})`
                  }
                </div>
                <img
                  src={tile.previewUrl}
                  alt="map tile preview"
                  style={{ marginTop: 6, width: "100%", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)" }}
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Generate GeoPixel Game */}
        {step === "tile-ready" && tile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={handleBuildGame}
              style={{
                width: "100%", padding: "9px 0", borderRadius: 8,
                fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: "linear-gradient(120deg,#6c5ce7,#a29bfe)",
                border: "none", color: "#fff",
              }}
            >
              🎮 Step 2: Generate GeoPixel Game
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 10, color: "#7c87ad" }}>Walk mode:</span>
              <select
                value={fastMode ? "fast" : "full"}
                onChange={(e) => setFastMode(e.target.value === "fast")}
                style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "#1e1e3a", color: "#c8d6e5",
                  border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="full">Full (3-round + review)</option>
                <option value="fast">Fast (direct)</option>
              </select>
            </div>
          </div>
        )}

        {/* Building progress */}
        {step === "building" && (
          <div style={{
            background: "rgba(108,92,231,0.08)", border: "1px solid rgba(108,92,231,0.25)",
            borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 12, color: "#a29bfe", fontWeight: 600 }}>
                ⚙️ GeoPixel map pipeline running…
              </div>
              {elapsed > 0 && (
                <div style={{ fontSize: 10, color: "#7c87ad", fontFamily: "monospace" }}>
                  {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
                </div>
              )}
            </div>

            {/* Step milestones with checkmark/completed states */}
            {milestones.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3,
                background: "rgba(0,0,0,0.2)", borderRadius: 6, padding: "6px 8px" }}>
                {milestones.map((e, i) => {
                  const isLatest = i === 0;
                  const isPast = i > 0;
                  const stepInfo = e.kind === "step"
                    ? `Step ${(e as { step: string }).step}: ${(e as { label: string }).label}`
                    : (e as { label: string }).label;
                  return (
                    <div key={i} style={{
                      fontSize: 11,
                      color: isLatest ? "#dff3ff" : "#5a6a8a",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      <span style={{ color: isLatest ? "#a29bfe" : isPast ? "#55efc4" : "#555" }}>
                        {isPast ? "✅" : "⏳"}
                      </span>
                      {stepInfo}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Full log — always visible, larger */}
            <div style={{ fontSize: 10, color: "#7c87ad", fontWeight: 600 }}>
              Pipeline log ({logLines.length} lines)
            </div>
            <div
              ref={logRef}
              style={{
                maxHeight: 260, overflowY: "auto",
                background: "rgba(0,0,0,0.45)", borderRadius: 6,
                padding: "6px 8px", fontFamily: "monospace", fontSize: 10,
                color: "#7c87ad",
              }}
            >
              {logLines.length === 0 && (
                <div style={{ color: "#555", fontStyle: "italic" }}>Waiting for output...</div>
              )}
              {logLines.slice(-100).map((l, i) => (
                <div key={i} style={{
                  color: l.stream === "stderr" ? "#ffb0b0" :
                         l.line.includes("═══") ? "#f3f6ff" :
                         l.line.includes("✓") ? "#55efc4" :
                         l.line.includes("✗") ? "#ff7675" : "#7c87ad",
                  fontWeight: l.line.includes("═══") ? 700 : 400,
                }}>
                  {l.line}
                </div>
              ))}
              {logLines.length > 100 && (
                <div style={{ color: "#555", fontSize: 9, textAlign: "center", padding: 4 }}>
                  … showing last 100 of {logLines.length} lines
                </div>
              )}
            </div>

            {/* World ID indicator */}
            {worldId && (
              <div style={{ fontSize: 10, color: "#55efc4" }}>
                ✅ World ID: {worldId}
              </div>
            )}

            <button
              onClick={async () => {
                if (jobId) await apiClient.cancelLocationJob(jobId).catch(() => {});
                reset();
                setStep("tile-ready");
              }}
              style={{
                alignSelf: "flex-end", background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)", color: "#888",
                borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Done */}
        {step === "done" && worldId && (
          <div style={{
            background: "rgba(76,209,148,0.08)", border: "1px solid rgba(76,209,148,0.3)",
            borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: 13, color: "#a3f7bf", fontWeight: 700 }}>🎉 World generated!</div>
            <div style={{ fontSize: 11, color: "#9aa5cb" }}>
              TMJ, walkable grid, background saved to output/worlds/{worldId}/
            </div>
            <button
              onClick={() => handleEnterWorld(worldId)}
              style={{
                background: "linear-gradient(120deg,#00b894,#00cec9)",
                color: "#fff", border: "none", borderRadius: 8,
                padding: "9px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              🎮 Enter World
            </button>
            <button
              onClick={reset}
              style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "#666", borderRadius: 6, padding: "5px 0", fontSize: 11, cursor: "pointer",
              }}
            >
              Generate New Map
            </button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div style={{
            background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.3)",
            borderRadius: 8, padding: "10px 12px",
          }}>
            <div style={{ fontSize: 12, color: "#ff7675", fontWeight: 600 }}>❌ Error</div>
            <div style={{ fontSize: 11, color: "#ffb0b0", marginTop: 4 }}>{error}</div>
            <button
              onClick={reset}
              style={{
                marginTop: 8, background: "transparent",
                border: "1px solid rgba(255,118,117,0.4)", color: "#ff7675",
                borderRadius: 6, padding: "5px 12px", fontSize: 11, cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* History list */}
        {history.length > 0 && step === "input" && !cachedEntry && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>History</div>
            {history.slice(0, 5).map((h) => (
              <div
                key={h.worldId}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 8px", borderRadius: 6, marginBottom: 4,
                  background: "rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#cfd6ee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.location}
                  </div>
                  <div style={{ fontSize: 10, color: "#555" }}>{new Date(h.createdAt).toLocaleDateString("en-US")}</div>
                </div>
                <button
                  onClick={() => handleEnterWorld(h.worldId)}
                  style={{
                    flexShrink: 0, marginLeft: 8, background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.1)", color: "#aaa",
                    borderRadius: 5, padding: "4px 8px", fontSize: 11, cursor: "pointer",
                  }}
                >
                  Enter
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── NpcGeneratePanel ────────────────────────────────────────────────────────

function NpcGeneratePanel({
  locationInput, setLocationInput,
  npcDropdownOpen, setNpcDropdownOpen,
  npcCustomMode, setNpcCustomMode,
  customName, setCustomName,
  customRole, setCustomRole,
  npcBusy, setNpcBusy,
  npcResult, setNpcResult,
  npcError, setNpcError,
  eventBus, onClose,
}: {
  locationInput: string; setLocationInput: (v: string) => void;
  npcDropdownOpen: boolean; setNpcDropdownOpen: (v: boolean) => void;
  npcCustomMode: boolean; setNpcCustomMode: (v: boolean) => void;
  customName: string; setCustomName: (v: string) => void;
  customRole: string; setCustomRole: (v: string) => void;
  npcBusy: boolean; setNpcBusy: (v: boolean) => void;
  npcResult: string | null; setNpcResult: (v: string | null) => void;
  npcError: string | null; setNpcError: (v: string | null) => void;
  eventBus: Phaser.Events.EventEmitter;
  onClose: () => void;
}) {
  const [npcs, setNpcs] = useState<ManagedNpcInfo[]>([]);
  const [loadingNpcs, setLoadingNpcs] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string | string[]>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadNpcs = useCallback(async () => {
    setLoadingNpcs(true);
    try {
      const list = await apiClient.listManagedNpcs();
      setNpcs(list);
    } catch (err) {
      console.warn("[NpcPanel] Failed to load NPCs:", err);
    } finally {
      setLoadingNpcs(false);
    }
  }, []);

  useEffect(() => {
    loadNpcs();
  }, [loadNpcs]);

  const handleGenerate = async () => {
    if (!locationInput.trim()) return;
    setNpcBusy(true);
    setNpcResult(null);
    setNpcError(null);
    try {
      const res = await apiClient.generateNpc({
        locationName: locationInput.trim(),
        mode: npcCustomMode ? "custom" : "random",
        name: npcCustomMode ? customName : undefined,
        role: npcCustomMode ? customRole : undefined,
      });
      const names = res.npcs.map((n) => `${n.name} (${n.role})`).join(", ");
      setNpcResult(`Generated: ${names}`);
      eventBus.emit("scene_sync_characters");
      loadNpcs();
    } catch (err) {
      setNpcError(err instanceof Error ? err.message : String(err));
    } finally {
      setNpcBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this NPC?")) return;
    setDeletingId(id);
    try {
      await apiClient.deleteManagedNpc(id);
      setNpcs((prev) => prev.filter((n) => n.id !== id));
      eventBus.emit("scene_sync_characters");
    } catch (err) {
      console.error("[NpcPanel] Delete failed:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (npc: ManagedNpcInfo) => {
    setEditingId(npc.id);
    setEditForm({
      backstory: npc.backstory || "",
      coreMotivation: npc.coreMotivation || "",
      speakingStyle: npc.speakingStyle || "",
      coreValues: npc.coreValues || [],
      socialStyle: npc.socialStyle || "extrovert",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (npc: ManagedNpcInfo) => {
    setSavingId(npc.id);
    try {
      const patch: Record<string, unknown> = {
        backstory: editForm.backstory,
        coreMotivation: editForm.coreMotivation,
        speakingStyle: editForm.speakingStyle,
        coreValues: Array.isArray(editForm.coreValues)
          ? editForm.coreValues
          : (editForm.coreValues as string).split(",").map((s: string) => s.trim()).filter(Boolean),
        socialStyle: editForm.socialStyle,
      };
      await apiClient.updateManagedNpc(npc.id, patch);
      setEditingId(null);
      setEditForm({});
      loadNpcs();
      eventBus.emit("scene_sync_characters");
    } catch (err) {
      console.error("[NpcPanel] Save failed:", err);
    } finally {
      setSavingId(null);
    }
  };

  const spriteUrl = (appearanceId: string | null) =>
    appearanceId ? `/assets/characters/${appearanceId}/spritesheet.png` : null;

  return (
    <div style={panelBase("rgba(85,239,196,0.3)")}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0,
      }}>
        <span style={{ color: "#55efc4", fontWeight: 700, fontSize: 13 }}>✨ Spawn NPC</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer" }}>✕</button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* ── Generate Section ── */}
        <div>
          <div style={labelSt}>Location</div>
          <input
            style={inputSt}
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            placeholder="e.g., Café, Library"
            spellCheck={false}
          />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {[{ label: "Random x5", value: false }, { label: "Custom", value: true }].map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => setNpcCustomMode(opt.value)}
              style={{
                flex: 1, padding: "5px 0", borderRadius: 6, fontSize: 11, cursor: "pointer",
                border: `1px solid ${npcCustomMode === opt.value ? "rgba(85,239,196,0.5)" : "rgba(255,255,255,0.1)"}`,
                background: npcCustomMode === opt.value ? "rgba(85,239,196,0.12)" : "transparent",
                color: npcCustomMode === opt.value ? "#55efc4" : "#888", fontWeight: 600,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {npcCustomMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div>
              <div style={labelSt}>Name</div>
              <input style={inputSt} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g., Alice" />
            </div>
            <div>
              <div style={labelSt}>Role / Job</div>
              <input style={inputSt} value={customRole} onChange={(e) => setCustomRole(e.target.value)} placeholder="e.g., Barista" />
            </div>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={npcBusy || !locationInput.trim() || (npcCustomMode && (!customName.trim() || !customRole.trim()))}
          style={{
            width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: npcBusy ? "rgba(255,255,255,0.06)" : "rgba(85,239,196,0.18)",
            border: "1px solid rgba(85,239,196,0.35)",
            color: npcBusy ? "#555" : "#55efc4",
          }}
        >
          {npcBusy ? "Generating…" : "✨ Spawn NPC"}
        </button>

        {npcResult && (
          <div style={{ fontSize: 12, color: "#a3f7bf", background: "rgba(76,209,148,0.1)", border: "1px solid rgba(76,209,148,0.25)", borderRadius: 8, padding: "8px 10px" }}>
            {npcResult}
          </div>
        )}
        {npcError && (
          <div style={{ fontSize: 12, color: "#ff7675", background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.25)", borderRadius: 8, padding: "8px 10px" }}>
            {npcError}
          </div>
        )}

        {/* ── Managed NPC List ── */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#9aa5cb", fontWeight: 600 }}>
              Managed NPCs {npcs.length > 0 && `(${npcs.length})`}
            </span>
            <button
              onClick={loadNpcs}
              style={{ background: "none", border: "none", color: "#666", fontSize: 11, cursor: "pointer" }}
            >
              ↻
            </button>
          </div>

          {loadingNpcs && npcs.length === 0 && (
            <div style={{ fontSize: 11, color: "#555", textAlign: "center", padding: 12 }}>Loading…</div>
          )}

          {!loadingNpcs && npcs.length === 0 && (
            <div style={{ fontSize: 11, color: "#555", textAlign: "center", padding: 12 }}>
              No NPCs yet. Generate some above.
            </div>
          )}

          {npcs.map((npc) => {
            const isEditing = editingId === npc.id;
            const isDeleting = deletingId === npc.id;
            const isSaving = savingId === npc.id;
            const url = spriteUrl(npc.appearanceId);

            return (
              <div
                key={npc.id}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                  marginBottom: 8,
                  overflow: "hidden",
                }}
              >
                {/* NPC card header */}
                <div style={{ display: "flex", gap: 10, padding: 10 }}>
                  {/* Sprite thumbnail */}
                  <div style={{
                    width: 48, height: 48, borderRadius: 6, overflow: "hidden",
                    background: "rgba(0,0,0,0.3)", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {url ? (
                      <img
                        src={url}
                        alt={npc.name}
                        style={{ width: 48, height: 48, objectFit: "cover", imageRendering: "pixelated" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <span style={{ fontSize: 18, opacity: 0.4 }}>?</span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#e8e8ea" }}>
                      {npc.name}
                      <span style={{ fontWeight: 400, fontSize: 11, color: "#7c87ad", marginLeft: 6 }}>
                        {npc.role}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#7c87ad", marginTop: 3, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {npc.backstory || "No backstory"}
                    </div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                      {npc.speakingStyle}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => isEditing ? cancelEdit() : startEdit(npc)}
                      style={{
                        padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: "pointer",
                        border: isEditing ? "1px solid rgba(255,200,50,0.5)" : "1px solid rgba(120,180,255,0.3)",
                        background: isEditing ? "rgba(255,200,50,0.12)" : "rgba(120,180,255,0.1)",
                        color: isEditing ? "#ffc832" : "#7cb8ff",
                      }}
                    >
                      {isEditing ? "✕" : "Edit"}
                    </button>
                    <button
                      onClick={() => handleDelete(npc.id)}
                      disabled={isDeleting}
                      style={{
                        padding: "3px 8px", borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: isDeleting ? "not-allowed" : "pointer",
                        border: "1px solid rgba(255,100,100,0.3)",
                        background: "rgba(255,80,80,0.07)",
                        color: "#ff7675", opacity: isDeleting ? 0.5 : 1,
                      }}
                    >
                      {isDeleting ? "…" : "Del"}
                    </button>
                  </div>
                </div>

                {/* Edit fields */}
                {isEditing && (
                  <div style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    padding: "10px 12px",
                    display: "flex", flexDirection: "column", gap: 8,
                    background: "rgba(255,255,255,0.02)",
                  }}>
                    <EditField label="Backstory">
                      <textarea
                        value={editForm.backstory as string}
                        onChange={(e) => setEditForm((f) => ({ ...f, backstory: e.target.value }))}
                        style={editInputSt}
                        rows={3}
                      />
                    </EditField>

                    <EditField label="Core Motivation">
                      <input
                        value={editForm.coreMotivation as string}
                        onChange={(e) => setEditForm((f) => ({ ...f, coreMotivation: e.target.value }))}
                        style={editInputSt}
                      />
                    </EditField>

                    <EditField label="Speaking Style">
                      <input
                        value={editForm.speakingStyle as string}
                        onChange={(e) => setEditForm((f) => ({ ...f, speakingStyle: e.target.value }))}
                        style={editInputSt}
                      />
                    </EditField>

                    <EditField label="Core Values (comma separated)">
                      <input
                        value={Array.isArray(editForm.coreValues) ? editForm.coreValues.join(", ") : editForm.coreValues}
                        onChange={(e) => setEditForm((f) => ({ ...f, coreValues: e.target.value }))}
                        style={editInputSt}
                        placeholder="honesty, kindness, curiosity"
                      />
                    </EditField>

                    <EditField label="Social Style">
                      <select
                        value={editForm.socialStyle as string}
                        onChange={(e) => setEditForm((f) => ({ ...f, socialStyle: e.target.value }))}
                        style={{ ...editInputSt, cursor: "pointer" }}
                      >
                        <option value="extrovert">Extrovert</option>
                        <option value="introvert_selective">Introvert (Selective)</option>
                        <option value="introvert">Introvert</option>
                      </select>
                    </EditField>

                    <button
                      onClick={() => handleSave(npc)}
                      disabled={isSaving}
                      style={{
                        alignSelf: "flex-end", padding: "6px 16px", borderRadius: 6,
                        fontSize: 11, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer",
                        border: "none",
                        background: isSaving ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #4a8bff, #6aa7ff)",
                        color: isSaving ? "#555" : "#fff",
                      }}
                    >
                      {isSaving ? "Saving…" : "💾 Save & Apply"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#7c87ad", marginBottom: 2, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

const editInputSt: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "rgba(8,10,24,0.6)",
  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6,
  color: "#e0e6f2", padding: "5px 8px", fontSize: 11,
  outline: "none", fontFamily: "inherit", resize: "vertical",
};

// ─── WorldSelectorModal ────────────────────────────────────────────────────

function WorldSelectorModal({ onClose }: { onClose: () => void }) {
  const [worlds, setWorlds] = useState<GeneratedWorldSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    apiClient.getGeneratedWorlds()
      .then((res) => { setWorlds(res.worlds); setCurrentId(res.currentWorldId); })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reload, onClose]);

  const handleSwitch = async (worldId: string) => {
    if (busy) return;
    setBusy(worldId);
    try {
      await apiClient.switchWorld(worldId);
      window.location.reload();
    } catch (e) {
      window.alert("Switch failed: " + (e instanceof Error ? e.message : String(e)));
      setBusy(null);
    }
  };

  const handleDelete = async (worldId: string, worldName: string) => {
    if (busy) return;
    if (!window.confirm(`Delete "${worldName}"? This cannot be undone.`)) return;
    setBusy(worldId);
    try {
      await apiClient.deleteWorld(worldId);
      reload();
    } catch (e) {
      window.alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const formatId = (id: string) => id.replace(/T(\d{2})-(\d{2})-\d{2}$/, " $1:$2");

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "auto",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "rgba(14,14,28,0.97)", border: "1px solid rgba(108,92,231,0.3)",
        borderRadius: 14, padding: "20px 24px",
        minWidth: 340, maxWidth: 480, width: "90vw",
        maxHeight: "70vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ color: "#a29bfe", fontWeight: 700, fontSize: 15 }}>🌍 World Select</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 24 }}>Loading…</div>}
          {!loading && worlds.length === 0 && <div style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 24 }}>No worlds found</div>}
          {!loading && worlds.map((w) => {
            const isCurrent = w.id === currentId;
            const isBusy = busy === w.id;
            return (
              <div
                key={w.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                  background: isCurrent ? "rgba(108,92,231,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isCurrent ? "rgba(108,92,231,0.3)" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {w.worldName}
                    {isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: "#a29bfe", background: "rgba(108,92,231,0.2)", borderRadius: 4, padding: "1px 5px" }}>current</span>}
                  </div>
                  <div style={{ color: "#555", fontSize: 11, marginTop: 2 }}>{formatId(w.id)}</div>
                </div>
                {!isCurrent && (
                  <>
                    <button
                      onClick={() => handleSwitch(w.id)} disabled={!!busy}
                      style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", border: "1px solid rgba(108,92,231,0.4)", background: "rgba(108,92,231,0.15)", color: "#a29bfe", opacity: busy && !isBusy ? 0.5 : 1 }}
                    >
                      {isBusy ? "Switching…" : "Switch"}
                    </button>
                    <button
                      onClick={() => handleDelete(w.id, w.worldName)} disabled={!!busy}
                      style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", border: "1px solid rgba(255,100,100,0.3)", background: "rgba(255,80,80,0.07)", color: "#ff7675", opacity: busy && !isBusy ? 0.5 : 1 }}
                    >
                      {isBusy ? "Deleting…" : "Delete"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
