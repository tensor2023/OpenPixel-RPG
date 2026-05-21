import type { LLMClient } from "../llm/llm-client.js";
import type { PromptBuilder } from "../llm/prompt-builder.js";
import { ActionDecisionSchema } from "../llm/output-schemas.js";
import type { CharacterManager } from "../core/character-manager.js";
import type { WorldManager } from "../core/world-manager.js";
import type {
  ActionDecision,
  GameTime,
  Perception,
} from "../types/index.js";
import { relativeTimeLabel } from "../utils/time-helpers.js";

export class DecisionMaker {
  constructor(
    private llmClient: LLMClient,
    private promptBuilder: PromptBuilder,
    private characterManager: CharacterManager,
    private worldManager: WorldManager,
  ) {}

  async makeDecision(
    charId: string,
    perception: Perception,
    actionMenu: string,
    gameTime: GameTime,
  ): Promise<ActionDecision> {
    const profile = this.characterManager.getProfile(charId);
    const state = this.characterManager.getState(charId);

    const contextKeywords: string[] = [perception.currentLocation];
    for (const c of perception.charactersHere) {
      contextKeywords.push(c.name, c.id);
      if (c.locationId) contextKeywords.push(c.locationId);
      if (c.locationName) contextKeywords.push(c.locationName);
    }

    const memories = this.characterManager.memoryManager.retrieveMemories({
      characterId: charId,
      currentTime: gameTime,
      contextKeywords,
      relatedLocation: state.location,
      topK: 5,
    });

    const relevantMemories =
      memories.length > 0
        ? memories
            .map(
              (m) =>
                `- [${relativeTimeLabel(m.gameDay, m.gameTick, gameTime)}] ${m.content}`,
            )
            .join("\n")
        : "";

    const currentFocus = this.worldManager.getGlobal(`current_focus:${charId}`) ?? undefined;

    const messages = this.promptBuilder.buildReactiveDecisionMessages({
      profile,
      state,
      gameTime,
      perception,
      relevantMemories,
      actionMenu,
      currentFocus,
      worldSocialContext: this.worldManager.getWorldSocialContext(),
    });

    const result = await this.llmClient.call({
      messages,
      schema: ActionDecisionSchema,
      options: { taskType: "reactive_decision", characterId: charId },
    });

    return result.data;
  }
}
