import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import { translationStore } from "../services/translation-store";
import type { CharacterInfo } from "../../types/api";

type ChatMsg = { role: "user" | "character"; content: string; pending?: boolean; translated?: string };

const IDENTITY_PRESET_KEYS = [
  { labelKey: "sandbox.presetNone", valueKey: "" },
  { labelKey: "sandbox.presetOldFriend", valueKey: "sandbox.presetOldFriendVal" },
  { labelKey: "sandbox.presetReporter", valueKey: "sandbox.presetReporterVal" },
  { labelKey: "sandbox.presetStranger", valueKey: "sandbox.presetStrangerVal" },
  { labelKey: "sandbox.presetFutureSelf", valueKey: "sandbox.presetFutureSelfVal" },
  { labelKey: "sandbox.presetEnemy", valueKey: "sandbox.presetEnemyVal" },
];

export function SandboxChatPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [charId, setCharId] = useState("");
  const [identity, setIdentity] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeChar, setActiveChar] = useState<{ id: string; name: string; role: string } | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiClient
      .getCharacters()
      .then((list) => {
        setCharacters(list);
        if (list.length > 0) setCharId(list[0].id);
      })
      .catch((e) => {
        console.warn("[SandboxChatPanel] load characters failed", e);
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    apiClient
      .sandboxChatGet(sessionId)
      .catch(() => {
        if (cancelled) return;
        setSessionId(null);
        setActiveChar(null);
        setMessages([]);
        setDraft("");
        setErr(t("sandbox.sessionExpired"));
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, t]);

  const startSession = async () => {
    if (!charId) return;
    setBusy(true);
    setErr(null);
    try {
      const resp = await apiClient.sandboxChatStart({
        characterId: charId,
        userIdentity: identity.trim() || undefined,
      });
      setSessionId(resp.sessionId);
      setActiveChar(resp.character);
      setMessages([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetSession = async () => {
    if (sessionId) {
      try {
        await apiClient.sandboxChatClose(sessionId);
      } catch {
        // ignore
      }
    }
    setSessionId(null);
    setActiveChar(null);
    setMessages([]);
    setDraft("");
    setErr(null);
  };

  const send = async () => {
    if (busy || !sessionId) return;
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "character", content: "…", pending: true },
    ]);
    setBusy(true);

    try {
      const resp = await apiClient.sandboxChatSend({ sessionId, message: text });
      const reply = resp.reply;
      let translated: string | undefined;
      if (translationStore.enabled) {
        translated = (await translationStore.translate(reply)) ?? undefined;
      }
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].pending) {
            next[i] = { role: "character", content: reply, translated };
            break;
          }
        }
        return next;
      });
    } catch (e) {
      const errorText = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].pending) {
            next[i] = {
              role: "character",
              content: t("sandbox.chatFailed", { error: errorText }),
            };
            break;
          }
        }
        return next;
      });

      if (errorText.includes("404") || errorText.includes("session not found")) {
        setSessionId(null);
        setActiveChar(null);
        setDraft("");
        setErr(t("sandbox.sessionExpired"));
      }
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>💬</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t("sandbox.title")}</span>
            <span style={{ opacity: 0.55, fontSize: 11 }}>
              {t("sandbox.subtitle")}
            </span>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        {!sessionId && (
          <div style={bodyStyle}>
            <label style={{ ...labelStyle, marginTop: 4 }}>{t("sandbox.whoToChat")}</label>
            <select
              value={charId}
              onChange={(e) => setCharId(e.target.value)}
              style={selectStyle}
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.id}）
                </option>
              ))}
            </select>

            <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>{t("sandbox.identityLabel")}</label>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {IDENTITY_PRESET_KEYS.map((p) => (
                  <button
                    key={p.labelKey}
                    onClick={() => setIdentity(p.valueKey ? t(p.valueKey) : "")}
                    style={chipStyle(identity === (p.valueKey ? t(p.valueKey) : ""))}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
              <textarea
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder={t("sandbox.identityPlaceholder")}
                rows={2}
                style={{ ...textareaStyle, width: "100%", boxSizing: "border-box", fontSize: 12 }}
              />
            </div>

            <div style={hintStyle}>
              {t("sandbox.hint")}
            </div>

            {err && <div style={errStyle}>{t("sandbox.failed", { error: err })}</div>}

            <button
              onClick={startSession}
              disabled={busy || !charId}
              style={{ ...primaryBtnStyle(busy), padding: "12px 14px", fontSize: 15, marginTop: 4 }}
            >
              {busy ? t("sandbox.connecting") : t("sandbox.startChat")}
            </button>
          </div>
        )}

        {sessionId && activeChar && (
          <div style={chatBodyStyle}>
            <div style={chatMetaStyle}>
              <div>
                <span style={{ fontWeight: 600, color: "#c9d8ff" }}>{activeChar.name}</span>
                <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 6 }}>
                  ({activeChar.role})
                </span>
              </div>
              <button onClick={resetSession} style={smallBtnStyle}>{t("sandbox.backToSelect")}</button>
            </div>

            <div ref={scrollRef} style={scrollStyle}>
              {messages.length === 0 && (
                <div style={{ opacity: 0.5, fontSize: 12, textAlign: "center", padding: 16 }}>
                  {t("sandbox.emptyChat")}
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div style={m.role === "user" ? userBubble : charBubble(m.pending)}>
                    <div>{m.content}</div>
                    {m.translated && (
                      <div style={{
                        color: "#7c87ad",
                        fontSize: 11,
                        lineHeight: 1.38,
                        marginTop: 4,
                        paddingTop: 4,
                        borderTop: "1px dashed rgba(110,123,255,0.2)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}>
                        {m.translated}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={inputRowStyle}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder={t("sandbox.chatPlaceholder")}
                rows={2}
                style={{ ...textareaStyle, flex: 1 }}
                disabled={busy}
                autoFocus
              />
              <button
                onClick={send}
                disabled={busy || !draft.trim()}
                style={sendBtnStyle(busy || !draft.trim())}
              >
                {busy ? "…" : t("sandbox.send")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- styles ----------

const backdropStyle: CSSProperties = {
  position: "fixed",
  top: "var(--top-ui-offset, 0px)", left: 0, right: 0, bottom: 0,
  background: "rgba(2,6,18,0.55)",
  zIndex: 500,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "0 16px 16px",
  overflowY: "auto",
};

const panelStyle: CSSProperties = {
  width: "min(620px, calc(100% - 32px))",
  maxHeight: "calc(100vh - var(--top-ui-offset, 0px) - 16px)",
  background: "linear-gradient(180deg, rgba(10,22,42,0.98), rgba(8,14,28,0.98))",
  border: "1px solid rgba(120,180,255,0.18)",
  borderRadius: 14,
  boxShadow: "0 28px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(120,180,255,0.05)",
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
  width: 28, height: 28,
  opacity: 0.7,
};

const bodyStyle: CSSProperties = {
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.75,
  letterSpacing: 0.2,
};

const selectStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "#e8e8ea",
  padding: "6px 8px",
  fontSize: 13,
};

const textareaStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(120,180,255,0.2)",
  borderRadius: 8,
  color: "#e8e8ea",
  padding: "8px 10px",
  fontSize: 13,
  resize: "vertical",
  fontFamily: "inherit",
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  lineHeight: 1.6,
  padding: "8px 10px",
  border: "1px dashed rgba(120,180,255,0.2)",
  borderRadius: 6,
};

const errStyle: CSSProperties = {
  fontSize: 12,
  color: "#ff8a8a",
  background: "rgba(255,80,80,0.08)",
  padding: "6px 8px",
  borderRadius: 6,
};

const primaryBtnStyle = (disabled: boolean): CSSProperties => ({
  background: disabled
    ? "rgba(120,180,255,0.2)"
    : "linear-gradient(135deg, #4a8bff, #6aa7ff)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
});

const chipStyle = (active: boolean): CSSProperties => ({
  background: active ? "rgba(120,180,255,0.25)" : "rgba(255,255,255,0.04)",
  border: `1px solid ${active ? "rgba(120,180,255,0.6)" : "rgba(255,255,255,0.1)"}`,
  color: "#e0e0e0",
  borderRadius: 14,
  padding: "4px 10px",
  fontSize: 11,
  cursor: "pointer",
});

const chatBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
};

const chatMetaStyle: CSSProperties = {
  padding: "8px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const smallBtnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#c8c8c8",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const scrollStyle: CSSProperties = {
  flex: 1,
  minHeight: 280,
  maxHeight: "50vh",
  overflowY: "auto",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background:
    "radial-gradient(ellipse at top, rgba(80,140,220,0.05), transparent 60%)",
};

const userBubble: CSSProperties = {
  background: "linear-gradient(135deg, #3a6dc9, #4a8bff)",
  color: "#fff",
  padding: "7px 11px",
  borderRadius: "12px 12px 2px 12px",
  maxWidth: "75%",
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const charBubble = (pending?: boolean): CSSProperties => ({
  background: "rgba(255,255,255,0.06)",
  color: pending ? "#8da3c9" : "#e0e6f2",
  border: "1px solid rgba(120,180,255,0.15)",
  padding: "7px 11px",
  borderRadius: "12px 12px 12px 2px",
  maxWidth: "75%",
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  fontStyle: pending ? "italic" : "normal",
});

const inputRowStyle: CSSProperties = {
  padding: 10,
  borderTop: "1px solid rgba(255,255,255,0.06)",
  display: "flex",
  gap: 8,
  alignItems: "flex-end",
};

const sendBtnStyle = (disabled: boolean): CSSProperties => ({
  background: disabled
    ? "rgba(120,180,255,0.15)"
    : "linear-gradient(135deg, #4a8bff, #6aa7ff)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "0 18px",
  minHeight: 40,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
});
