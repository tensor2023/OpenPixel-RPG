import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import type { SimulationEvent, CharacterInfo, LocationInfo } from "../../types/api";
import {
  buildCharacterNameMap,
  buildLocationNameMap,
  formatEventSummary,
  formatEventType,
} from "../utils/event-format";

export function Timeline() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [filterActor, setFilterActor] = useState<string>("");

  useEffect(() => {
    apiClient.getEvents({ limit: 200 }).then(setEvents).catch(console.warn);
    apiClient.getCharacters().then(setCharacters).catch(console.warn);
    apiClient.getLocations().then(setLocations).catch(console.warn);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        navigate("/", { replace: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const characterNames = useMemo(() => buildCharacterNameMap(characters), [characters]);
  const locationNames = useMemo(() => buildLocationNameMap(locations), [locations]);

  const filtered = filterActor
    ? events.filter((e) => e.actorId === filterActor)
    : events;

  const grouped = new Map<number, SimulationEvent[]>();
  for (const e of filtered) {
    const existing = grouped.get(e.gameDay) || [];
    existing.push(e);
    grouped.set(e.gameDay, existing);
  }
  const days = Array.from(grouped.keys()).sort((a, b) => b - a);

  return (
    <>
      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(26, 26, 46, 0.96)",
          overflow: "auto",
          padding: "72px 40px 40px",
          color: "#e0e0e0",
          pointerEvents: "auto",
          zIndex: 1200,
        }}
      >
        <h2 style={{ textAlign: "center", fontSize: 18, marginBottom: 16 }}>
          {t("timeline.title")}
        </h2>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20, gap: 8 }}>
        <select
          value={filterActor}
          onChange={(e) => setFilterActor(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#e0e0e0",
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 12,
          }}
        >
          <option value="">{t("timeline.allCharacters")}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.role})
            </option>
          ))}
        </select>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {days.map((day) => (
          <div key={day} style={{ marginBottom: 24 }}>
            <h3
              style={{
                fontSize: 14,
                color: "#74b9ff",
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: 4,
                marginBottom: 8,
              }}
            >
              Day {day}
            </h3>
            {grouped.get(day)!.map((e, i) => (
              <div
                key={e.id || i}
                style={{
                  padding: "6px 0",
                  borderLeft: `2px solid ${
                    (e.dramScore || 0) >= 6 ? "#fdcb6e" : "rgba(255,255,255,0.1)"
                  }`,
                  paddingLeft: 12,
                  marginBottom: 4,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: "#666" }}>{e.timeString || `T${e.gameTick}`}</span>{" "}
                <span style={{ color: typeColor(e.type) }}>[{formatEventType(e.type)}]</span>{" "}
                {(e.dramScore || 0) >= 6 && <span>★</span>}{" "}
                <span style={{ color: "#ccc" }}>
                  {formatEventSummary(e, { characterNames, locationNames })}
                </span>
              </div>
            ))}
          </div>
        ))}
        {days.length === 0 && (
          <div style={{ textAlign: "center", color: "#666", padding: 40 }}>
            {t("timeline.noEvents")}
          </div>
        )}
      </div>
      </div>

      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          zIndex: 1300,
          pointerEvents: "none",
        }}
      >
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => navigate("/", { replace: true })}
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            background: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.2)",
            color: "#e0e0e0",
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
            pointerEvents: "auto",
          }}
        >
          {t("timeline.backToWorld")}
        </button>
      </div>
    </>
  );
}

function typeColor(type: string): string {
  switch (type) {
    case "dialogue": return "#fdcb6e";
    case "movement": return "#74b9ff";
    case "action_start": return "#00b894";
    default: return "#888";
  }
}
