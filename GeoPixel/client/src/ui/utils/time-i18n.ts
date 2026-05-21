import i18n from "../../i18n";

const PERIOD_KEY_MAP: Record<string, string> = {
  "清晨": "time.dawn",
  "上午": "time.morning",
  "中午": "time.noon",
  "下午": "time.afternoon",
  "傍晚": "time.dusk",
  "晚上": "time.evening",
  "深夜": "time.lateNight",
};

export function translatePeriod(period: string): string {
  const key = PERIOD_KEY_MAP[period];
  if (key) return i18n.t(key);
  return period;
}
