import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";

export type TransitionPhase = "hidden" | "ending" | "starting" | "fade-out";

export function SceneTransition({
  day,
  phase,
  title,
  timeString,
  periodLabel,
  variant = "open",
  onCovered,
  onComplete,
}: {
  day: number;
  phase: TransitionPhase;
  title?: string;
  timeString?: string;
  periodLabel?: string;
  variant?: "open" | "closed";
  onCovered?: () => void;
  onComplete?: () => void;
}) {
  const [opacity, setOpacity] = useState(0);
  const [contentOffset, setContentOffset] = useState(20);
  const { t } = useTranslation();

  const onCoveredRef = useRef(onCovered);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCoveredRef.current = onCovered;
    onCompleteRef.current = onComplete;
  }, [onCovered, onComplete]);

  useEffect(() => {
    if (phase === "hidden") {
      setOpacity(0);
      setContentOffset(20);
    } else if (phase === "ending") {
      setOpacity(1);
      setContentOffset(0);
      const coveredTimer = setTimeout(() => onCoveredRef.current?.(), 400);
      return () => clearTimeout(coveredTimer);
    } else if (phase === "starting") {
      setOpacity(1);
      setContentOffset(0);
    } else if (phase === "fade-out") {
      setOpacity(0);
      setContentOffset(-10);
      const fadeTimer = setTimeout(() => onCompleteRef.current?.(), 1500);
      return () => clearTimeout(fadeTimer);
    }
  }, [phase, day]);

  if (phase === "hidden" && opacity === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background:
          variant === "open"
            ? "radial-gradient(circle at 50% 35%, rgba(72,112,180,0.2), rgba(8,10,18,0.96) 58%, rgba(4,6,12,0.98))"
            : "rgba(10, 10, 20, 0.95)",
        opacity,
        transition: opacity === 1 ? "opacity 0.4s ease-out" : "opacity 1.5s ease-in-out",
        pointerEvents: phase !== "hidden" ? "auto" : "none",
        overflow: "hidden",
        willChange: "opacity",
        transform: "translateZ(0)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            variant === "open"
              ? "linear-gradient(180deg, rgba(255,255,255,0.03), transparent 30%, rgba(255,255,255,0.02) 68%, transparent)"
              : "transparent",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "min(72vw, 760px)",
          height: 160,
          transform: "translate(-50%, -50%)",
          background:
            variant === "open"
              ? "linear-gradient(90deg, transparent, rgba(196,223,255,0.18), rgba(138,188,255,0.26), rgba(196,223,255,0.18), transparent)"
              : "linear-gradient(90deg, transparent, rgba(156,201,255,0.12), transparent)",
          filter: "blur(30px)",
          opacity: 0.9,
        }}
      />
      <div
        style={{
          position: "relative",
          transform: `translateY(${contentOffset}px)`,
          transition: "transform 1.5s ease",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "32px 40px",
          borderRadius: 24,
          WebkitBackdropFilter: "blur(6px)",
          backdropFilter: "blur(6px)",
          background:
            "linear-gradient(180deg, rgba(44, 60, 92, 0.34), rgba(18, 24, 38, 0.32))",
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow:
            "0 18px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
          isolation: "isolate",
          willChange: "transform, opacity",
        }}
      >
        <div
          style={{
            fontSize: phase === "ending" ? 28 : 20,
            fontWeight: phase === "ending" ? 400 : 500,
            color: phase === "ending" ? "#e0e0e0" : "#9cc9ff",
            letterSpacing: 4,
            marginBottom: 18,
            textAlign: "center",
            maxWidth: "80%",
            lineHeight: 1.5,
          }}
        >
          {title || t("sceneTransition.defaultTitle")}
        </div>
        {phase !== "ending" && (
          <div
            style={{
              fontSize: 48,
              fontWeight: 300,
              color: "#e0e0e0",
              letterSpacing: 4,
              marginBottom: 18,
              textAlign: "center",
            }}
          >
            {t("sceneTransition.dayLabel", { day })}
          </div>
        )}
        {phase !== "ending" && (timeString || periodLabel) && (
          <div
            style={{
              color: "rgba(224, 224, 224, 0.78)",
              fontSize: 18,
              letterSpacing: 2,
              marginBottom: 18,
            }}
          >
            {[timeString, periodLabel].filter(Boolean).join(" · ")}
          </div>
        )}
        <div
          style={{
            width: 60,
            height: 2,
            background: "linear-gradient(90deg, transparent, #74b9ff, transparent)",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: "auto 0 12% 0",
          display: "flex",
          justifyContent: "center",
          opacity: 0.35,
        }}
      >
        <div
          style={{
            width: "min(80vw, 680px)",
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)",
          }}
        />
      </div>
    </div>
  );
}
