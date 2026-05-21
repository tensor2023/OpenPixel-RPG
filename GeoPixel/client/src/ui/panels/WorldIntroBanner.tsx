import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

const AUTO_HIDE_MS = 8000;
const FADE_MS = 420;

const shownThisSession = new Set<string>();

export function WorldIntroBanner({
  worldKey,
  worldName,
  worldDescription,
  hasRun,
  topOffset,
}: {
  worldKey: string;
  worldName: string;
  worldDescription: string;
  hasRun: boolean;
  topOffset: number;
}) {
  const { t } = useTranslation();
  const description = worldDescription.trim();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [autoHideReady, setAutoHideReady] = useState(false);

  const skip = !worldKey || !description || hasRun || shownThisSession.has(worldKey);

  useEffect(() => {
    if (skip) {
      setMounted(false);
      setVisible(false);
      setHovered(false);
      setAutoHideReady(false);
      return;
    }

    shownThisSession.add(worldKey);

    setMounted(true);
    setVisible(false);
    setHovered(false);
    setAutoHideReady(false);

    const rafId = window.requestAnimationFrame(() => {
      setVisible(true);
    });
    const timerId = window.setTimeout(() => {
      setAutoHideReady(true);
    }, AUTO_HIDE_MS);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [worldKey, description, skip]);

  useEffect(() => {
    if (!mounted || !autoHideReady || hovered) return;
    setVisible(false);
  }, [autoHideReady, hovered, mounted]);

  useEffect(() => {
    if (!mounted || visible) return;
    const timerId = window.setTimeout(() => {
      setMounted(false);
    }, FADE_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [mounted, visible]);

  const panelStyle = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      top: topOffset + 12,
      left: "50%",
      transform: visible ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(-10px)",
      width: "min(720px, calc(100vw - 32px))",
      padding: "14px 16px 14px 18px",
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "linear-gradient(180deg, rgba(16,22,45,0.96), rgba(12,18,36,0.92))",
      boxShadow: "0 18px 48px rgba(0,0,0,0.38)",
      backdropFilter: "blur(14px)",
      color: "#eef3ff",
      opacity: visible ? 1 : 0,
      transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
      pointerEvents: mounted ? "auto" : "none",
      zIndex: 160,
    }),
    [mounted, topOffset, visible],
  );

  if (!mounted) return null;

  return (
    <div
      style={panelStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#ffffff",
              marginBottom: 6,
              lineHeight: 1.25,
            }}
          >
            {worldName}
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.65,
              color: "rgba(232,238,255,0.84)",
              whiteSpace: "pre-wrap",
            }}
          >
            {description}
          </div>
        </div>
        <button
          onClick={() => setVisible(false)}
          aria-label={t("app.closeWorldIntro")}
          title={t("app.closeWorldIntro")}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#d9e6ff",
            width: 30,
            height: 30,
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
