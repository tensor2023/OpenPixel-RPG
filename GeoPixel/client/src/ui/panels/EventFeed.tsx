import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../services/api-client";
import type { CharacterInfo, LocationInfo, SimulationEvent } from "../../types/api";
import {
  buildCharacterNameMap,
  buildLocationNameMap,
  formatEventSummary,
  formatEventType,
} from "../utils/event-format";

export function EventFeed({ events }: { events: SimulationEvent[] }) {
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [locations, setLocations] = useState<LocationInfo[]>([]);

  useEffect(() => {
    apiClient.getCharacters().then(setCharacters).catch(console.warn);
    apiClient.getLocations().then(setLocations).catch(console.warn);
  }, []);

  const characterNames = useMemo(() => buildCharacterNameMap(characters), [characters]);
  const locationNames = useMemo(() => buildLocationNameMap(locations), [locations]);

  if (events.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
      <h3 style={{ color: "#e0e0e0", fontSize: 12, marginBottom: 6, opacity: 0.7 }}>
        事件流
      </h3>
      <div style={{ maxHeight: 160, overflow: "auto" }}>
        {events.slice(0, 20).map((e, i) => (
          <div
            key={e.id || i}
            style={{
              fontSize: 11,
              color: "#aaa",
              padding: "3px 0",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              lineHeight: 1.4,
            }}
          >
            <span style={{ color: "#666" }}>
              Day {e.gameDay} · {e.timeString || `T${e.gameTick}`}
            </span>{" "}
            <span style={{ color: typeColor(e.type) }}>[{formatEventType(e.type)}]</span>{" "}
            {formatEventSummary(e, { characterNames, locationNames })}
          </div>
        ))}
      </div>
    </div>
  );
}

function typeColor(type: string): string {
  switch (type) {
    case "dialogue": return "#fdcb6e";
    case "movement": return "#74b9ff";
    case "action_start": return "#00b894";
    case "action_end": return "#636e72";
    case "event_triggered": return "#e17055";
    default: return "#888";
  }
}
