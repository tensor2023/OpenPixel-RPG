import { apiClient } from "./api-client";

class TranslationStore {
  private _enabled: boolean;
  private cache = new Map<string, string>();

  constructor() {
    this._enabled = localStorage.getItem("translate-to-cn") === "true";
  }

  get enabled(): boolean {
    return this._enabled;
  }

  toggle(): void {
    this._enabled = !this._enabled;
    localStorage.setItem("translate-to-cn", String(this._enabled));
  }

  async translate(text: string): Promise<string | null> {
    if (!this._enabled || !text.trim()) return null;

    const cached = this.cache.get(text);
    if (cached) return cached;

    try {
      const resp = await apiClient.translateText({ text });
      if (resp.translated) {
        this.cache.set(text, resp.translated);
        return resp.translated;
      }
      return null;
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const translationStore = new TranslationStore();
