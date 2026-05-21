import type { LLMClient } from "../llm/llm-client.js";
import type { PromptBuilder } from "../llm/prompt-builder.js";
import {
  DialogueFinalizeSchema,
  DialogueTurnSchema,
} from "../llm/output-schemas.js";
import type { CharacterManager } from "../core/character-manager.js";
import type { WorldManager } from "../core/world-manager.js";
import type {
  DialogueResult,
  DialogueSession,
  DialogueTurnGeneration,
  GameTime,
} from "../types/index.js";
import { relativeTimeLabel } from "../utils/time-helpers.js";

export class DialogueGenerator {
  constructor(
    private llmClient: LLMClient,
    private promptBuilder: PromptBuilder,
    private characterManager: CharacterManager,
    private worldManager: WorldManager,
  ) {}

  async generateNextTurn(params: {
    session: DialogueSession;
    gameTime: GameTime;
  }): Promise<DialogueTurnGeneration> {
    const { session, gameTime } = params;
    const context = this.buildDialogueContext(session, gameTime);

    try {
      const messages = this.promptBuilder.buildDialogueTurnMessages({
        participants: context.participants,
        location: context.locationName,
        initiatorId: session.initiatorId,
        initiatorMotivation: session.motivation,
        gameTime,
        transcript: session.transcript,
        nextSpeaker: session.nextSpeaker,
        totalTurns: session.totalTurns,
        hearsayA: context.hearsayA,
        hearsayB: context.hearsayB,
        worldSocialContext: this.worldManager.getWorldSocialContext(),
        knownCharacters: this.formatKnownCharacters(),
        knownLocations: this.formatKnownLocations(),
      });

      const result = await this.llmClient.call({
        messages,
        schema: DialogueTurnSchema,
        options: { taskType: "dialogue_turn", characterId: session.nextSpeaker },
      });

      const llmOutput = result.data;
      const normalizedSpeaker = this.normalizeSpeaker(
        llmOutput.speaker,
        context.profileA,
        context.profileB,
        session.nextSpeaker,
      );
      const fallbackNextSpeaker =
        normalizedSpeaker === context.profileA.id
          ? context.profileB.id
          : context.profileA.id;

      const innerMonologue =
        typeof llmOutput.innerMonologue === "string" && llmOutput.innerMonologue.trim().length > 0
          ? llmOutput.innerMonologue.trim()
          : undefined;

      return {
        turn: {
          speaker: normalizedSpeaker,
          content: llmOutput.content,
          ...(innerMonologue ? { innerMonologue } : {}),
        },
        shouldContinue: llmOutput.shouldContinue,
        suggestedNextSpeaker: this.normalizeSpeaker(
          llmOutput.suggestedNextSpeaker,
          context.profileA,
          context.profileB,
          fallbackNextSpeaker,
        ),
        endReason: llmOutput.endReason,
        tags: llmOutput.tags || [],
      };
    } catch {
      const fallbackSpeaker = session.nextSpeaker;
      return {
        turn: {
          speaker: fallbackSpeaker,
          content: "嗯，先聊到这里吧。",
        },
        shouldContinue: false,
        suggestedNextSpeaker: undefined,
        endReason: "模型调用失败，提前结束对话",
        tags: ["fallback"],
      };
    }
  }

  async finalizeDialogueSession(params: {
    session: DialogueSession;
    gameTime: GameTime;
  }): Promise<DialogueResult> {
    const { session, gameTime } = params;
    const context = this.buildDialogueContext(session, gameTime);

    try {
      const messages = this.promptBuilder.buildDialogueFinalizeMessages({
        participants: context.participants,
        location: context.locationName,
        initiatorId: session.initiatorId,
        initiatorMotivation: session.motivation,
        gameTime,
        transcript: session.transcript,
        endReason: session.endReason,
        worldSocialContext: this.worldManager.getWorldSocialContext(),
      });

      const result = await this.llmClient.call({
        messages,
        schema: DialogueFinalizeSchema,
        options: {
          taskType: "dialogue_finalize",
          characterId: session.initiatorId,
        },
      });

      return await this.applyFinalization({
        session,
        gameTime,
        locationName: context.locationName,
        profileA: context.profileA,
        profileB: context.profileB,
        stateA: context.stateA,
        llmOutput: result.data,
      });
    } catch {
      return await this.applyFinalization({
        session,
        gameTime,
        locationName: context.locationName,
        profileA: context.profileA,
        profileB: context.profileB,
        stateA: context.stateA,
        llmOutput: {
          memoriesGenerated: {},
          tags: ["fallback"],
          endReason: session.endReason ?? "模型收尾失败，已强制结束",
        },
      });
    }
  }

  private buildDialogueContext(
    session: DialogueSession,
    gameTime: GameTime,
  ) {
    const [initiatorId, responderId] = session.participants;
    const profileA = this.characterManager.getProfile(initiatorId);
    const profileB = this.characterManager.getProfile(responderId);
    const stateA = this.characterManager.getState(initiatorId);
    const stateB = this.characterManager.getState(responderId);

    const memoriesA = this.characterManager.memoryManager.retrieveMemories({
      characterId: initiatorId,
      currentTime: gameTime,
      contextKeywords: [profileB.name, profileB.id],
      relatedCharacterIds: [responderId],
      topK: 5,
    });
    const memoriesB = this.characterManager.memoryManager.retrieveMemories({
      characterId: responderId,
      currentTime: gameTime,
      contextKeywords: [profileA.name, profileA.id],
      relatedCharacterIds: [initiatorId],
      topK: 5,
    });

    const fmtMem = (m: { gameDay: number; gameTick: number; content: string }) =>
      `- [${relativeTimeLabel(m.gameDay, m.gameTick, gameTime)}] ${m.content}`;
    const memoriesAtext =
      memoriesA.length > 0 ? memoriesA.map(fmtMem).join("\n") : "";
    const memoriesBtext =
      memoriesB.length > 0 ? memoriesB.map(fmtMem).join("\n") : "";

    const location = this.worldManager.getLocation(stateA.location);
    const locationName = location?.name ?? stateA.location;

    const hearsayA = this.characterManager.memoryManager
      .getRecentHearsay(initiatorId, gameTime.day)
      .map((m) => `- ${m.content}`)
      .join("\n");
    const hearsayB = this.characterManager.memoryManager
      .getRecentHearsay(responderId, gameTime.day)
      .map((m) => `- ${m.content}`)
      .join("\n");

    return {
      initiatorId,
      responderId,
      profileA,
      profileB,
      stateA,
      stateB,
      locationName,
      hearsayA,
      hearsayB,
      participants: [
        {
          profile: profileA,
          state: stateA,
          memoriesAboutOther: memoriesAtext,
        },
        {
          profile: profileB,
          state: stateB,
          memoriesAboutOther: memoriesBtext,
        },
      ],
    };
  }

  private async applyFinalization(params: {
    session: DialogueSession;
    gameTime: GameTime;
    locationName: string;
    profileA: { id: string; name: string };
    profileB: { id: string; name: string };
    stateA: { location: string };
    llmOutput: {
      memoriesGenerated: Record<string, string>;
      tags: string[];
      endReason?: string;
      hearsayGenerated?: Record<string, string>;
    };
  }): Promise<DialogueResult> {
    const { session, gameTime, locationName, profileA, profileB, stateA, llmOutput } =
      params;
    const [initiatorId, responderId] = session.participants;

    const memA =
      llmOutput.memoriesGenerated?.[initiatorId] ??
      llmOutput.memoriesGenerated?.[profileA.name] ??
      `和${profileB.name}聊了几句`;
    const memB =
      llmOutput.memoriesGenerated?.[responderId] ??
      llmOutput.memoriesGenerated?.[profileB.name] ??
      `和${profileA.name}聊了几句`;
    const tags = Array.from(
      new Set(["dialogue", ...session.tags, ...(llmOutput.tags || [])]),
    );

    this.characterManager.memoryManager.addMemory({
      characterId: initiatorId,
      type: "conversation",
      content: memA,
      gameTime,
      importance: 5,
      emotionalValence: 1,
      emotionalIntensity: 3,
      relatedCharacters: [responderId],
      relatedLocation: stateA.location,
      tags,
    });

    this.characterManager.memoryManager.addMemory({
      characterId: responderId,
      type: "conversation",
      content: memB,
      gameTime,
      importance: 5,
      emotionalValence: 1,
      emotionalIntensity: 3,
      relatedCharacters: [initiatorId],
      relatedLocation: stateA.location,
      tags,
    });

    if (llmOutput.hearsayGenerated) {
      for (const [charId, hearsayContent] of Object.entries(llmOutput.hearsayGenerated)) {
        const resolvedId =
          charId === profileA.id || charId === profileA.name
            ? initiatorId
            : charId === profileB.id || charId === profileB.name
              ? responderId
              : charId;
        const sourceId = resolvedId === initiatorId ? responderId : initiatorId;
        this.characterManager.memoryManager.addMemory({
          characterId: resolvedId,
          type: "hearsay",
          content: hearsayContent,
          gameTime,
          importance: 5,
          emotionalValence: 0,
          emotionalIntensity: 2,
          relatedCharacters: [sourceId],
          relatedLocation: stateA.location,
          tags: [...tags, "hearsay"],
        });
      }
    }

    return {
      participants: [initiatorId, responderId],
      location: locationName,
      turns: session.transcript,
      memoriesGenerated: { [initiatorId]: memA, [responderId]: memB },
      tags,
      endReason: llmOutput.endReason ?? session.endReason,
    };
  }

  private normalizeSpeaker(
    rawSpeaker: string | undefined,
    profileA: { id: string; name: string },
    profileB: { id: string; name: string },
    fallback: string,
  ): string {
    if (!rawSpeaker) return fallback;
    const normalized = rawSpeaker.trim();
    const nameToId: Record<string, string> = {
      [profileA.name]: profileA.id,
      [profileB.name]: profileB.id,
      [profileA.id]: profileA.id,
      [profileB.id]: profileB.id,
    };
    return nameToId[normalized] ?? fallback;
  }

  private formatKnownCharacters(): string {
    return this.characterManager
      .getAllProfiles()
      .map((p) => {
        const nickname =
          p.nickname && p.nickname !== p.name ? `，又称${p.nickname}` : "";
        return `- ${p.name}（${p.id} / ${p.role}${nickname}）`;
      })
      .join("\n");
  }

  private formatKnownLocations(): string {
    return this.worldManager
      .getAllLocations()
      .map((loc) => `- ${loc.name}（${loc.id}）`)
      .join("\n");
  }
}
