import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./zh.json";
import en from "./en.json";

const STORAGE_KEY = "ui-lang";

function getInitialLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {}
  const browserLang = navigator.language?.toLowerCase() ?? "";
  return browserLang.startsWith("zh") ? "zh" : "en";
}

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export function toggleLanguage() {
  const next = i18n.language === "zh" ? "en" : "zh";
  i18n.changeLanguage(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
}

export default i18n;
