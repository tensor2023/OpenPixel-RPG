function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function updateEmotion(
  current: { valence: number; arousal: number },
  event: { valence: number; intensity: number },
): { valence: number; arousal: number } {
  return {
    valence: clamp(current.valence * 0.7 + event.valence * 0.3, -5, 5),
    arousal: clamp(current.arousal * 0.8 + event.intensity * 0.2, 0, 10),
  };
}

export function decayEmotion(current: {
  valence: number;
  arousal: number;
}): { valence: number; arousal: number } {
  return {
    valence: current.valence * 0.95,
    arousal: current.arousal * 0.95 + 3 * 0.05,
  };
}

export function getEmotionLabel(valence: number, arousal: number): string {
  if (arousal >= 6) {
    if (valence >= 2) return "兴奋";
    if (valence <= -2) return "愤怒";
    return "紧张";
  }
  if (arousal >= 3) {
    if (valence >= 2) return "满足";
    if (valence <= -2) return "沮丧";
    return "平静";
  }
  // arousal < 3
  if (valence >= 2) return "安宁";
  if (valence <= -2) return "悲伤";
  if (arousal <= 1) return "无聊";
  return "平静";
}
