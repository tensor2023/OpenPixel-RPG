import type { GameTime } from "../types/index.js";

export interface SceneTimeConfig {
  sceneType: "closed" | "open";
  startTime: string;
  tickDurationMinutes: number;
  maxTicks: number | null;
  sceneDay?: number;
  displayFormat: "modern" | "ancient_chinese" | "fantasy";
  multiDay: {
    enabled: boolean;
    endOfDayText: string;
    newDayText: string;
    nextDayStartTime: string;
  };
}

export interface WorldTimeInfo extends GameTime {
  timeString: string;
  period: string;
}

export interface SceneRuntimeInfo {
  bounded: boolean;
  cycleTicks: number;
  naturalDayTicks: number;
  transitionEnabled: boolean;
}

let currentSceneConfig: SceneTimeConfig = {
  sceneType: "closed",
  startTime: "08:00",
  tickDurationMinutes: 15,
  maxTicks: null,
  sceneDay: 1,
  displayFormat: "modern",
  multiDay: {
    enabled: false,
    endOfDayText: "",
    newDayText: "",
    nextDayStartTime: "08:00",
  },
};

export function setSceneConfig(config: SceneTimeConfig): void {
  currentSceneConfig = {
    ...config,
    multiDay: {
      enabled: config.multiDay?.enabled ?? false,
      endOfDayText: config.multiDay?.endOfDayText ?? "",
      newDayText: config.multiDay?.newDayText ?? (config.multiDay as any)?.dayTransitionText ?? "",
      nextDayStartTime: config.multiDay?.nextDayStartTime || config.startTime,
    },
  };
}

export function getSceneConfig(): SceneTimeConfig {
  return currentSceneConfig;
}

export function isBoundedScene(config?: SceneTimeConfig): boolean {
  const c = config || currentSceneConfig;
  return c.sceneType === "open";
}

export function getNaturalDayTicks(config?: SceneTimeConfig): number {
  const c = config || currentSceneConfig;
  return Math.max(1, Math.round((24 * 60) / c.tickDurationMinutes));
}

export function getSceneTickLimit(config?: SceneTimeConfig): number {
  const c = config || currentSceneConfig;
  if (isBoundedScene(c)) {
    return Math.max(1, c.maxTicks ?? getNaturalDayTicks(c));
  }
  return getNaturalDayTicks(c);
}

export function getBatchTicksForOneCycle(config?: SceneTimeConfig): number {
  return getSceneTickLimit(config);
}

export function isSceneTransitionTick(
  tick: number,
  config?: SceneTimeConfig,
): boolean {
  const limit = getSceneTickLimit(config);
  return tick >= limit - 1;
}

export function shouldRunMacroReflection(
  tick: number,
  config?: SceneTimeConfig,
): boolean {
  return isSceneTransitionTick(tick, config);
}

export function buildSceneRuntimeInfo(
  config?: SceneTimeConfig,
): SceneRuntimeInfo {
  const c = config || currentSceneConfig;
  return {
    bounded: isBoundedScene(c),
    cycleTicks: getSceneTickLimit(c),
    naturalDayTicks: getNaturalDayTicks(c),
    transitionEnabled: isBoundedScene(c) && c.multiDay.enabled,
  };
}

export function tickToSceneTime(
  tick: number,
  config?: SceneTimeConfig,
): string {
  const c = config || currentSceneConfig;
  const [startH, startM] = getEffectiveStartTime(c).split(":").map(Number);
  const totalMinutes = startH * 60 + startM + tick * c.tickDurationMinutes;
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  if (c.displayFormat === "ancient_chinese") {
    return formatAncientChinese(hours, minutes);
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatAncientChinese(hours: number, minutes: number): string {
  const periods = [
    "子", "丑", "寅", "卯", "辰", "巳",
    "午", "未", "申", "酉", "戌", "亥",
  ];
  const idx = Math.floor(((hours + 1) % 24) / 2);
  const half = hours % 2 === 0 ? "初" : "正";
  const hhmm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return `${periods[idx]}时${half} (${hhmm})`;
}

export function gameTimeToString(gt: GameTime): string {
  return `Day ${gt.day} ${tickToSceneTime(gt.tick)}`;
}

/**
 * 带"时段"语义的时间字符串，形如：
 *   "23:30（深夜）"、"07:15（清晨）"
 * 用于喂给 LLM，让它更自然地被"现在是什么时候"影响。
 */
export function tickToSceneTimeWithPeriod(
  tick: number,
  config?: SceneTimeConfig,
): string {
  const base = tickToSceneTime(tick, config);
  const period = getTimePeriodLabel(tick, config);
  return `${base}（${period}）`;
}

export function isSceneEnding(
  tick: number,
  config?: SceneTimeConfig,
): boolean {
  return shouldRunMacroReflection(tick, config);
}

export function isSceneComplete(
  tick: number,
  config?: SceneTimeConfig,
): boolean {
  return isSceneTransitionTick(tick, config);
}

export function absoluteTick(gameTime: GameTime): number {
  return (gameTime.day - 1) * getTicksPerScene() + gameTime.tick;
}

export function compareGameTime(a: GameTime, b: GameTime): number {
  if (a.day !== b.day) return a.day - b.day;
  return a.tick - b.tick;
}

export function getTimePeriodLabel(
  tick: number,
  config?: SceneTimeConfig,
): string {
  const c = config || currentSceneConfig;
  const [startH, startM] = getEffectiveStartTime(c).split(":").map(Number);
  const totalMinutes = startH * 60 + startM + tick * c.tickDurationMinutes;
  const hours = Math.floor(totalMinutes / 60) % 24;

  if (hours >= 5 && hours < 9) return "清晨";
  if (hours >= 9 && hours < 12) return "上午";
  if (hours >= 12 && hours < 14) return "中午";
  if (hours >= 14 && hours < 17) return "下午";
  if (hours >= 17 && hours < 19) return "傍晚";
  if (hours >= 19 && hours < 22) return "晚上";
  return "深夜";
}

export function getTicksPerScene(config?: SceneTimeConfig): number {
  return getSceneTickLimit(config);
}

export function buildWorldTimeInfo(
  gameTime: GameTime,
  config?: SceneTimeConfig,
): WorldTimeInfo {
  return {
    day: gameTime.day,
    tick: gameTime.tick,
    timeString: tickToSceneTime(gameTime.tick, config),
    period: getTimePeriodLabel(gameTime.tick, config),
  };
}

export function relativeTimeLabel(
  memoryDay: number,
  memoryTick: number,
  now: GameTime,
): string {
  if (memoryDay === now.day) {
    const tickDiff = now.tick - memoryTick;
    if (tickDiff <= 2) return "刚才";
    if (tickDiff <= 6) return "不久前";
    return "今天早些时候";
  }
  if (memoryDay === now.day - 1) return "昨天";
  const gap = now.day - memoryDay;
  return `${gap}天前`;
}

export function getSceneEndingHint(
  tick: number,
  config?: SceneTimeConfig,
): string {
  const c = config || currentSceneConfig;
  const limit = getSceneTickLimit(c);
  const remaining = limit - 1 - tick;
  const threshold = c.tickDurationMinutes > 30 ? 1 : 2;
  if (remaining > threshold) return "";
  return "⏰ 这一幕即将结束。不要发起新的对话，正在进行的对话请自然收束，不要开启新话题。";
}

function getEffectiveStartTime(config: SceneTimeConfig): string {
  if ((config.sceneDay ?? 1) > 1 && config.multiDay.enabled) {
    return config.multiDay.nextDayStartTime || config.startTime;
  }
  return config.startTime;
}
