import type { GameTime } from "./world.js";

export type SimEventType =
  | "action_start"
  | "action_end"
  | "movement"
  | "dialogue"
  | "relationship_change"
  | "memory_formed"
  | "emotion_shift"
  | "world_state_change"
  | "event_triggered"
  | "diary_entry"
  | "daily_plan"
  | "reflection";

export interface SimulationEvent {
  id: string;
  gameDay: number;
  gameTick: number;
  type: SimEventType;
  actorId?: string;
  targetId?: string;
  location: string;
  data: Record<string, any>;
  innerMonologue?: string;
  dramScore?: number;
  tags: string[];
}

export interface DialogueResult {
  participants: string[];
  location: string;
  turns: DialogueTurn[];
  memoriesGenerated: Record<string, string>;
  tags: string[];
  endReason?: string;
}

export interface DialogueTurn {
  speaker: string;
  content: string;
  innerMonologue?: string;
}

export type DialogueEventPhase = "turn" | "complete";

export type DialogueSessionStatus = "active" | "finalizing" | "completed";

export interface DialogueSession {
  id: string;
  participants: [string, string];
  location: string;
  startedAt: GameTime;
  lastUpdatedAt: GameTime;
  status: DialogueSessionStatus;
  nextSpeaker: string;
  transcript: DialogueTurn[];
  turnsThisTick: number;
  totalTurns: number;
  initiatorId: string;
  motivation: string;
  pendingReason?: string;
  endReason?: string;
  tags: string[];
}

export interface DialogueTurnGeneration {
  turn: DialogueTurn;
  shouldContinue: boolean;
  suggestedNextSpeaker?: string;
  endReason?: string;
  tags: string[];
}

export interface DialogueEventData {
  conversationId: string;
  phase: DialogueEventPhase;
  turns: DialogueTurn[];
  turnIndexStart: number;
  isFinal: boolean;
  participants: string[];
  memoriesGenerated?: Record<string, string>;
  endReason?: string;
}

/** 感知结果（传给 AI 的当前环境信息） */
export interface Perception {
  currentLocation: string;
  locationDescription: string;
  myZone?: string;
  objectsHere: {
    id: string;
    name: string;
    state: string;
    stateDescription: string;
    availableInteractions: string[];
  }[];
  charactersHere: {
    id: string;
    name: string;
    currentAction: string | null;
    emotionLabel?: string;
    appearanceHint?: string;
    locationId?: string;
    locationName?: string;
    zone?: string;
  }[];
  recentEnvironmentChanges: string[];
  recentActions: string[];
}

/** AI 决策输出 */
export interface ActionDecision {
  actionType: "interact_object" | "world_action" | "talk_to" | "move_to" | "move_within_main_area" | "idle";
  targetId: string;
  interactionId?: string;
  reason: string;
  innerMonologue?: string;
}
