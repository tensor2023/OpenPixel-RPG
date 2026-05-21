export type MemoryType =
  | "observation"
  | "conversation"
  | "hearsay"
  | "experience"
  | "reflection"
  | "emotion"
  | "dream";

/** 角色人设配置（来自 JSON 文件，恒定层） */
export interface CharacterProfile {
  id: string;
  name: string;
  role: string;
  nickname: string;
  startPosition: string;
  backstory?: string;
  appearanceHint?: string;

  coreMotivation: string;
  coreValues: string[];
  speakingStyle: string;
  fears: string[];

  preferredLocations: string[];
  preferredActivities: string[];
  socialStyle: "extrovert" | "introvert_selective" | "introvert";
  extraversionLevel: number;
  intuitionLevel: number;

  skills: string[];
  writeDiary: boolean;
  fourthWallCandidate: boolean;
  tags: string[];

  initialMemories: Omit<
    MemoryEntry,
    | "id"
    | "characterId"
    | "gameDay"
    | "gameTick"
    | "accessCount"
    | "isLongTerm"
    | "decayFactor"
  >[];

  /** 锚定：限制角色必须待在某个区域或可交互元素附近 */
  anchor?: CharacterAnchor;

  /** 仅为知名 IP 角色而填，普通原创角色应为 undefined */
  iconicCues?: IconicCues;
  canonicalRefs?: CanonicalRefs;

  /**
   * 外观ID — 引用预置的 spritesheet 纹理。
   * 生成NPC时通过 role→appearance 匹配自动分配。
   * 客户端用此ID而非 characterId 加载精灵图。
   */
  appearanceId?: string;
}

export interface CharacterAnchor {
  type: "region" | "element";
  targetId: string;
}

export interface IconicCues {
  speechQuirks: string[];
  catchphrases: string[];
  behavioralTics: string[];
}

export interface CanonicalRefs {
  source?: string;
  keyRelationships: string[];
  signatureMoments: string[];
}

/** 角色运行时状态（存 DB，易变层） */
export interface CharacterState {
  characterId: string;
  location: string;
  mainAreaPointId: string | null;
  currentAction: string | null;
  currentActionTarget: string | null;
  actionStartTick: number;
  actionEndTick: number;

  emotionValence: number;
  emotionArousal: number;

  curiosity: number;

  dailyPlan: string | null;
}

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  characterId: string;
  type: MemoryType;
  content: string;
  gameDay: number;
  gameTick: number;
  importance: number;
  emotionalValence: number;
  emotionalIntensity: number;
  relatedCharacters: string[];
  relatedLocation: string;
  relatedObjects: string[];
  tags: string[];
  decayFactor: number;
  accessCount: number;
  isLongTerm: boolean;
  embedding?: number[];
}

/** 日程计划 */
export interface DailyPlan {
  characterId: string;
  gameDay: number;
  items: PlanItem[];
}

export interface PlanItem {
  period: "morning" | "midday" | "afternoon" | "evening" | "night";
  plan: string;
  motivation: string;
  location?: string;
}

/** 日记 */
export interface DiaryEntry {
  id: string;
  characterId: string;
  gameDay: number;
  content: string;
}
