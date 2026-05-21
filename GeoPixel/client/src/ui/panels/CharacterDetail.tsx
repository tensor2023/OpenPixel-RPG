import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import type {
  CharacterDetail as CharDetailType,
  MemoryEntry,
  SimulationEvent,
  CharacterInfo,
  LocationInfo,
} from "../../types/api";
import {
  buildCharacterNameMap,
  buildLocationNameMap,
  formatActionName,
  formatEventSummary,
  formatEventType,
} from "../utils/event-format";

type Tab = "history" | "memory";
type DialogueTurnRecord = {
  kind: "dialogue_turn";
  key: string;
  gameDay: number;
  gameTick: number;
  timeString?: string;
  createdAt?: string;
  sortIndex: number;
  event: SimulationEvent;
  conversationId: string;
  turnIndex: number;
  speakerId: string;
  listenerId?: string;
  content: string;
  innerMonologue?: string;
};

type EventRecord = {
  kind: "event";
  key: string;
  gameDay: number;
  gameTick: number;
  timeString?: string;
  createdAt?: string;
  sortIndex: number;
  event: SimulationEvent;
};

type HistoryRecord = DialogueTurnRecord | EventRecord;

export function CharacterDetail({
  charId,
  followedCharId,
  onToggleFollow,
  characters,
  liveEvents,
}: {
  charId: string;
  followedCharId: string | null;
  onToggleFollow: (id: string) => void;
  characters: CharacterInfo[];
  liveEvents: SimulationEvent[];
}) {
  const [detail, setDetail] = useState<CharDetailType | null>(null);
  const [tab, setTab] = useState<Tab>("history");
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [locations, setLocations] = useState<LocationInfo[]>([]);
  const [storedEvents, setStoredEvents] = useState<SimulationEvent[]>([]);

  useEffect(() => {
    apiClient.getCharacterDetail(charId).then(setDetail).catch(console.warn);
  }, [charId]);

  useEffect(() => {
    apiClient.getLocations().then(setLocations).catch(console.warn);
  }, []);

  useEffect(() => {
    if (tab === "history") apiClient.getEvents({}).then(setStoredEvents).catch(console.warn);
    if (tab === "memory") apiClient.getMemories(charId).then(setMemories).catch(console.warn);
  }, [charId, tab]);
  const characterNames = useMemo(() => buildCharacterNameMap(characters), [characters]);
  const locationNames = useMemo(() => buildLocationNameMap(locations), [locations]);
  const mergedHistory = useMemo(() => {
    const merged = new Map<string, SimulationEvent>();
    const liveEventsOldToNew = [...liveEvents].reverse();
    [...storedEvents, ...liveEventsOldToNew].forEach((event, index) => {
      if (!eventTouchesCharacter(event, charId)) return;
      merged.set(event.id || `${event.type}-${event.gameDay}-${event.gameTick}-${index}`, event);
    });
    return buildHistoryRecords(Array.from(merged.values()));
  }, [charId, liveEvents, storedEvents]);

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [editBusy, setEditBusy] = useState(false);
  const [editFlash, setEditFlash] = useState<string | null>(null);
  const { t } = useTranslation();

  if (!detail) return null;

  const { profile, state, emotionLabel } = detail;
  const isFollowing = followedCharId === charId;

  const openEditor = () => {
    setEditDraft({
      coreMotivation: profile.coreMotivation ?? "",
      coreValues: ((profile.coreValues as string[]) ?? []).join("、"),
      speakingStyle: profile.speakingStyle ?? "",
      fears: ((profile.fears as string[]) ?? []).join("、"),
      backstory: (profile.backstory as string) ?? "",
    });
    setEditing(true);
    setEditFlash(null);
  };

  const saveProfile = async () => {
    setEditBusy(true);
    try {
      const split = (s: string) => s.split(/[,、，\s]+/).map((t) => t.trim()).filter(Boolean);
      await apiClient.patchCharacterProfile(charId, {
        coreMotivation: editDraft.coreMotivation?.trim() || undefined,
        coreValues: split(editDraft.coreValues ?? ""),
        speakingStyle: editDraft.speakingStyle?.trim() || undefined,
        fears: split(editDraft.fears ?? ""),
        backstory: editDraft.backstory?.trim() || undefined,
      });
      setEditFlash(t("charDetail.saved"));
      setTimeout(() => setEditFlash(null), 2000);
      setEditing(false);
      apiClient.getCharacterDetail(charId).then(setDetail).catch(console.warn);
    } catch (err) {
      setEditFlash(t("charDetail.saveFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
          {profile.name}
        </span>
        <button
          onClick={() => onToggleFollow(charId)}
          style={{
            background: isFollowing ? "rgba(116,185,255,0.18)" : "rgba(255,255,255,0.1)",
            border: isFollowing
              ? "1px solid rgba(116,185,255,0.45)"
              : "1px solid rgba(255,255,255,0.2)",
            color: isFollowing ? "#dff3ff" : "#e0e0e0",
            borderRadius: 4,
            padding: "2px 8px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {isFollowing ? t("charDetail.unfollow") : t("charDetail.follow")}
        </button>
        <button onClick={openEditor} style={editBtnStyle}>{t("charDetail.editProfile")}</button>
      </div>

      {(profile.role || profile.coreMotivation) && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4, lineHeight: 1.55, flexShrink: 0 }}>
          {profile.role && <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>{profile.role}</span>}
          {profile.role && profile.coreMotivation && <span style={{ margin: "0 5px", opacity: 0.4 }}>·</span>}
          {profile.coreMotivation && <span>{profile.coreMotivation}</span>}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 8, lineHeight: 1.6, flexShrink: 0 }}>
        <div>
          {t("charDetail.location")}: {locationNames[state.location] || state.location} · {t("charDetail.emotion")}: {emotionLabel}
          {state.currentAction ? ` · ${t("charDetail.action")}: ${state.currentActionLabel || formatActionName(state.currentAction)}` : ""}
        </div>
      </div>

      {editFlash && !editing && (
        <div style={{ fontSize: 11, color: "#8df3cf", marginBottom: 6, flexShrink: 0 }}>{editFlash}</div>
      )}

      {editing && (
        <ProfileEditor
          draft={editDraft}
          onChange={setEditDraft}
          onSave={saveProfile}
          onCancel={() => setEditing(false)}
          busy={editBusy}
          flash={editFlash}
        />
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexShrink: 0 }}>
        {(["history", "memory"] as Tab[]).map((tabT) => (
          <button
            key={tabT}
            onClick={() => setTab(tabT)}
            style={{
              flex: 1,
              background: tab === tabT ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
              border: "none",
              color: tab === tabT ? "#fff" : "#888",
              borderRadius: 4,
              padding: "4px 0",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {{ history: t("charDetail.tabHistory"), memory: t("charDetail.tabMemory") }[tabT]}
          </button>
        ))}
      </div>

      <div className="custom-scrollbar" style={{ flex: 1, minHeight: 320, overflowY: "auto", fontSize: 11, color: "#ccc", paddingRight: 4 }}>
        {tab === "history" &&
          mergedHistory.map((record, i) => (
            <div
              key={record.key || i}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: "#666" }}>
                  {t("time.day", { day: record.gameDay })} · {record.timeString || `T${record.gameTick}`}
                </span>
                <span style={{ color: typeColor(record.kind === "dialogue_turn" ? "dialogue" : record.event.type), fontWeight: 600 }}>
                  {formatEventType(record.kind === "dialogue_turn" ? "dialogue" : record.event.type)}
                </span>
              </div>
              {record.kind === "dialogue_turn" ? (
                <>
                  <div style={{ color: "#ddd", lineHeight: 1.5 }}>
                    <span style={{ color: "#74b9ff", fontWeight: 600 }}>
                      {characterNames[record.speakerId] || record.speakerId}
                    </span>
                    <span style={{ color: "#bbb" }}>
                      {" "}
                      {t("charDetail.saidTo")}{" "}
                      {record.listenerId
                        ? characterNames[record.listenerId] || record.listenerId
                        : t("charDetail.theOther")}{" "}
                      {t("charDetail.said")}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: 6,
                      color: "#ddd",
                      lineHeight: 1.5,
                    }}
                  >
                    {record.content}
                  </div>
                  {record.innerMonologue && (
                    <div title={t("charDetail.innerMonologueTitle")} style={{ marginTop: 4, padding: "4px 8px", background: "rgba(255,255,255,0.05)", borderRadius: 6, fontStyle: "italic", color: "#b2bec3" }}>
                      💭 {record.innerMonologue}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ color: "#ddd", lineHeight: 1.5 }}>
                    {formatEventSummary(record.event, { characterNames, locationNames })}
                  </div>
                  {record.event.innerMonologue && (
                    <div title={t("charDetail.innerMonologueTitle")} style={{ marginTop: 4, padding: "4px 8px", background: "rgba(255,255,255,0.05)", borderRadius: 6, fontStyle: "italic", color: "#b2bec3" }}>
                      💭 {record.event.innerMonologue}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        {tab === "memory" &&
          memories.map((m, i) => (
            <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span style={{ color: "#888" }}>[{t(`memoryType.${m.type}`, { defaultValue: m.type })}]</span> {m.content}
            </div>
          ))}
        {((tab === "history" && mergedHistory.length === 0) ||
          (tab === "memory" && memories.length === 0)) && (
          <div style={{ color: "#666", padding: 8, textAlign: "center" }}>{t("charDetail.noData")}</div>
        )}
      </div>
    </div>
  );
}

function eventTouchesCharacter(event: SimulationEvent, charId: string): boolean {
  if (event.actorId === charId || event.targetId === charId) return true;
  if (Array.isArray(event.data?.turns)) {
    return event.data.turns.some((turn: { speaker: string }) => turn.speaker === charId);
  }
  return false;
}

function buildHistoryRecords(events: SimulationEvent[]): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  const dialogueTurns = new Map<string, DialogueTurnRecord>();
  const completeDialogueEvents: Array<{ event: SimulationEvent; sortIndex: number }> = [];

  for (const [sortIndex, event] of events.entries()) {
    if (event.type !== "dialogue" || !Array.isArray(event.data?.turns)) {
      records.push({
        kind: "event",
        key: event.id || `${event.type}-${event.gameDay}-${event.gameTick}-${records.length}`,
        gameDay: event.gameDay,
        gameTick: event.gameTick,
        timeString: event.timeString,
        createdAt: event.createdAt,
        sortIndex,
        event,
      });
      continue;
    }

    const phase = event.data?.phase;
    if (phase === "turn") {
      addDialogueTurnRecords(dialogueTurns, event, sortIndex);
    } else if (phase === "complete") {
      completeDialogueEvents.push({ event, sortIndex });
    }
  }

  for (const { event, sortIndex } of completeDialogueEvents) {
    addDialogueTurnRecords(dialogueTurns, event, sortIndex, true);
  }

  return [...records, ...Array.from(dialogueTurns.values())].sort(compareHistoryRecordsDesc);
}

function addDialogueTurnRecords(
  target: Map<string, DialogueTurnRecord>,
  event: SimulationEvent,
  sortIndex: number,
  onlyFillMissing = false,
): void {
  if (!Array.isArray(event.data?.turns) || event.data.turns.length === 0) return;

  const participants = getDialogueParticipants(event);
  const conversationId = event.data?.conversationId || [...participants].sort().join("__") || event.id;
  const turnIndexStart =
    typeof event.data?.turnIndexStart === "number" ? event.data.turnIndexStart : 0;

  event.data.turns.forEach(
    (turn: { speaker: string; content: string; innerMonologue?: string }, idx: number) => {
      const turnIndex = turnIndexStart + idx;
      const key = `${conversationId}:${turnIndex}`;
      if (onlyFillMissing && target.has(key)) return;
      const listenerId = participants.find((id) => id !== turn.speaker);
      target.set(key, {
        kind: "dialogue_turn",
        key,
        gameDay: event.gameDay,
        gameTick: event.gameTick,
        timeString: event.timeString,
        createdAt: event.createdAt,
        sortIndex,
        event,
        conversationId,
        turnIndex,
        speakerId: turn.speaker,
        listenerId,
        content: turn.content,
        innerMonologue: turn.innerMonologue,
      });
    },
  );
}

function getDialogueParticipants(event: SimulationEvent): string[] {
  const fromData = Array.isArray(event.data?.participants)
    ? event.data.participants.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  const fallback = [event.actorId, event.targetId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return Array.from(new Set([...fromData, ...fallback]));
}

function compareHistoryRecordsDesc(a: HistoryRecord, b: HistoryRecord): number {
  if (a.gameDay !== b.gameDay) return b.gameDay - a.gameDay;
  if (a.gameTick !== b.gameTick) return b.gameTick - a.gameTick;

  if (
    a.kind === "dialogue_turn" &&
    b.kind === "dialogue_turn" &&
    a.conversationId === b.conversationId
  ) {
    return b.turnIndex - a.turnIndex;
  }

  const createdAtCompare = (b.createdAt || "").localeCompare(a.createdAt || "");
  if (createdAtCompare !== 0) return createdAtCompare;

  if (a.sortIndex !== b.sortIndex) return b.sortIndex - a.sortIndex;

  if (a.kind === "dialogue_turn" && b.kind === "dialogue_turn") {
    return b.turnIndex - a.turnIndex;
  }

  if (a.kind === "dialogue_turn") return -1;
  if (b.kind === "dialogue_turn") return 1;
  return 0;
}

function typeColor(type: string): string {
  switch (type) {
    case "dialogue":
      return "#fdcb6e";
    case "movement":
      return "#74b9ff";
    case "action_start":
      return "#00b894";
    case "action_end":
      return "#95a5a6";
    default:
      return "#888";
  }
}

/* ── Profile Editor ── */

const PROFILE_FIELD_KEYS: { key: string; labelKey: string; multiline?: boolean }[] = [
  { key: "coreMotivation", labelKey: "charDetail.fieldCoreMotivation" },
  { key: "coreValues", labelKey: "charDetail.fieldCoreValues" },
  { key: "speakingStyle", labelKey: "charDetail.fieldSpeakingStyle" },
  { key: "fears", labelKey: "charDetail.fieldFears" },
  { key: "backstory", labelKey: "charDetail.fieldBackstory", multiline: true },
];

function ProfileEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
  flash,
}: {
  draft: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  flash: string | null;
}) {
  const { t } = useTranslation();
  const set = (key: string, val: string) => onChange({ ...draft, [key]: val });

  return (
    <div style={editorWrapStyle}>
      {PROFILE_FIELD_KEYS.map((f) =>
        f.multiline ? (
          <label key={f.key} style={fieldLabelStyle}>
            {t(f.labelKey)}
            <textarea
              value={draft[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              rows={3}
              style={fieldTextareaStyle}
            />
          </label>
        ) : (
          <label key={f.key} style={fieldLabelStyle}>
            {t(f.labelKey)}
            <input
              value={draft[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              style={fieldInputStyle}
            />
          </label>
        ),
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onSave} disabled={busy} style={saveBtnStyle(busy)}>
          {busy ? t("charDetail.saving") : t("charDetail.save")}
        </button>
        <button onClick={onCancel} disabled={busy} style={cancelBtnStyle}>{t("charDetail.cancel")}</button>
        {flash && <span style={{ fontSize: 11, color: flash !== t("charDetail.saved") ? "#ffb0b0" : "#8df3cf" }}>{flash}</span>}
      </div>
    </div>
  );
}

const editBtnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#ccc",
  borderRadius: 4,
  padding: "2px 8px",
  cursor: "pointer",
  fontSize: 11,
  marginLeft: "auto",
};

const editorWrapStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "10px 0",
  marginBottom: 8,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  fontSize: 11,
  color: "#aaa",
};

const fieldInputStyle: CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  color: "#e8e8ea",
  padding: "4px 6px",
  fontSize: 12,
  fontFamily: "inherit",
};

const fieldTextareaStyle: CSSProperties = {
  ...fieldInputStyle,
  resize: "vertical",
};

function saveBtnStyle(busy: boolean): CSSProperties {
  return {
    background: busy ? "rgba(116,185,255,0.08)" : "rgba(116,185,255,0.2)",
    border: "1px solid rgba(116,185,255,0.45)",
    color: "#eaf5ff",
    borderRadius: 6,
    padding: "4px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
  };
}

const cancelBtnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#ccc",
  borderRadius: 6,
  padding: "4px 14px",
  fontSize: 12,
  cursor: "pointer",
};
