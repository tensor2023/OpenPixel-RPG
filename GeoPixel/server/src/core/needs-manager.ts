import type { CharacterState, CharacterProfile } from "../types/index.js";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const STRENUOUS_ACTIONS = ["explore", "work", "exercise", "build", "repair"];

export function decayNeeds(
  charState: CharacterState,
  profile: CharacterProfile,
  _tick: number,
): Partial<CharacterState> {
  const isStrenuous = STRENUOUS_ACTIONS.some(
    (a) => charState.currentAction?.includes(a),
  );

  const curiosityDelta = isStrenuous
    ? -(1 + 1.0 * profile.intuitionLevel)
    : -(0.5 + 1.0 * profile.intuitionLevel);

  return {
    curiosity: clamp(charState.curiosity + curiosityDelta, 0, 100),
  };
}
