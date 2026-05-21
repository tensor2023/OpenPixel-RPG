import { useTranslation } from "react-i18next";
import { toggleLanguage } from "../../i18n";
import type { CSSProperties } from "react";

export function LanguageToggle({ style }: { style?: CSSProperties }) {
  const { t } = useTranslation();

  return (
    <button
      onClick={toggleLanguage}
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: "#c8d0e8",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        cursor: "pointer",
        letterSpacing: "0.04em",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {t("lang.toggle")}
    </button>
  );
}
