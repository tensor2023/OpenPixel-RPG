export interface GameTime {
  day: number;
  tick: number;
}

export interface MultiDayConfig {
  enabled: boolean;
  endOfDayText: string;
  newDayText: string;
  nextDayStartTime: string;
}

export interface SceneConfigInfo {
  sceneType: string;
  startTime: string;
  tickDurationMinutes: number;
  maxTicks: number | null;
  displayFormat: string;
  description: string;
  multiDay: MultiDayConfig;
}

export interface SceneRuntimeInfo {
  bounded: boolean;
  cycleTicks: number;
  naturalDayTicks: number;
  transitionEnabled: boolean;
}

export interface CharacterInfo {
  id: string;
  name: string;
  role: string;
  nickname: string;
  location: string;
  mainAreaPointId?: string | null;
  emotion: string;
  currentAction: string | null;
  currentActionLabel?: string | null;
  anchor?: { type: "region" | "element"; targetId: string } | null;
  appearanceId?: string | null;
}

export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  nickname: string;
  backstory?: string;
  appearanceHint?: string;
  coreMotivation: string;
  coreValues: string[];
  speakingStyle: string;
  fears: string[];
  socialStyle: string;
  tags: string[];
  [key: string]: unknown;
}

export interface CharacterDetail {
  profile: CharacterProfile;
  state: {
    location: string;
    mainAreaPointId?: string | null;
    currentAction: string | null;
    currentActionLabel?: string | null;
    emotionValence: number;
    emotionArousal: number;
    curiosity: number;
  };
  emotionLabel: string;
}

export interface DiaryEntry {
  day: number;
  content: string;
  createdAt: string;
}

export interface MemoryEntry {
  type: string;
  content: string;
  importance: number;
  createdAt: string;
}

export interface DialogueTurn {
  speaker: string;
  content: string;
  innerMonologue?: string;
}

export interface DialogueEventData {
  conversationId: string;
  phase: "turn" | "complete";
  turns: DialogueTurn[];
  turnIndexStart: number;
  isFinal: boolean;
  participants: string[];
  memoriesGenerated?: Record<string, string>;
  endReason?: string;
}

export interface SimulationEvent {
  id: string;
  type: string;
  gameDay: number;
  gameTick: number;
  timeString?: string;
  period?: string;
  actorId?: string;
  targetId?: string;
  location?: string;
  data: any | DialogueEventData;
  innerMonologue?: string;
  dramScore?: number;
  createdAt: string;
}

export interface WorldTimeInfo extends GameTime {
  timeString: string;
  period: string;
}

export interface LocationInfo {
  id: string;
  name: string;
  description: string;
}

export interface MainAreaPointInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  adjacentPointIds: string[];
}

export interface TimelineMeta {
  id: string;
  worldId: string;
  createdAt: string;
  updatedAt: string;
  lastGameTime: GameTime;
  tickCount: number;
  status: "recording" | "stopped";
}

export interface TimelineWithWorld {
  worldId: string;
  worldName: string;
  source?: "user" | "library";
  isCurrent: boolean;
  timelines: TimelineMeta[];
}

export interface TimelineInitFrame {
  type: "init";
  gameTime: GameTime;
  characters: {
    id: string;
    name: string;
    location: string;
    mainAreaPointId: string | null;
  }[];
}

export interface TimelineTickFrame {
  type: "tick";
  gameTime: GameTime;
  events: SimulationEvent[];
}

export type TimelineFrame = TimelineInitFrame | TimelineTickFrame;

/** NPC 管理面板用的 NPC 信息 */
export interface ManagedNpcInfo {
  id: string;
  name: string;
  role: string;
  nickname?: string;
  appearanceId: string | null;
  backstory: string;
  coreMotivation: string;
  speakingStyle: string;
  coreValues: string[];
  fears: string[];
  preferredActivities: string[];
  socialStyle: string;
  personality: string;
}
