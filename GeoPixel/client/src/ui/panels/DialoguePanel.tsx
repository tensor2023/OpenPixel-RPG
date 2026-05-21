import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import { translationStore } from "../services/translation-store";
import type {
  CharacterInfo,
  DialogueEventData,
  DialogueTurn,
  SimulationEvent,
} from "../../types/api";
import { buildCharacterNameMap } from "../utils/event-format";

interface DialogueSession {
  conversationId: string;
  participants: string[];
  turns: DialogueTurn[];
  isFinal: boolean;
  lastUpdatedMs: number;
  latestAbsTick: number;
  latestGameDay: number;
  latestGameTick: number;
}

function absoluteTick(day: number, tick: number, ticksPerScene: number): number {
  return (day - 1) * ticksPerScene + tick;
}

export function DialoguePanel({
  events,
  ticksPerScene,
  onDismiss,
}: {
  events: SimulationEvent[];
  ticksPerScene: number;
  onDismiss: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiClient.getCharacters().then(setCharacters).catch(console.warn);
  }, []);

  const sessions = useMemo(() => {
    const map = new Map<string, DialogueSession>();

    for (const event of events) {
      const dialogue = event.data as DialogueEventData | undefined;
      if (!dialogue?.conversationId || !Array.isArray(dialogue.turns)) continue;

      const absTick = absoluteTick(event.gameDay, event.gameTick, ticksPerScene);
      const updatedAtMs = Date.parse(event.createdAt) || absTick;
      const existing = map.get(dialogue.conversationId);

      if (!existing) {
        map.set(dialogue.conversationId, {
          conversationId: dialogue.conversationId,
          participants: dialogue.participants || [
            event.actorId || "unknown",
            event.targetId || "unknown",
          ],
          turns: [...dialogue.turns],
          isFinal: dialogue.isFinal,
          lastUpdatedMs: updatedAtMs,
          latestAbsTick: absTick,
          latestGameDay: event.gameDay,
          latestGameTick: event.gameTick,
        });
        continue;
      }

      if (dialogue.phase === "complete") {
        map.set(dialogue.conversationId, {
          ...existing,
          participants: dialogue.participants || existing.participants,
          turns: [...dialogue.turns],
          isFinal: true,
          lastUpdatedMs: updatedAtMs,
          latestAbsTick: absTick,
          latestGameDay: event.gameDay,
          latestGameTick: event.gameTick,
        });
        continue;
      }

      const mergedTurns = [...existing.turns];
      dialogue.turns.forEach((turn, idx) => {
        mergedTurns[dialogue.turnIndexStart + idx] = turn;
      });
      map.set(dialogue.conversationId, {
        ...existing,
        participants: dialogue.participants || existing.participants,
        turns: mergedTurns,
        isFinal: existing.isFinal || dialogue.isFinal,
        lastUpdatedMs: updatedAtMs,
        latestAbsTick: absTick,
        latestGameDay: event.gameDay,
        latestGameTick: event.gameTick,
      });
    }

    return [...map.values()].sort((a, b) => {
      if (b.latestAbsTick !== a.latestAbsTick) {
        return b.latestAbsTick - a.latestAbsTick;
      }
      return b.lastUpdatedMs - a.lastUpdatedMs;
    });
  }, [events, ticksPerScene]);

  const MAX_VISIBLE_TABS = 5;
  const visibleSessions = useMemo(
    () => (sessions.length > MAX_VISIBLE_TABS ? sessions.slice(0, MAX_VISIBLE_TABS) : sessions),
    [sessions],
  );

  useEffect(() => {
    if (activeTab && !visibleSessions.some((s) => s.conversationId === activeTab)) {
      setActiveTab(visibleSessions[0]?.conversationId ?? null);
    } else if (!activeTab && visibleSessions.length > 0) {
      setActiveTab(visibleSessions[0].conversationId);
    }
  }, [visibleSessions, activeTab]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleSessions, activeTab, collapsed]);

  const characterNames = buildCharacterNameMap(characters);
  if (visibleSessions.length === 0) return null;

  const current =
    visibleSessions.find((s) => s.conversationId === activeTab) ??
    visibleSessions[0];
  const summarySession = collapsed ? visibleSessions[0] : current;

  const getSessionLabel = (s: DialogueSession) => {
    const [a, b] = s.participants;
    const nameA = characterNames[a] || a;
    const nameB = characterNames[b] || b;
    return `${nameA} & ${nameB}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(92vw, 520px)",
        zIndex: 100,
        pointerEvents: collapsed ? "none" : "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          background:
            "linear-gradient(180deg, rgba(20,20,40,0.92), rgba(20,20,40,0.98))",
          backdropFilter: "blur(12px)",
          borderRadius: collapsed ? 12 : "12px 12px 0 0",
          padding: "10px 14px",
          border: "1px solid rgba(255,255,255,0.1)",
          borderBottom:
            !collapsed && current ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          cursor: "pointer",
          pointerEvents: "auto",
        }}
        title={collapsed ? t("dialogue.expandTitle") : t("dialogue.collapseTitle")}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "#74b9ff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            {t("dialogue.recentTitle")}
            {collapsed && (
              <span style={{ color: "#888", fontSize: 11, fontWeight: "normal" }}>
                {getSessionLabel(summarySession)}{summarySession.isFinal ? " · " + t("dialogue.ended") : " · " + t("dialogue.ongoing")}
              </span>
            )}
          </div>
          {collapsed && (
            <div style={{ color: "#888", fontSize: 11, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {summarySession.turns.length > 0
                ? `${characterNames[summarySession.turns[summarySession.turns.length - 1].speaker] || summarySession.turns[summarySession.turns.length - 1].speaker}: ${summarySession.turns[summarySession.turns.length - 1].content}`
                : t("dialogue.noContent")}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ color: "#888", fontSize: 11 }}>
            {t("dialogue.sessionCount", { count: visibleSessions.length })}
          </span>
          <div
            style={{
              color: "#bbb",
              fontSize: 16,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
            }}
          >
            {collapsed ? "▴" : "▾"}
          </div>
        </div>
      </div>

      {!collapsed && visibleSessions.length > 1 && (
        <div
          className="dialogue-tabs-scroll"
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            padding: "6px 6px 0",
            background:
              "linear-gradient(180deg, rgba(20,20,40,0.95), rgba(20,20,40,0.98))",
            borderLeft: "1px solid rgba(255,255,255,0.1)",
            borderRight: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {visibleSessions.map((s) => {
            const isActive = s.conversationId === (current?.conversationId);
            return (
              <button
                key={s.conversationId}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab(s.conversationId);
                }}
                style={{
                  flex: "0 0 auto",
                  padding: "5px 12px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  background: isActive
                    ? "rgba(20,20,40,0.95)"
                    : "rgba(20,20,40,0.6)",
                  color: isActive ? "#74b9ff" : "#888",
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 400,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s",
                  position: "relative",
                  pointerEvents: "auto",
                }}
              >
                {getSessionLabel(s)}
                {!s.isFinal && (
                  <span
                    style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#00b894",
                      marginLeft: 6,
                      verticalAlign: "middle",
                      animation: "pulse 1.5s infinite",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {!collapsed && current && (
        <div
          style={{
            background:
              "linear-gradient(180deg, rgba(20,20,40,0.95), rgba(20,20,40,0.98))",
            backdropFilter: "blur(12px)",
            borderRadius: visibleSessions.length > 1 ? "0 0 12px 12px" : "0 0 12px 12px",
            padding: "12px 16px",
            border: "1px solid rgba(255,255,255,0.1)",
            borderTop: "none",
            maxHeight: 220,
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 8,
            }}
          >
            <div>
              <div style={{ color: "#74b9ff", fontSize: 14, fontWeight: 700 }}>
                {getSessionLabel(current)}
              </div>
              <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>
                {current.isFinal ? t("dialogue.latestEnded") : t("dialogue.latestOngoing")}
              </div>
            </div>
            <button
              onClick={() => onDismiss(current.conversationId)}
              style={{
                background: "none",
                border: "none",
                color: "#888",
                cursor: "pointer",
                fontSize: 14,
                padding: "0 2px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>

          <div
            ref={scrollRef}
            className="dialogue-scroll"
            style={{ overflow: "auto", flex: 1, paddingRight: 4 }}
          >
            {current.turns.map((turn, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 0",
                  borderBottom:
                    i < current.turns.length - 1
                      ? "1px solid rgba(255,255,255,0.06)"
                      : "none",
                  animation: "fadeIn 0.4s ease",
                }}
              >
                <span
                  style={{ color: "#74b9ff", fontSize: 12, fontWeight: 600 }}
                >
                  {characterNames[turn.speaker] || turn.speaker}
                </span>
                <div style={{ color: "#e0e0e0", fontSize: 13, marginTop: 2 }}>
                  {turn.content}
                </div>
                {turn.innerMonologue && (
                  <div
                    style={{
                      color: "#b39ddb",
                      fontSize: 12,
                      fontStyle: "italic",
                      marginTop: 4,
                      paddingLeft: 12,
                      borderLeft: "2px dashed rgba(179, 157, 219, 0.45)",
                      opacity: 0.88,
                    }}
                    title={t("dialogue.innerMonologueTitle")}
                  >
                    💭 {turn.innerMonologue}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .dialogue-scroll,
        .dialogue-tabs-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(116, 185, 255, 0.65) rgba(255, 255, 255, 0.06);
        }
        .dialogue-scroll::-webkit-scrollbar {
          width: 10px;
        }
        .dialogue-tabs-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .dialogue-scroll::-webkit-scrollbar-track,
        .dialogue-tabs-scroll::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 999px;
        }
        .dialogue-scroll::-webkit-scrollbar-thumb,
        .dialogue-tabs-scroll::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(116, 185, 255, 0.92), rgba(90, 139, 255, 0.88));
          border-radius: 999px;
          border: 2px solid rgba(20, 20, 40, 0.9);
        }
        .dialogue-scroll::-webkit-scrollbar-thumb:hover,
        .dialogue-tabs-scroll::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(145, 205, 255, 0.96), rgba(116, 185, 255, 0.92));
        }
      `}</style>
    </div>
  );
}
