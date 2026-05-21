import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import type { CharacterInfo } from "../../types/api";

type TabKey = "broadcast" | "whisper";

const PRESET_CARD_KEYS = [
  { emoji: "☔", labelKey: "god.presetRain", contentKey: "god.presetRainContent", tone: "tense" },
  { emoji: "🔌", labelKey: "god.presetBlackout", contentKey: "god.presetBlackoutContent", tone: "eerie" },
  { emoji: "🚪", labelKey: "god.presetStranger", contentKey: "god.presetStrangerContent", tone: "mysterious" },
  { emoji: "📜", labelKey: "god.presetLetter", contentKey: "god.presetLetterContent", tone: "ominous" },
  { emoji: "🌪️", labelKey: "god.presetWind", contentKey: "god.presetWindContent", tone: "chaotic" },
  { emoji: "🐦", labelKey: "god.presetBirds", contentKey: "god.presetBirdsContent", tone: "eerie" },
];

export function GodPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("broadcast");
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastBroadcastAt, setLastBroadcastAt] = useState<number | null>(null);

  const [broadcastContent, setBroadcastContent] = useState("");
  const [broadcastScope, setBroadcastScope] = useState("global");
  const [broadcastTone, setBroadcastTone] = useState("");

  const [whisperCharId, setWhisperCharId] = useState("");
  const [whisperContent, setWhisperContent] = useState("");
  const [whisperImportance, setWhisperImportance] = useState(8);
  const [whisperType, setWhisperType] = useState<"observation" | "dream" | "reflection" | "experience">("observation");

  useEffect(() => {
    apiClient
      .getCharacters()
      .then((list) => {
        setCharacters(list);
        if (list.length > 0) setWhisperCharId(list[0].id);
      })
      .catch((err) => {
        console.warn("[GodPanel] load characters failed", err);
      });
  }, []);

  const recentlyBroadcasted = useMemo(() => {
    if (!lastBroadcastAt) return false;
    return Date.now() - lastBroadcastAt < 30_000;
  }, [lastBroadcastAt]);

  const showFlash = (kind: "ok" | "err", text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash(null), 3500);
  };

  const doBroadcast = async (content: string, tone?: string, scope?: string) => {
    if (busy) return;
    const trimmed = content.trim();
    if (!trimmed) {
      showFlash("err", t("god.emptyContent"));
      return;
    }
    setBusy(true);
    try {
      const resp = await apiClient.godBroadcast({
        content: trimmed,
        scope: scope || broadcastScope,
        tone: tone || broadcastTone || undefined,
      });
      showFlash("ok", t("god.broadcastSuccess", { count: resp.memoryWrittenTo }));
      setLastBroadcastAt(Date.now());
      setBroadcastContent("");
    } catch (err) {
      showFlash("err", t("god.failedPrefix", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const doWhisper = async () => {
    if (busy) return;
    if (!whisperCharId) {
      showFlash("err", t("god.selectCharError"));
      return;
    }
    const trimmed = whisperContent.trim();
    if (!trimmed) {
      showFlash("err", t("god.emptyContent"));
      return;
    }
    setBusy(true);
    try {
      await apiClient.godWhisper({
        characterId: whisperCharId,
        content: trimmed,
        importance: whisperImportance,
        type: whisperType,
      });
      const charName = characters.find((c) => c.id === whisperCharId)?.name ?? whisperCharId;
      showFlash("ok", t("god.whisperSuccess", { name: charName }));
      setWhisperContent("");
    } catch (err) {
      showFlash("err", t("god.failedPrefix", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>👁️</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t("god.title")}</span>
            <span style={{ opacity: 0.55, fontSize: 11 }}>
              {t("god.subtitle")}
            </span>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={tabsStyle}>
          {(["broadcast", "whisper"] as TabKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={tabBtnStyle(tab === key)}
            >
              {key === "broadcast" ? t("god.tabBroadcast") : t("god.tabWhisper")}
            </button>
          ))}
        </div>

        <div style={bodyStyle}>
          {tab === "broadcast" && (
            <div style={sectionStyle}>
              <label style={labelStyle}>{t("god.broadcastContent")}</label>
              <textarea
                value={broadcastContent}
                onChange={(e) => setBroadcastContent(e.target.value)}
                placeholder={t("god.broadcastPlaceholder")}
                rows={4}
                style={textareaStyle}
              />
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{t("god.scopeLabel")}</span>
                  <select
                    value={broadcastScope}
                    onChange={(e) => setBroadcastScope(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="global">{t("god.scopeGlobal")}</option>
                    <option value="main_area">main_area</option>
                  </select>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{t("god.toneLabel")}</span>
                  <input
                    type="text"
                    value={broadcastTone}
                    onChange={(e) => setBroadcastTone(e.target.value)}
                    placeholder={t("god.tonePlaceholder")}
                    style={{ ...inputStyle, width: 180 }}
                  />
                </div>
              </div>
              <button
                onClick={() => doBroadcast(broadcastContent)}
                disabled={busy}
                style={primaryBtnStyle(busy)}
              >
                {busy ? t("god.sending") : t("god.broadcast")}
              </button>

              <div style={presetDividerStyle}>
                <span style={{ fontSize: 11, opacity: 0.5 }}>{t("god.disasterCards")}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {PRESET_CARD_KEYS.map((card) => (
                  <button
                    key={card.labelKey}
                    disabled={busy}
                    onClick={() => doBroadcast(t(card.contentKey), card.tone)}
                    style={presetCardStyle(busy)}
                  >
                    <div style={{ fontSize: 18 }}>{card.emoji}</div>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{t(card.labelKey)}</div>
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4 }}>{t(card.contentKey)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "whisper" && (
            <div style={sectionStyle}>
              <label style={labelStyle}>{t("god.whisperTarget")}</label>
              <select
                value={whisperCharId}
                onChange={(e) => setWhisperCharId(e.target.value)}
                style={selectStyle}
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（{c.id}）
                  </option>
                ))}
              </select>
              <label style={labelStyle}>{t("god.whisperContentLabel")}</label>
              <textarea
                value={whisperContent}
                onChange={(e) => setWhisperContent(e.target.value)}
                placeholder={t("god.whisperPlaceholder")}
                rows={4}
                style={textareaStyle}
              />
              <div style={{ fontSize: 10, opacity: 0.45, marginTop: -4 }}>
                {t("god.whisperHint")}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{t("god.importanceLabel")}</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={whisperImportance}
                    onChange={(e) => setWhisperImportance(Number(e.target.value))}
                  />
                  <span style={{ fontSize: 11, minWidth: 16, textAlign: "right" }}>{whisperImportance}</span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{t("god.typeLabel")}</span>
                  <select
                    value={whisperType}
                    onChange={(e) => setWhisperType(e.target.value as typeof whisperType)}
                    style={selectStyle}
                  >
                    <option value="observation">{t("god.typeObservation")}</option>
                    <option value="dream">{t("god.typeDream")}</option>
                    <option value="reflection">{t("god.typeReflection")}</option>
                    <option value="experience">{t("god.typeExperience")}</option>
                  </select>
                </div>
              </div>
              <button onClick={doWhisper} disabled={busy} style={primaryBtnStyle(busy)}>
                {busy ? t("god.implanting") : t("god.implant")}
              </button>
            </div>
          )}
        </div>

        {flash && (
          <div
            style={{
              ...flashStyle,
              background: flash.kind === "ok" ? "rgba(0,184,148,0.18)" : "rgba(231,76,60,0.22)",
              color: flash.kind === "ok" ? "#8df3cf" : "#ffb0b0",
              border: `1px solid ${flash.kind === "ok" ? "rgba(0,184,148,0.45)" : "rgba(231,76,60,0.45)"}`,
            }}
          >
            {flash.text}
          </div>
        )}
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  top: "var(--top-ui-offset, 0px)",
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(4,6,12,0.55)",
  zIndex: 500,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "0 16px 16px",
  overflowY: "auto",
};

const panelStyle: CSSProperties = {
  width: "min(560px, calc(100% - 32px))",
  maxHeight: "calc(100vh - var(--top-ui-offset, 0px) - 16px)",
  background: "linear-gradient(180deg, rgba(16,20,36,0.98), rgba(12,14,26,0.98))",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  boxShadow: "0 28px 70px rgba(0,0,0,0.55)",
  color: "#e0e0e0",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#e0e0e0",
  fontSize: 22,
  cursor: "pointer",
  lineHeight: 1,
  padding: 0,
  width: 28,
  height: 28,
  opacity: 0.7,
};

const tabsStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  padding: "10px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const bodyStyle: CSSProperties = {
  padding: 14,
  overflowY: "auto",
};

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.75,
  letterSpacing: 0.2,
};

const textareaStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#e8e8ea",
  padding: "8px 10px",
  fontSize: 13,
  resize: "vertical",
  fontFamily: "inherit",
};

const inputStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  color: "#e8e8ea",
  padding: "4px 8px",
  fontSize: 12,
};

const selectStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 6,
  color: "#e8e8ea",
  padding: "4px 8px",
  fontSize: 12,
};

const presetDividerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 6,
};

const flashStyle: CSSProperties = {
  margin: "0 14px 14px",
  padding: "8px 12px",
  borderRadius: 8,
  fontSize: 12,
};

function tabBtnStyle(active: boolean): CSSProperties {
  return {
    background: active ? "rgba(116,185,255,0.18)" : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(116,185,255,0.45)" : "rgba(255,255,255,0.1)"}`,
    color: active ? "#dff3ff" : "#e0e0e0",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 12,
    cursor: "pointer",
  };
}

function primaryBtnStyle(busy: boolean): CSSProperties {
  return {
    background: busy ? "rgba(116,185,255,0.1)" : "rgba(116,185,255,0.22)",
    border: "1px solid rgba(116,185,255,0.5)",
    color: "#eaf5ff",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? "wait" : "pointer",
    alignSelf: "flex-start",
  };
}

function presetCardStyle(busy: boolean): CSSProperties {
  return {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#e0e0e0",
    textAlign: "left",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
    transition: "all 0.15s",
  };
}
