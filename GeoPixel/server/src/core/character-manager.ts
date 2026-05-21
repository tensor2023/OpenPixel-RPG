import type {
  CharacterProfile,
  CharacterState,
  GameTime,
  SimulationEvent,
  DiaryEntry,
} from "../types/index.js";
import type { WorldManager } from "./world-manager.js";
import { loadCharacterProfiles } from "../utils/config-loader.js";
import { generateId } from "../utils/id-generator.js";
import * as charStateStore from "../store/character-state-store.js";
import { MemoryManager } from "./memory-manager.js";
import { decayNeeds } from "./needs-manager.js";
import { decayEmotion } from "./emotion-manager.js";
import { getDb } from "../store/db.js";
import * as memoryStore from "../store/memory-store.js";
import fs from "node:fs";
import path from "node:path";

export class CharacterManager {
  memoryManager: MemoryManager;

  private profiles: Map<string, CharacterProfile> = new Map();

  constructor(private worldManager: WorldManager) {
    this.memoryManager = new MemoryManager();
  }

  initialize(): void {
    const profiles = loadCharacterProfiles();

    for (const p of profiles) {
      this.profiles.set(p.id, p);
    }

    const occupiedPointIds = new Set<string>();
    const spawnSeedSalt = `init:${Date.now().toString(36)}`;
    for (const profile of profiles) {
      const state = buildInitialCharacterState(
        profile,
        this.worldManager,
        occupiedPointIds,
        spawnSeedSalt,
      );
      if (state.mainAreaPointId) {
        occupiedPointIds.add(state.mainAreaPointId);
      }
      charStateStore.initCharacterState(state);

      for (const initMem of profile.initialMemories) {
        if (
          memoryStore.hasMemory(
            profile.id,
            initMem.type,
            initMem.content,
            1,
            0,
          )
        ) {
          continue;
        }

        this.memoryManager.addMemory({
          characterId: profile.id,
          type: initMem.type,
          content: initMem.content,
          gameTime: { day: 1, tick: 0 },
          importance: initMem.importance,
          emotionalValence: initMem.emotionalValence,
          emotionalIntensity: initMem.emotionalIntensity,
          relatedCharacters: initMem.relatedCharacters,
          relatedLocation: initMem.relatedLocation,
          relatedObjects: initMem.relatedObjects,
          tags: initMem.tags,
        });
      }

      if (profile.backstory) {
        const backstoryMemContent = profile.backstory;
        if (
          !memoryStore.hasMemory(profile.id, "experience", backstoryMemContent, 1, 0)
        ) {
          this.memoryManager.addMemory({
            characterId: profile.id,
            type: "experience",
            content: backstoryMemContent,
            gameTime: { day: 1, tick: 0 },
            importance: 8,
            emotionalValence: 0,
            emotionalIntensity: 3,
            relatedCharacters: [],
            relatedLocation: profile.startPosition,
            relatedObjects: [],
            tags: ["backstory"],
          });
        }
      }
    }

  }

  getProfile(charId: string): CharacterProfile {
    const p = this.profiles.get(charId);
    if (p) return p;
    const dp = this.dynamicProfiles.get(charId);
    if (dp) return dp;
    throw new Error(`Profile not found: ${charId}`);
  }

  getAllProfiles(): CharacterProfile[] {
    return [...Array.from(this.profiles.values()), ...this.dynamicProfiles.values()];
  }

  // ── 动态 NPC 管理 ──
  private dynamicProfiles: Map<string, CharacterProfile> = new Map();
  private dynamicStatePatch: Map<string, Partial<CharacterState>> = new Map();

  addDynamicCharacter(profile: CharacterProfile, state: CharacterState): void {
    this.dynamicProfiles.set(profile.id, profile);
    this.dynamicStatePatch.set(profile.id, {
      location: state.location,
      mainAreaPointId: state.mainAreaPointId,
      currentAction: state.currentAction,
      currentActionTarget: state.currentActionTarget,
      emotionValence: state.emotionValence,
      emotionArousal: state.emotionArousal,
      curiosity: state.curiosity,
    });
  }

  removeDynamicCharacter(charId: string): boolean {
    const existed = this.dynamicProfiles.has(charId);
    this.dynamicProfiles.delete(charId);
    this.dynamicStatePatch.delete(charId);
    return existed;
  }

  updateDynamicProfile(
    charId: string,
    patch: Partial<Pick<CharacterProfile, (typeof CharacterManager.EDITABLE_FIELDS)[number]>>,
  ): CharacterProfile {
    const existing = this.dynamicProfiles.get(charId);
    if (!existing) throw new Error(`Dynamic profile not found: ${charId}`);
    const cleaned: Record<string, unknown> = {};
    for (const key of CharacterManager.EDITABLE_FIELDS) {
      if (key in patch) cleaned[key] = (patch as Record<string, unknown>)[key];
    }
    const updated = { ...existing, ...cleaned };
    this.dynamicProfiles.set(charId, updated);
    return updated;
  }

  /** Load persisted NPC profiles from a directory and register as dynamic characters. */
  loadPersistentNpcs(npcsDir: string): number {
    if (!fs.existsSync(npcsDir)) return 0;
    let count = 0;
    const files = fs.readdirSync(npcsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(npcsDir, file), "utf-8");
        const profile = JSON.parse(raw) as CharacterProfile;
        if (!profile.id || !profile.name) continue;
        if (this.dynamicProfiles.has(profile.id)) continue;
        this.dynamicProfiles.set(profile.id, profile);
        this.dynamicStatePatch.set(profile.id, {
          location: profile.startPosition || "main_area",
          mainAreaPointId: null,
          currentAction: null,
          currentActionTarget: null,
          emotionValence: 1,
          emotionArousal: 3,
          curiosity: 70,
        });
        count++;
      } catch (err) {
        console.warn(`[CharacterManager] Failed to load NPC ${file}:`, err);
      }
    }
    return count;
  }

  getDynamicCharacterProfile(charId: string): CharacterProfile | undefined {
    return this.dynamicProfiles.get(charId);
  }

  getAllDynamicProfiles(): CharacterProfile[] {
    return Array.from(this.dynamicProfiles.values());
  }

  /** Editable subset of CharacterProfile fields. */
  static readonly EDITABLE_FIELDS = [
    "coreMotivation", "coreValues", "speakingStyle",
    "fears", "backstory", "socialStyle", "tags",
  ] as const;

  patchProfile(
    charId: string,
    patch: Partial<Pick<CharacterProfile, (typeof CharacterManager.EDITABLE_FIELDS)[number]>>,
  ): CharacterProfile {
    const existing = this.profiles.get(charId) ?? this.dynamicProfiles.get(charId);
    if (!existing) throw new Error(`Profile not found: ${charId}`);
    const cleaned: Record<string, unknown> = {};
    for (const key of CharacterManager.EDITABLE_FIELDS) {
      if (key in patch) cleaned[key] = (patch as Record<string, unknown>)[key];
    }
    const updated = { ...existing, ...cleaned };
    if (this.dynamicProfiles.has(charId)) {
      this.dynamicProfiles.set(charId, updated);
    } else {
      this.profiles.set(charId, updated);
    }
    return updated;
  }

  getState(charId: string): CharacterState {
    // 动态 NPC：返回构造的状态（不持久化）
    const dynamicPatch = this.dynamicStatePatch.get(charId);
    if (dynamicPatch) {
      const profile = this.dynamicProfiles.get(charId);
      return {
        characterId: charId,
        location: dynamicPatch.location ?? "main_area",
        mainAreaPointId: dynamicPatch.mainAreaPointId ?? null,
        currentAction: dynamicPatch.currentAction ?? null,
        currentActionTarget: dynamicPatch.currentActionTarget ?? null,
        actionStartTick: 0,
        actionEndTick: 0,
        emotionValence: dynamicPatch.emotionValence ?? 1,
        emotionArousal: dynamicPatch.emotionArousal ?? 3,
        curiosity: dynamicPatch.curiosity ?? 70,
        dailyPlan: null,
      };
    }
    return charStateStore.getCharacterState(charId);
  }

  getAllStates(): CharacterState[] {
    return charStateStore.getAllCharacterStates();
  }

  resetStatesForNewScene(): void {
    const occupiedPointIds = new Set<string>();
    const currentTime = this.worldManager.getCurrentTime();
    const spawnSeedSalt = `scene:${currentTime.day}:${Date.now().toString(36)}`;

    for (const profile of this.getAllProfiles()) {
      const initialState = buildInitialCharacterState(
        profile,
        this.worldManager,
        occupiedPointIds,
        spawnSeedSalt,
      );
      if (initialState.mainAreaPointId) {
        occupiedPointIds.add(initialState.mainAreaPointId);
      }

      charStateStore.updateCharacterState(profile.id, {
        location: initialState.location,
        mainAreaPointId: initialState.mainAreaPointId,
        currentAction: initialState.currentAction,
        currentActionTarget: initialState.currentActionTarget,
        actionStartTick: initialState.actionStartTick,
        actionEndTick: initialState.actionEndTick,
        emotionValence: initialState.emotionValence,
        emotionArousal: initialState.emotionArousal,
        curiosity: initialState.curiosity,
        dailyPlan: initialState.dailyPlan,
      });
    }
  }

  updateState(charId: string, patch: Partial<CharacterState>): void {
    charStateStore.updateCharacterState(charId, patch);
  }

  tickPassiveUpdate(charId: string, currentTime: GameTime): SimulationEvent[] {
    const state = this.getState(charId);
    const profile = this.getProfile(charId);

    const needsPatch = decayNeeds(state, profile, currentTime.tick);
    const emotionResult = decayEmotion({
      valence: state.emotionValence,
      arousal: state.emotionArousal,
    });

    const fullPatch: Partial<CharacterState> = {
      ...needsPatch,
      emotionValence: emotionResult.valence,
      emotionArousal: emotionResult.arousal,
    };

    charStateStore.updateCharacterState(charId, fullPatch);
    return [];
  }

  getCharactersAtLocation(
    locationId: string,
  ): { profile: CharacterProfile; state: CharacterState }[] {
    const states = charStateStore.getCharactersByLocation(locationId);
    return states.map((s) => ({
      profile: this.getProfile(s.characterId),
      state: s,
    }));
  }

  addDiaryEntry(charId: string, gameDay: number, content: string): DiaryEntry {
    const entry: DiaryEntry = {
      id: generateId(),
      characterId: charId,
      gameDay,
      content,
    };

    getDb()
      .prepare(
        `INSERT INTO diary_entries (id, character_id, game_day, content) VALUES (?, ?, ?, ?)`,
      )
      .run(entry.id, entry.characterId, entry.gameDay, entry.content);

    return entry;
  }

  getDiaryEntries(charId: string, gameDay?: number): DiaryEntry[] {
    if (gameDay !== undefined) {
      return (
        getDb()
          .prepare(
            "SELECT * FROM diary_entries WHERE character_id = ? AND game_day = ? ORDER BY rowid",
          )
          .all(charId, gameDay) as any[]
      ).map(rowToDiary);
    }

    return (
      getDb()
        .prepare(
          "SELECT * FROM diary_entries WHERE character_id = ? ORDER BY game_day, rowid",
        )
        .all(charId) as any[]
    ).map(rowToDiary);
  }
}

function rowToDiary(row: any): DiaryEntry {
  return {
    id: row.id,
    characterId: row.character_id,
    gameDay: row.game_day,
    content: row.content,
  };
}

function buildInitialCharacterState(
  profile: CharacterProfile,
  worldManager: WorldManager,
  occupiedPointIds: Set<string>,
  spawnSeedSalt: string,
): CharacterState {
  const spawnSeed = `${profile.id}:${spawnSeedSalt}`;
  let mainAreaPointId: string | null = null;
  if (profile.startPosition === "main_area") {
    if (profile.anchor?.type === "element") {
      const elementPointId = `element_${profile.anchor.targetId}`;
      const point = worldManager.getMainAreaPoint(elementPointId);
      // Anchored characters always spawn at their anchor point, even if it's
      // in a small disconnected component of the point graph.
      mainAreaPointId = point
        ? elementPointId
        : worldManager.getSpreadMainAreaPointId(spawnSeed, occupiedPointIds);
    } else {
      mainAreaPointId = worldManager.getSpreadMainAreaPointId(spawnSeed, occupiedPointIds);
    }
  }

  return {
    characterId: profile.id,
    location: profile.startPosition,
    mainAreaPointId,
    currentAction: null,
    currentActionTarget: null,
    actionStartTick: 0,
    actionEndTick: 0,
    emotionValence: 1,
    emotionArousal: clampStat(3 + profile.extraversionLevel * 2),
    curiosity: clampStat(64 + profile.intuitionLevel * 20),
    dailyPlan: null,
  };
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
