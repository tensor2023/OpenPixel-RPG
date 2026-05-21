import type {
  ActionDecision,
  DialogueEventData,
  DialogueResult,
  DialogueSession,
  DialogueTurn,
  Perception,
  SimulationEvent,
  GameTime,
} from "../types/index.js";
import type { WorldManager } from "../core/world-manager.js";
import type { CharacterManager } from "../core/character-manager.js";
import type { LLMClient } from "../llm/llm-client.js";
import type { PromptBuilder } from "../llm/prompt-builder.js";
import { DecisionMaker } from "./decision-maker.js";
import { DialogueGenerator } from "./dialogue-generator.js";
import { buildPerception } from "./perceiver.js";
import { buildActionMenu } from "./action-menu-builder.js";
import { executeAction, completeAction } from "./action-executor.js";
import {
  DiarySchema,
  MemoryEvalSchema,
  MicroReflectionSchema,
  ReflectionSchema,
} from "../llm/output-schemas.js";
import * as memoryStore from "../store/memory-store.js";
import {
  absoluteTick,
  getBatchTicksForOneCycle,
  tickToSceneTimeWithPeriod,
} from "../utils/time-helpers.js";
import { generateId } from "../utils/id-generator.js";
import * as eventStore from "../store/event-store.js";
import { calculateDramScore, flagHighDramaEvents } from "../content/drama-scorer.js";
import { extractQuotes } from "../content/quote-extractor.js";
import { generateDailySummary } from "../content/summary-generator.js";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MAX_DIALOGUE_TURNS_PER_TICK = 2;
const WORLD_ACTION_TARGET_PREFIX = "world_action:";

type TickIntent = {
  decision: ActionDecision;
};

export class SimulationEngine {
  private decisionMaker: DecisionMaker;
  private dialogueGenerator: DialogueGenerator;
  private memoryEvalQueue: Promise<void> = Promise.resolve();

  constructor(
    private worldManager: WorldManager,
    private characterManager: CharacterManager,
    private llmClient: LLMClient,
    private promptBuilder: PromptBuilder,
  ) {
    this.decisionMaker = new DecisionMaker(
      llmClient,
      promptBuilder,
      characterManager,
      worldManager,
    );
    this.dialogueGenerator = new DialogueGenerator(
      llmClient,
      promptBuilder,
      characterManager,
      worldManager,
    );
  }

  async simulateTick(): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];
    const tickAdvance = this.worldManager.advanceTick();
    const { previousTime, currentTime: gameTime, didAdvanceDay } = tickAdvance;
    const absNow = absoluteTick(gameTime);

    if (didAdvanceDay) {
      events.push(...await this.runCycleTransition(previousTime));
      return this.finalizeTickEvents(events);
    }

    const allChars = shuffle(this.characterManager.getAllProfiles());

    for (const char of allChars) {
      events.push(
        ...this.characterManager.tickPassiveUpdate(char.id, gameTime),
      );
    }

    const activeSessions = this.reconcileDialogueSessions();
    const decisionEligible: string[] = [];

    for (const char of allChars) {
      try {
        const shouldDecide = this.prepareCharacterForTick(
          char.id,
          gameTime,
          absNow,
          events,
        );
        if (shouldDecide) {
          decisionEligible.push(char.id);
        }
      } catch (err) {
        console.error(`[SimEngine] Error preparing ${char.id}:`, err);
      }
    }

    const intents = await this.buildTickIntents(decisionEligible, gameTime, events);
    const dialogueIntentByInitiator = new Map<string, ActionDecision>();

    for (const charId of decisionEligible) {
      const intent = intents.get(charId);
      if (intent?.decision.actionType === "talk_to") {
        const movementDecision = this.buildMoveTowardDialogueTargetDecision(
          charId,
          intent.decision,
        );
        if (movementDecision) {
          intent.decision = movementDecision;
        } else {
          dialogueIntentByInitiator.set(charId, intent.decision);
        }
      }
    }

    const selectedSessions = this.selectDialogueSessions({
      allChars,
      gameTime,
      activeSessions,
      dialogueIntentByInitiator,
      absNow,
    });
    const charsReservedForDialogue = new Set(
      selectedSessions.flatMap((session) => session.participants),
    );

    for (const charId of decisionEligible) {
      if (charsReservedForDialogue.has(charId)) continue;

      const intent = intents.get(charId);
      if (!intent || intent.decision.actionType === "talk_to") continue;

      events.push(
        ...executeAction(
          intent.decision,
          charId,
          this.worldManager,
          this.characterManager,
          gameTime,
        ),
      );
    }

    const sessionResults = await Promise.allSettled(
      selectedSessions.map((session) =>
        this.runDialogueSession(session, gameTime, absNow),
      ),
    );

    for (const result of sessionResults) {
      if (result.status === "fulfilled") {
        events.push(...result.value);
      } else {
        console.error("[SimEngine] Dialogue session error:", result.reason);
      }
    }

    if (this.shouldRunMicroReflectionWave(gameTime)) {
      events.push(...await this.runMicroReflectionWave(gameTime));
    }

    this.scheduleRecentMemoryEvaluation(gameTime);
    return this.finalizeTickEvents(events);
  }

  async simulateDay(): Promise<SimulationEvent[]> {
    const allEvents: SimulationEvent[] = [];
    const currentTime = this.worldManager.getCurrentTime();
    const sceneConfig = this.worldManager.getSceneConfig();
    const maxTicks = getBatchTicksForOneCycle({
      sceneType: sceneConfig.sceneType,
      startTime: sceneConfig.startTime,
      tickDurationMinutes: sceneConfig.tickDurationMinutes,
      maxTicks: sceneConfig.maxTicks,
      sceneDay: currentTime.day,
      displayFormat: sceneConfig.displayFormat,
      multiDay: sceneConfig.multiDay,
    });
    for (let i = 0; i < maxTicks; i++) {
      const events = await this.simulateTick();
      allEvents.push(...events);
      const gt = this.worldManager.getCurrentTime();
      process.stdout.write(
        `\r  Day ${gt.day} Tick ${gt.tick}/${maxTicks - 1} (events: ${allEvents.length})`,
      );
    }
    console.log();
    return allEvents;
  }

  async simulateDays(count: number): Promise<void> {
    for (let d = 0; d < count; d++) {
      const gt = this.worldManager.getCurrentTime();
      console.log(`\n--- Simulating Day ${gt.day} ---`);
      await this.simulateDay();
    }
  }

  private finalizeTickEvents(events: SimulationEvent[]): SimulationEvent[] {
    for (const event of events) {
      event.dramScore = calculateDramScore(event, this.characterManager);
    }
    flagHighDramaEvents(events);
    for (const event of events.filter((e) => e.type === "dialogue")) {
      extractQuotes(event, this.characterManager);
    }
    if (events.length > 0) {
      eventStore.appendEvents(events);
    }
    return events;
  }

  private async runCycleTransition(
    cycleEndTime: GameTime,
  ): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];

    const absNow = absoluteTick(cycleEndTime);
    events.push(...await this.closeAllActiveDialogues(cycleEndTime, absNow));
    await this.flushPendingMemoryEvaluation();

    const reflectionEvents = await this.runReflection(cycleEndTime);
    events.push(...reflectionEvents);

    this.runEndOfDayDecay(cycleEndTime);

    this.worldManager.createSnapshot(`Day ${cycleEndTime.day} ended`);
    this.worldManager.resetTransientStateForNewScene();
    this.characterManager.resetStatesForNewScene();
    this.scheduleDailySummary(cycleEndTime.day);
    return events;
  }

  private async flushPendingMemoryEvaluation(): Promise<void> {
    try {
      await this.memoryEvalQueue;
    } catch (err) {
      console.error("[SimEngine] Pending memory evaluation flush error:", err);
    }
  }

  private scheduleDailySummary(day: number): void {
    void generateDailySummary(day, this.llmClient).catch((err) => {
      console.error("[SimEngine] Daily summary error:", err);
    });
  }

  private shouldRunMicroReflectionWave(gameTime: GameTime): boolean {
    const ticksPerHour = Math.max(
      1,
      Math.round(60 / this.worldManager.getSceneConfig().tickDurationMinutes),
    );
    return gameTime.tick > 0 && gameTime.tick % ticksPerHour === 0;
  }

  private async runMicroReflectionWave(
    gameTime: GameTime,
  ): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];
    const ticksPerHour = Math.max(
      1,
      Math.round(60 / this.worldManager.getSceneConfig().tickDurationMinutes),
    );

    for (const profile of this.characterManager.getAllProfiles()) {
      try {
        const recentMemories = this.characterManager.memoryManager
          .getMemoriesByDay(profile.id, gameTime.day)
          .filter((memory) => {
            if (memory.type === "reflection") return false;
            const age = absoluteTick(gameTime) - absoluteTick({
              day: memory.gameDay,
              tick: memory.gameTick,
            });
            return age >= 0 && age <= ticksPerHour;
          });

        if (recentMemories.length < 2) continue;

        const messages = this.promptBuilder.buildMicroReflectionMessages({
          profile,
          gameDay: gameTime.day,
          timeString: tickToSceneTimeWithPeriod(
            gameTime.tick,
            {
              sceneType: this.worldManager.getSceneConfig().sceneType,
              startTime: this.worldManager.getSceneConfig().startTime,
              tickDurationMinutes: this.worldManager.getSceneConfig().tickDurationMinutes,
              maxTicks: this.worldManager.getSceneConfig().maxTicks,
              sceneDay: gameTime.day,
              displayFormat: this.worldManager.getSceneConfig().displayFormat,
              multiDay: this.worldManager.getSceneConfig().multiDay,
            },
          ),
          currentFocus:
            this.worldManager.getGlobal(`current_focus:${profile.id}`) ?? undefined,
          recentMemories: recentMemories.map((m) => `- ${m.content}`).join("\n"),
        });

        const result = await this.llmClient.call({
          messages,
          schema: MicroReflectionSchema,
          options: { taskType: "micro_reflection", characterId: profile.id },
        });

        this.characterManager.memoryManager.addMemory({
          characterId: profile.id,
          type: "reflection",
          content: result.data.insight,
          gameTime,
          importance: 5,
          emotionalValence: result.data.emotionShift.valence,
          emotionalIntensity: Math.max(
            1,
            Math.abs(result.data.emotionShift.arousal) +
              Math.abs(result.data.emotionShift.valence),
          ),
          tags: ["micro_reflection", ...(result.data.tags || [])],
        });

        const state = this.characterManager.getState(profile.id);
        this.characterManager.updateState(profile.id, {
          emotionValence: Math.max(
            -5,
            Math.min(5, state.emotionValence + result.data.emotionShift.valence),
          ),
          emotionArousal: Math.max(
            0,
            Math.min(10, state.emotionArousal + result.data.emotionShift.arousal),
          ),
        });

        if (result.data.currentFocus) {
          this.worldManager.setGlobal(
            `current_focus:${profile.id}`,
            result.data.currentFocus,
          );
        }

        events.push({
          id: generateId(),
          gameDay: gameTime.day,
          gameTick: gameTime.tick,
          type: "reflection",
          actorId: profile.id,
          location: this.characterManager.getState(profile.id).location,
          data: {
            insights: [result.data.insight],
            emotionShift: result.data.emotionShift,
            currentFocus: result.data.currentFocus,
            scope: "micro",
          },
          tags: ["reflection", "micro_reflection", ...(result.data.tags || [])],
        });
      } catch (err) {
        console.error(`[SimEngine] Micro reflection error for ${profile.id}:`, err);
      }
    }

    return events;
  }

  private normalizeDecision(decision: ActionDecision, actionMenu?: string): ActionDecision {
    let { targetId, interactionId } = decision;
    if (!targetId) return decision;

    targetId =
      decision.actionType === "world_action"
        ? this.resolveWorldActionTargetId(targetId, actionMenu)
        : this.resolveId(targetId);
    if (interactionId) interactionId = this.resolveId(interactionId);

    return { ...decision, targetId, interactionId };
  }

  private resolveWorldActionTargetId(raw: string, actionMenu?: string): string {
    const trimmed = raw.trim();
    const exactAction = this.worldManager.getWorldAction(trimmed);
    if (exactAction) return exactAction.id;

    const menuNumberMatch = trimmed.match(/^#?(\d+)(?:[.)、\s]|$)/);
    const menuNumber = menuNumberMatch ? Number(menuNumberMatch[1]) : NaN;
    if (Number.isInteger(menuNumber) && menuNumber > 0) {
      const actionIdFromMenu = this.resolveWorldActionIdFromMenuNumber(menuNumber, actionMenu);
      if (actionIdFromMenu) return actionIdFromMenu;
    }

    for (const action of this.worldManager.getWorldActions()) {
      if (
        trimmed.includes(action.id) ||
        (action.name && trimmed.includes(action.name))
      ) {
        return action.id;
      }
    }

    return this.resolveId(trimmed);
  }

  private resolveWorldActionIdFromMenuNumber(menuNumber: number, actionMenu?: string): string | null {
    if (!actionMenu) return null;
    const line = actionMenu
      .split("\n")
      .find((candidate) => candidate.trim().startsWith(`${menuNumber}. `));
    if (!line || !line.includes("[world_action]")) return null;

    const match = line.match(/\(([^()]+)\)/);
    const actionId = match?.[1]?.trim();
    return actionId && this.worldManager.getWorldAction(actionId) ? actionId : null;
  }

  private resolveId(raw: string): string {
    const trimmed = raw.trim();

    for (const action of this.worldManager.getWorldActions()) {
      if (trimmed === action.id) return action.id;
    }
    for (const p of this.characterManager.getAllProfiles()) {
      if (trimmed === p.id) return p.id;
    }
    for (const loc of this.worldManager.getAllLocations()) {
      if (trimmed === loc.id) return loc.id;
    }
    for (const p of this.characterManager.getAllProfiles()) {
      if (trimmed.includes(p.id)) return p.id;
    }
    for (const loc of this.worldManager.getAllLocations()) {
      if (trimmed.includes(loc.id)) return loc.id;
    }
    for (const action of this.worldManager.getWorldActions()) {
      if (trimmed.includes(action.id)) return action.id;
    }
    for (const p of this.characterManager.getAllProfiles()) {
      if (trimmed.includes(p.name) || trimmed.includes(p.nickname)) return p.id;
    }
    for (const loc of this.worldManager.getAllLocations()) {
      if (trimmed.includes(loc.name)) return loc.id;
    }
    for (const action of this.worldManager.getWorldActions()) {
      if (trimmed.includes(action.name)) return action.id;
    }
    for (const loc of this.worldManager.getAllLocations()) {
      for (const obj of loc.objects) {
        if (trimmed === obj.id || trimmed.includes(obj.id)) return obj.id;
        for (const inter of obj.interactions) {
          if (trimmed === inter.id || trimmed.includes(inter.id)) return inter.id;
        }
      }
    }

    return trimmed;
  }

  private prepareCharacterForTick(
    charId: string,
    gameTime: GameTime,
    absNow: number,
    events: SimulationEvent[],
  ): boolean {
    let state = this.characterManager.getState(charId);

    if (
      state.currentAction &&
      state.currentAction !== "in_conversation" &&
      absNow >= state.actionEndTick
    ) {
      events.push(
        ...completeAction(
          charId,
          this.worldManager,
          this.characterManager,
          gameTime,
        ),
      );
      state = this.characterManager.getState(charId);
    }

    if (state.currentAction) {
      return false;
    }

    return true;
  }

  private async buildTickIntents(
    charIds: string[],
    gameTime: GameTime,
    events: SimulationEvent[],
  ): Promise<Map<string, TickIntent>> {
    const results = await Promise.allSettled(
      charIds.map(async (charId) => {
        const perception = buildPerception(
          charId,
          this.worldManager,
          this.characterManager,
          gameTime,
        );

        this.maybeGenerateObservationMemory(charId, perception, gameTime, events);

        const actionMenu = buildActionMenu(
          charId,
          perception,
          this.worldManager,
          this.characterManager,
        );
        const rawDecision = await this.decisionMaker.makeDecision(
          charId,
          perception,
          actionMenu,
          gameTime,
        );
        const decision = this.normalizeDecision(rawDecision, actionMenu);
        const intent: TickIntent = { decision };
        return [charId, intent] as const;
      }),
    );

    const intents = new Map<string, TickIntent>();
    for (const result of results) {
      if (result.status === "fulfilled") {
        intents.set(result.value[0], result.value[1]);
      } else {
        console.error("[SimEngine] Decision wave error:", result.reason);
      }
    }
    return intents;
  }

  private reconcileDialogueSessions(): DialogueSession[] {
    const sessions = this.worldManager.listDialogueSessions();
    const activeCharacterIds = new Set<string>();
    const activeSessions: DialogueSession[] = [];

    for (const session of sessions) {
      try {
        const [charA, charB] = session.participants;
        this.characterManager.getState(charA);
        this.characterManager.getState(charB);

        if (session.status !== "active") {
          this.worldManager.deleteDialogueSession(session.id);
          continue;
        }

        activeCharacterIds.add(charA);
        activeCharacterIds.add(charB);
        activeSessions.push({ ...session, turnsThisTick: 0 });
      } catch {
        this.worldManager.deleteDialogueSession(session.id);
      }
    }

    for (const state of this.characterManager.getAllStates()) {
      if (
        state.currentAction === "in_conversation" &&
        !activeCharacterIds.has(state.characterId)
      ) {
        this.characterManager.updateState(state.characterId, {
          currentAction: null,
          currentActionTarget: null,
          actionStartTick: 0,
          actionEndTick: 0,
        });
      }
    }

    return activeSessions;
  }

  private selectDialogueSessions(params: {
    allChars: { id: string }[];
    gameTime: GameTime;
    activeSessions: DialogueSession[];
    dialogueIntentByInitiator: Map<string, ActionDecision>;
    absNow: number;
  }): DialogueSession[] {
    const {
      allChars,
      gameTime,
      activeSessions,
      dialogueIntentByInitiator,
      absNow,
    } = params;
    const selected: DialogueSession[] = [];
    const reservedChars = new Set<string>();

    for (const session of activeSessions) {
      const [charA, charB] = session.participants;
      if (!reservedChars.has(charA) && !reservedChars.has(charB)) {
        reservedChars.add(charA);
        reservedChars.add(charB);
        selected.push({
          ...session,
          location: this.characterManager.getState(charA).location,
          turnsThisTick: 0,
        });
      }
    }

    for (const char of allChars) {
      const decision = dialogueIntentByInitiator.get(char.id);
      if (!decision || !decision.targetId) continue;
      if (reservedChars.has(char.id) || reservedChars.has(decision.targetId)) {
        continue;
      }
      if (!this.canStartDialogue(char.id, decision.targetId)) continue;

      const session = this.createDialogueSession({
        initiatorId: char.id,
        responderId: decision.targetId,
        motivation: decision.reason,
        gameTime,
        absNow,
      });
      reservedChars.add(char.id);
      reservedChars.add(decision.targetId);
      selected.push(session);
    }

    return selected;
  }

  private canStartDialogue(charA: string, charB: string): boolean {
    if (charA === charB) return false;
    if (!this.isKnownCharacter(charB)) return false;
    if (this.worldManager.findDialogueSessionByParticipants(charA, charB)) {
      return false;
    }

    const stateA = this.characterManager.getState(charA);
    const stateB = this.characterManager.getState(charB);
    const initiatorProfile = this.characterManager.getProfile(charA);
    if (!this.canProfileInitiateDialogue(initiatorProfile, stateA.location)) {
      return false;
    }
    return (
      !stateA.currentAction &&
      stateB.currentAction !== "in_conversation" &&
      this.areStatesDialogueCompatible(stateA, stateB)
    );
  }

  private isSessionContinuable(session: DialogueSession): boolean {
    const [charA, charB] = session.participants;
    const stateA = this.characterManager.getState(charA);
    const stateB = this.characterManager.getState(charB);
    return (
      stateA.currentAction === "in_conversation" &&
      stateB.currentAction === "in_conversation" &&
      this.areStatesDialogueCompatible(stateA, stateB)
    );
  }

  private areStatesDialogueCompatible(
    stateA: { location: string; mainAreaPointId?: string | null },
    stateB: { location: string; mainAreaPointId?: string | null },
  ): boolean {
    if (stateA.location !== stateB.location) return false;
    if (stateA.location !== "main_area") return true;
    // main_area can cover a large public space. Only start speaking in-place
    // when the point graph says the two characters are already nearby.
    return this.worldManager.areMainAreaPointsCloseEnoughForDialogueStart(
      stateA.mainAreaPointId,
      stateB.mainAreaPointId,
    );
  }

  private buildMoveTowardDialogueTargetDecision(
    charId: string,
    decision: ActionDecision,
  ): ActionDecision | null {
    if (!decision.targetId || !this.isKnownCharacter(decision.targetId)) {
      return null;
    }

    const stateA = this.characterManager.getState(charId);
    const stateB = this.characterManager.getState(decision.targetId);
    if (stateA.location !== "main_area" || stateB.location !== "main_area") {
      return null;
    }
    if (
      this.worldManager.areMainAreaPointsCloseEnoughForDialogueStart(
        stateA.mainAreaPointId,
        stateB.mainAreaPointId,
      )
    ) {
      return null;
    }
    if (!stateB.mainAreaPointId || stateA.mainAreaPointId === stateB.mainAreaPointId) {
      return null;
    }

    // Preserve the original "main_area characters may choose to talk" design:
    // far or disconnected targets become an explicit movement first. The
    // client can then walk normally, or use its fade-transport fallback if the
    // generated map has an accidental island.
    const targetProfile = this.characterManager.getProfile(decision.targetId);
    return {
      ...decision,
      actionType: "move_within_main_area",
      targetId: `main_area_point:${stateB.mainAreaPointId}`,
      reason: `先靠近${targetProfile.name}再对话。${decision.reason}`,
    };
  }

  private isKnownCharacter(charId: string): boolean {
    return this.characterManager.getAllProfiles().some((profile) => profile.id === charId);
  }

  private canProfileInitiateDialogue(
    profile: { anchor?: { type: string; targetId: string } },
    currentLocation: string,
  ): boolean {
    if (!profile.anchor) return true;
    return (
      profile.anchor.type === "region" &&
      currentLocation !== "main_area" &&
      currentLocation === profile.anchor.targetId
    );
  }

  private createDialogueSession(params: {
    initiatorId: string;
    responderId: string;
    motivation: string;
    gameTime: GameTime;
    absNow: number;
  }): DialogueSession {
    const { initiatorId, responderId, motivation, gameTime, absNow } = params;
    this.interruptCharacterForDialogue(initiatorId);
    this.interruptCharacterForDialogue(responderId);
    const session: DialogueSession = {
      id: generateId(),
      participants: [initiatorId, responderId],
      location: this.characterManager.getState(initiatorId).location,
      startedAt: gameTime,
      lastUpdatedAt: gameTime,
      status: "active",
      nextSpeaker: initiatorId,
      transcript: [],
      turnsThisTick: 0,
      totalTurns: 0,
      initiatorId,
      motivation,
      tags: [],
    };

    this.worldManager.saveDialogueSession(session);
    this.characterManager.updateState(initiatorId, {
      currentAction: "in_conversation",
      currentActionTarget: responderId,
      actionStartTick: absNow,
      actionEndTick: 0,
    });
    this.characterManager.updateState(responderId, {
      currentAction: "in_conversation",
      currentActionTarget: initiatorId,
      actionStartTick: absNow,
      actionEndTick: 0,
    });
    return session;
  }

  private interruptCharacterForDialogue(charId: string): void {
    const state = this.characterManager.getState(charId);
    if (!state.currentAction || state.currentAction === "in_conversation") {
      return;
    }

    const targetId = state.currentActionTarget;
    if (targetId && !targetId.startsWith(WORLD_ACTION_TARGET_PREFIX)) {
      this.worldManager.characterStopUsingObject(targetId, charId);
    }

    this.characterManager.updateState(charId, {
      currentAction: null,
      currentActionTarget: null,
      actionStartTick: 0,
      actionEndTick: 0,
    });
  }

  private async runDialogueSession(
    session: DialogueSession,
    gameTime: GameTime,
    absNow: number,
  ): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];
    let workingSession = { ...session, turnsThisTick: 0 };
    try {
      if (!this.isSessionContinuable(workingSession)) {
        workingSession.endReason =
          workingSession.endReason ?? "双方已不再处于可继续对话状态";
        const finalDialogue = await this.dialogueGenerator.finalizeDialogueSession({
          session: workingSession,
          gameTime,
        });
        events.push(
          this.dialogueCompleteToEvent(workingSession, finalDialogue, gameTime),
        );
        this.finishDialogueSession(workingSession, absNow);
        return events;
      }

      while (workingSession.turnsThisTick < MAX_DIALOGUE_TURNS_PER_TICK) {
        const generated = await this.dialogueGenerator.generateNextTurn({
          session: workingSession,
          gameTime,
        });
        const turnIndexStart = workingSession.transcript.length;

        workingSession.transcript = [...workingSession.transcript, generated.turn];
        workingSession.turnsThisTick += 1;
        workingSession.totalTurns += 1;
        workingSession.lastUpdatedAt = gameTime;
        workingSession.tags = Array.from(
          new Set([...workingSession.tags, ...generated.tags]),
        );

        events.push(
          this.dialogueTurnToEvent(
            workingSession,
            generated.turn,
            turnIndexStart,
            gameTime,
          ),
        );

        if (!generated.shouldContinue) {
          workingSession.endReason = generated.endReason ?? "自然结束";
          const finalDialogue = await this.dialogueGenerator.finalizeDialogueSession({
            session: workingSession,
            gameTime,
          });
          events.push(
            this.dialogueCompleteToEvent(workingSession, finalDialogue, gameTime),
          );
          this.finishDialogueSession(workingSession, absNow);
          return events;
        }

        const [charA, charB] = workingSession.participants;
        workingSession.nextSpeaker =
          generated.suggestedNextSpeaker &&
          workingSession.participants.includes(generated.suggestedNextSpeaker)
            ? generated.suggestedNextSpeaker
            : generated.turn.speaker === charA
              ? charB
              : charA;
      }

      this.worldManager.saveDialogueSession(workingSession);
      return events;
    } catch (error) {
      console.warn(
        `[SimEngine] Aborting broken dialogue session ${workingSession.id}:`,
        error,
      );
      this.cleanupBrokenDialogueSession(workingSession);
      return events;
    }
  }

  private cleanupBrokenDialogueSession(session: DialogueSession): void {
    this.worldManager.deleteDialogueSession(session.id);
    for (const charId of session.participants) {
      try {
        const state = this.characterManager.getState(charId);
        if (state.currentAction !== "in_conversation") continue;
        this.characterManager.updateState(charId, {
          currentAction: null,
          currentActionTarget: null,
          actionStartTick: 0,
          actionEndTick: 0,
        });
      } catch {
        // Best-effort cleanup only. If state is already missing, dropping the
        // stale dialogue session prevents repeated runtime failures.
      }
    }
  }

  private finishDialogueSession(session: DialogueSession, absNow: number): void {
    this.worldManager.deleteDialogueSession(session.id);
    const idleDuration = 1 + Math.floor(Math.random() * 2);

    for (const charId of session.participants) {
      this.characterManager.updateState(charId, {
        currentAction: "post_dialogue",
        currentActionTarget: null,
        actionStartTick: absNow,
        actionEndTick: absNow + idleDuration,
      });
    }
  }

  private async closeAllActiveDialogues(
    gameTime: GameTime,
    absNow: number,
  ): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];
    const sessions = this.reconcileDialogueSessions();

    const results = await Promise.allSettled(
      sessions.map(async (session) => {
        session.endReason = "一天结束，对话终止";
        const finalDialogue = await this.dialogueGenerator.finalizeDialogueSession({
          session,
          gameTime,
        });
        return { session, finalDialogue };
      })
    );

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const result = results[i];
      if (result.status === "fulfilled") {
        const { finalDialogue } = result.value;
        events.push(this.dialogueCompleteToEvent(session, finalDialogue, gameTime));
      } else {
        console.error(`[SimEngine] Error closing dialogue ${session.id} at day end:`, result.reason);
      }
      this.finishDialogueSession(session, absNow);
    }

    return events;
  }

  private dialogueTurnToEvent(
    session: DialogueSession,
    turn: DialogueTurn,
    turnIndexStart: number,
    gameTime: GameTime,
  ): SimulationEvent {
    const targetId = session.participants.find((id) => id !== turn.speaker);
    const data: DialogueEventData = {
      conversationId: session.id,
      phase: "turn",
      turns: [turn],
      turnIndexStart,
      isFinal: false,
      participants: [...session.participants],
    };

    return {
      id: generateId(),
      gameDay: gameTime.day,
      gameTick: gameTime.tick,
      type: "dialogue",
      actorId: turn.speaker,
      targetId,
      location: session.location,
      data,
      innerMonologue: turn.innerMonologue,
      tags: [...session.tags],
    };
  }

  private dialogueCompleteToEvent(
    session: DialogueSession,
    dialogue: DialogueResult,
    gameTime: GameTime,
  ): SimulationEvent {
    const data: DialogueEventData = {
      conversationId: session.id,
      phase: "complete",
      turns: dialogue.turns,
      turnIndexStart: 0,
      isFinal: true,
      participants: dialogue.participants,
      memoriesGenerated: dialogue.memoriesGenerated,
      endReason: dialogue.endReason,
    };

    return {
      id: generateId(),
      gameDay: gameTime.day,
      gameTick: gameTime.tick,
      type: "dialogue",
      actorId: dialogue.participants[0],
      targetId: dialogue.participants[1],
      location: session.location,
      data,
      tags: dialogue.tags,
    };
  }

  private async evaluateRecentMemories(gameTime: GameTime): Promise<void> {
    const allProfiles = this.characterManager.getAllProfiles();
    const pendingMemories: { id: string; content: string }[] = [];

    for (const profile of allProfiles) {
      const memories = this.characterManager.memoryManager.getMemoriesByDay(
        profile.id,
        gameTime.day,
      );
      for (const m of memories) {
        if (m.gameTick === gameTime.tick && m.importance === 5 && m.type !== "reflection") {
          pendingMemories.push({ id: m.id, content: m.content });
        }
      }
    }

    if (pendingMemories.length === 0) return;

    try {
      const messages = this.promptBuilder.buildMemoryEvalMessages({
        memories: pendingMemories,
      });
      const result = await this.llmClient.call({
        messages,
        schema: MemoryEvalSchema,
        options: { taskType: "memory_eval" },
      });

      for (const evaluation of result.data.evaluations) {
        try {
          memoryStore.updateMemory(evaluation.memoryId, {
            importance: evaluation.importance,
            emotionalValence: evaluation.emotionalValence,
            emotionalIntensity: evaluation.emotionalIntensity,
            tags: evaluation.tags,
          });
        } catch {
          // memory may not exist
        }
      }

      this.characterManager.memoryManager.clearCache();
    } catch (err) {
      console.error("[SimEngine] Memory evaluation error:", err);
    }
  }

  private scheduleRecentMemoryEvaluation(gameTime: GameTime): void {
    const queuedTime = { ...gameTime };

    this.memoryEvalQueue = this.memoryEvalQueue
      .catch(() => undefined)
      .then(async () => {
        await this.evaluateRecentMemories(queuedTime);
      })
      .catch((err) => {
        console.error("[SimEngine] Background memory evaluation error:", err);
      });
  }

  private async runReflection(
    gameTime: GameTime,
  ): Promise<SimulationEvent[]> {
    const events: SimulationEvent[] = [];
    const profiles = this.characterManager.getAllProfiles();

    const results = await Promise.allSettled(
      profiles.map(async (profile) => {
        const todayMemories =
          this.characterManager.memoryManager.getMemoriesByDay(
            profile.id,
            gameTime.day,
          );

        if (todayMemories.length < 3) return null;

        const recentMemoriesText = todayMemories
          .map((m) => `- [${m.id}] ${m.content}`)
          .join("\n");

        const messages = this.promptBuilder.buildReflectionMessages({
          profile,
          gameDay: gameTime.day,
          recentMemories: recentMemoriesText,
        });

        const result = await this.llmClient.call({
          messages,
          schema: ReflectionSchema,
          options: { taskType: "reflection", characterId: profile.id },
        });

        for (const insight of result.data.insights) {
          this.characterManager.memoryManager.addMemory({
            characterId: profile.id,
            type: "reflection",
            content: insight.content,
            gameTime,
            importance: insight.importance,
            emotionalValence: 0,
            emotionalIntensity: 0,
            tags: insight.tags,
          });

          for (const refId of insight.relatedMemoryIds) {
            try {
              const refMem = memoryStore.getMemory(refId);
              memoryStore.updateMemory(refId, {
                decayFactor: refMem.decayFactor * 0.3,
              });
            } catch {
              // referenced memory may not exist
            }
          }
        }

        const state = this.characterManager.getState(profile.id);
        const shift = result.data.emotionShift;
        this.characterManager.updateState(profile.id, {
          emotionValence: Math.max(
            -5,
            Math.min(5, state.emotionValence + shift.valence),
          ),
          emotionArousal: Math.max(
            0,
            Math.min(10, state.emotionArousal + shift.arousal),
          ),
        });

        if (result.data.currentFocus) {
          this.worldManager.setGlobal(
            `current_focus:${profile.id}`,
            result.data.currentFocus,
          );
        }

        return {
          id: generateId(),
          gameDay: gameTime.day,
          gameTick: gameTime.tick,
          type: "reflection" as const,
          actorId: profile.id,
          location: state.location,
          data: {
            insights: result.data.insights.map((i) => i.content),
            emotionShift: result.data.emotionShift,
          },
          tags: ["reflection", "end_of_day"],
        };
      })
    );

    for (let i = 0; i < profiles.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        if (result.value) {
          events.push(result.value);
        }
      } else {
        console.error(`[SimEngine] Reflection error for ${profiles[i].id}:`, result.reason);
      }
    }

    return events;
  }

  private maybeGenerateObservationMemory(
    charId: string,
    perception: Perception,
    gameTime: GameTime,
    events: SimulationEvent[],
  ): void {
    const OBSERVATION_CHANCE = 0.2;
    for (const c of perception.charactersHere) {
      if (!c.emotionLabel) continue;
      if (Math.random() >= OBSERVATION_CHANCE) continue;

      const content = `在${perception.currentLocation}看到${c.name}${c.currentAction ? "正在" + c.currentAction : ""}，看起来${c.emotionLabel}`;
      this.characterManager.memoryManager.addMemory({
        characterId: charId,
        type: "observation",
        content,
        gameTime,
        importance: 4,
        emotionalValence: 0,
        emotionalIntensity: 2,
        relatedCharacters: [c.id],
        relatedLocation: this.characterManager.getState(charId).location,
        tags: ["observation", "emotion_noticed"],
      });

      events.push({
        id: generateId(),
        gameDay: gameTime.day,
        gameTick: gameTime.tick,
        type: "memory_formed",
        actorId: charId,
        targetId: c.id,
        location: this.characterManager.getState(charId).location,
        data: { memoryType: "observation", content },
        tags: ["observation"],
      });
    }
  }

  private runEndOfDayDecay(gameTime: GameTime): void {
    for (const profile of this.characterManager.getAllProfiles()) {
      try {
        this.characterManager.memoryManager.processMemoryDecay(
          profile.id,
          gameTime.day,
        );
        this.characterManager.memoryManager.processMemoryConsolidation(
          profile.id,
        );
      } catch (err) {
        console.error(
          `[SimEngine] Memory decay error for ${profile.id}:`,
          err,
        );
      }
    }
  }
}
