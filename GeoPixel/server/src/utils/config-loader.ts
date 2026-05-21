import fs from "node:fs";
import path from "node:path";
import type { WorldConfig, CharacterProfile, SceneConfig } from "../types/index.js";
import type { IconicCues, CanonicalRefs, CharacterAnchor } from "../types/character.js";

let worldDir: string | null = null;
let cachedWorldConfig: WorldConfig | null = null;
let cachedCharacterProfiles: CharacterProfile[] | null = null;
let cachedPromptTemplates: Map<string, string> = new Map();
let cachedSceneConfig: SceneConfig | null = null;

const CONFIGS_DIR = fs.existsSync(path.resolve("configs"))
  ? path.resolve("configs")
  : path.resolve("../configs");

export function setWorldDir(dir: string): void {
  worldDir = dir;
  reloadConfigs();
}

export function getWorldDir(): string | null {
  return worldDir;
}

export function loadWorldConfig(): WorldConfig {
  if (cachedWorldConfig) return cachedWorldConfig;

  const candidates = [
    worldDir ? path.join(worldDir, "world.json") : null,
    worldDir ? path.join(worldDir, "config", "world.json") : null,
    path.join(CONFIGS_DIR, "world.json"),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      cachedWorldConfig = JSON.parse(raw) as WorldConfig;
      return cachedWorldConfig;
    }
  }
  throw new Error("world.json not found");
}

export function loadCharacterProfiles(): CharacterProfile[] {
  if (cachedCharacterProfiles) return cachedCharacterProfiles;

  const candidates = [
    worldDir ? path.join(worldDir, "config", "characters") : null,
    worldDir ? path.join(worldDir, "characters") : null,
    path.join(CONFIGS_DIR, "characters"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(dir!)) {
      const files = fs.readdirSync(dir!).filter((f) => f.endsWith(".json"));
      cachedCharacterProfiles = files
        .map((f) => {
        const raw = fs.readFileSync(path.join(dir!, f), "utf-8");
          return normalizeCharacterProfile(JSON.parse(raw));
        })
        .filter(Boolean) as CharacterProfile[];
      if (cachedCharacterProfiles.length > 0) {
      return cachedCharacterProfiles;
      }
    }
  }
  throw new Error("Characters directory not found");
}

export function loadSceneConfig(): SceneConfig {
  if (cachedSceneConfig) return cachedSceneConfig;

  const wc = loadWorldConfig();
  let sceneFromFile: Record<string, unknown> | null = null;

  const candidates = [
    worldDir ? path.join(worldDir, "scene.json") : null,
    worldDir ? path.join(worldDir, "config", "scene.json") : null,
    path.join(CONFIGS_DIR, "scene.json"),
  ].filter(Boolean) as string[];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath!)) {
      const raw = fs.readFileSync(filePath!, "utf-8");
      sceneFromFile = JSON.parse(raw) as Record<string, unknown>;
      break;
    }
  }

  const worldScene =
    wc.scene && typeof wc.scene === "object"
      ? (wc.scene as unknown as Record<string, unknown>)
      : null;
  const mergedScene = {
    ...(sceneFromFile ?? {}),
    ...(worldScene ?? {}),
    multiDay: {
      ...((sceneFromFile?.multiDay as Record<string, unknown> | undefined) ?? {}),
      ...((worldScene?.multiDay as Record<string, unknown> | undefined) ?? {}),
    },
  };

  cachedSceneConfig = normalizeSceneConfig(mergedScene);
  return cachedSceneConfig;
}

export function loadPromptTemplate(name: string): string {
  if (cachedPromptTemplates.has(name)) return cachedPromptTemplates.get(name)!;
  const filePath = path.join(CONFIGS_DIR, "prompts", `${name}.md`);
  const content = fs.readFileSync(filePath, "utf-8");
  cachedPromptTemplates.set(name, content);
  return content;
}

export function reloadConfigs(): void {
  cachedWorldConfig = null;
  cachedCharacterProfiles = null;
  cachedSceneConfig = null;
  cachedPromptTemplates.clear();
}

function normalizeCharacterProfile(raw: any): CharacterProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.id || !raw.name) {
    return null;
  }

  const startLocation = normalizeStartLocation(raw.startPosition);
  const socialStyle = normalizeSocialStyle(raw.socialStyle);
  const extraversionLevel = normalizeExtraversionLevel(raw.extraversionLevel, socialStyle);
  const intuitionLevel = normalizeIntuitionLevel(raw.intuitionLevel, raw);

  return {
    id: raw.id,
    name: raw.name,
    role: raw.role || "NPC",
    nickname: raw.nickname || raw.name,
    startPosition: startLocation,
    backstory: typeof raw.backstory === "string" ? raw.backstory : undefined,
    appearanceHint:
      typeof raw.appearanceHint === "string" && raw.appearanceHint.trim()
        ? raw.appearanceHint.trim()
        : undefined,
    coreMotivation: raw.coreMotivation || raw.motivation || raw.role || "在这个世界中过好自己的生活",
    coreValues: Array.isArray(raw.coreValues) ? raw.coreValues : [],
    speakingStyle:
      raw.speakingStyle ||
      (typeof raw.socialStyle === "string" ? raw.socialStyle : "") ||
      raw.personality ||
      "自然、贴近角色设定",
    fears: Array.isArray(raw.fears) ? raw.fears : [],
    preferredLocations: Array.isArray(raw.preferredLocations)
      ? raw.preferredLocations
      : [startLocation],
    preferredActivities: Array.isArray(raw.preferredActivities) ? raw.preferredActivities : [],
    socialStyle,
    extraversionLevel,
    intuitionLevel,
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    writeDiary: raw.writeDiary ?? true,
    fourthWallCandidate: raw.fourthWallCandidate ?? false,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    initialMemories: normalizeInitialMemories(raw.initialMemories, startLocation),
    anchor: normalizeAnchor(raw.anchor),
    iconicCues: normalizeIconicCues(raw.iconicCues),
    canonicalRefs: normalizeCanonicalRefs(raw.canonicalRefs),
    appearanceId: raw.appearanceId || undefined,
  };
}

function normalizeAnchor(raw: unknown): CharacterAnchor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const type = r.type;
  const targetId = r.targetId;
  if ((type === "region" || type === "element") && typeof targetId === "string" && targetId.length > 0) {
    return { type, targetId };
  }
  return undefined;
}

function normalizeIconicCues(raw: unknown): IconicCues | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const speechQuirks = toStringArray(r.speechQuirks);
  const catchphrases = toStringArray(r.catchphrases).slice(0, 2);
  const behavioralTics = toStringArray(r.behavioralTics);
  if (speechQuirks.length === 0 && catchphrases.length === 0 && behavioralTics.length === 0) {
    return undefined;
  }
  return { speechQuirks, catchphrases, behavioralTics };
}

function normalizeCanonicalRefs(raw: unknown): CanonicalRefs | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const source = typeof r.source === "string" ? r.source.trim() : "";
  const keyRelationships = toStringArray(r.keyRelationships);
  const signatureMoments = toStringArray(r.signatureMoments).slice(0, 2);
  if (!source && keyRelationships.length === 0 && signatureMoments.length === 0) {
    return undefined;
  }
  return {
    source: source || undefined,
    keyRelationships,
    signatureMoments,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function normalizeStartLocation(startPosition: unknown): string {
  if (typeof startPosition === "string" && startPosition) {
    return startPosition;
  }
  if (
    startPosition &&
    typeof startPosition === "object" &&
    "locationId" in startPosition &&
    typeof (startPosition as { locationId?: unknown }).locationId === "string"
  ) {
    return (startPosition as { locationId: string }).locationId;
  }
  return "main_area";
}

function normalizeSocialStyle(value: unknown): CharacterProfile["socialStyle"] {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("introvert_selective") || text.includes("selective")) {
    return "introvert_selective";
  }
  if (text.includes("introvert") || text.includes("内向")) {
    return "introvert";
  }
  if (text.includes("ambivert") || text.includes("中间") || text.includes("外冷内热")) {
    return "introvert_selective";
  }
  return "extrovert";
}

function normalizeExtraversionLevel(
  value: unknown,
  socialStyle: CharacterProfile["socialStyle"],
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  switch (socialStyle) {
    case "extrovert":
      return 0.8;
    case "introvert_selective":
      return 0.55;
    case "introvert":
    default:
      return 0.25;
  }
}

function normalizeIntuitionLevel(value: unknown, raw: any): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  const haystack = `${raw?.personality || ""} ${(raw?.traits || []).join(" ")}`.toLowerCase();
  if (
    haystack.includes("好奇") ||
    haystack.includes("curious") ||
    haystack.includes("creative") ||
    haystack.includes("创意")
  ) {
    return 0.7;
  }
  return 0.5;
}

function normalizeInitialMemories(
  initialMemories: unknown,
  startLocation: string,
): CharacterProfile["initialMemories"] {
  if (!Array.isArray(initialMemories)) return [];

  return initialMemories
    .filter((item) => item && typeof item === "object" && typeof item.content === "string")
    .map((item: any) => ({
      type: item.type || "reflection",
      content: item.content,
      importance: typeof item.importance === "number" ? item.importance : 6,
      emotionalValence:
        typeof item.emotionalValence === "number" ? item.emotionalValence : 0,
      emotionalIntensity:
        typeof item.emotionalIntensity === "number" ? item.emotionalIntensity : 1,
      relatedCharacters: Array.isArray(item.relatedCharacters) ? item.relatedCharacters : [],
      relatedLocation:
        typeof item.relatedLocation === "string" ? item.relatedLocation : startLocation,
      relatedObjects: Array.isArray(item.relatedObjects) ? item.relatedObjects : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
    }));
}

function normalizeSceneConfig(raw: Record<string, unknown> | null | undefined): SceneConfig {
  const sceneType = raw?.sceneType === "open" ? "open" : "closed";
  const startTime = typeof raw?.startTime === "string" && raw.startTime ? raw.startTime : "08:00";
  const tickDurationMinutes =
    typeof raw?.tickDurationMinutes === "number" && Number.isFinite(raw.tickDurationMinutes)
      ? Math.max(1, Math.floor(raw.tickDurationMinutes))
      : 15;

  let maxTicks: number | null = null;
  if (sceneType === "open") {
    if (typeof raw?.maxTicks === "number" && Number.isFinite(raw.maxTicks)) {
      maxTicks = Math.max(1, Math.floor(raw.maxTicks));
    } else if (typeof raw?.endTime === "string" && raw.endTime) {
      maxTicks = deriveTicksFromTimeRange(startTime, raw.endTime as string, tickDurationMinutes);
    } else {
      maxTicks = Math.round((12 * 60) / tickDurationMinutes);
    }
  }

  return {
    sceneType,
    startTime,
    tickDurationMinutes,
    maxTicks,
    displayFormat:
      raw?.displayFormat === "ancient_chinese" || raw?.displayFormat === "fantasy"
        ? raw.displayFormat
        : "modern",
    description: typeof raw?.description === "string" ? raw.description : "",
    multiDay: normalizeMultiDay(raw?.multiDay, startTime, maxTicks, sceneType),
  };
}

function normalizeMultiDay(
  raw: unknown,
  startTime: string,
  _maxTicks: number | null,
  sceneType: SceneConfig["sceneType"],
): SceneConfig["multiDay"] {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const enabled = sceneType === "open";
  const nextDayStartTime = sceneType === "open" ? startTime : "00:00";

  return {
    enabled,
    endOfDayText:
      typeof data.endOfDayText === "string" ? data.endOfDayText : "",
    newDayText:
      typeof data.newDayText === "string" ? data.newDayText : (typeof data.dayTransitionText === "string" ? data.dayTransitionText : ""),
    nextDayStartTime:
      typeof data.nextDayStartTime === "string" && data.nextDayStartTime
        ? data.nextDayStartTime
        : nextDayStartTime,
  };
}

function deriveTicksFromTimeRange(
  startTime: string,
  endTime: string,
  tickDurationMinutes: number,
): number {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const diffMinutes = (endMinutes - startMinutes + 24 * 60) % (24 * 60);
  const windowMinutes = diffMinutes === 0 ? 24 * 60 : diffMinutes;
  return Math.max(1, Math.round(windowMinutes / tickDurationMinutes));
}

function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return ((h * 60 + m) % (24 * 60) + 24 * 60) % (24 * 60);
}
