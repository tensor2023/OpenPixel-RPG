import type { GameTime } from "../types/api";

export function getCurrentPlaybackTime(): GameTime {
  const now = new Date();
  const startDate = new Date(import.meta.env.VITE_GAME_START_DATE || "2026-04-15");
  const ticksPerScene = Math.max(
    1,
    Number(import.meta.env.VITE_TICKS_PER_SCENE || 48),
  );
  const msPerDay = 86400000;
  const dayDiff = Math.floor((now.getTime() - startDate.getTime()) / msPerDay) + 1;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const tick = Math.floor(minuteOfDay / 30);
  return {
    day: Math.max(1, dayDiff),
    tick: Math.min(ticksPerScene - 1, Math.max(0, tick)),
  };
}
