import type { CharacterManager } from "../core/character-manager.js";
import type { WorldManager } from "../core/world-manager.js";
import { fetchLocationNews, type NewsItem } from "./news-fetcher.js";
import * as memoryStore from "../store/memory-store.js";

/** Fetch latest news and inject as hearsay memories into all NPCs. Non-blocking. */
export function injectNewsIntoNpcs(
  worldDir: string,
  characterManager: CharacterManager,
  worldManager: WorldManager,
): void {
  const worldName = worldManager.getWorldName();
  const gameTime = worldManager.getCurrentTime();

  fetchLocationNews(worldName, worldDir)
    .then((items) => {
      if (items.length === 0) return;
      injectItems(items, worldName, characterManager, gameTime);
    })
    .catch((e) => console.warn("[WorldNewsInjector] error:", e));
}

function injectItems(
  items: NewsItem[],
  worldName: string,
  characterManager: CharacterManager,
  gameTime: { day: number; tick: number },
): void {
  const profiles = characterManager.getAllProfiles();
  // Skip player character — only NPCs gossip about news
  const npcs = profiles.filter((p) => p.id !== "char_player");

  for (const item of items) {
    const content = `听说${worldName}最近有个新闻：${item.title}`;

    // Each NPC gets the news, but deduplicate by content so restarts don't spam
    for (const profile of npcs) {
      if (memoryStore.hasMemory(profile.id, "hearsay", content, gameTime.day, gameTime.tick)) {
        continue;
      }
      characterManager.memoryManager.addMemory({
        characterId: profile.id,
        type: "hearsay",
        content,
        gameTime,
        importance: 4,
        emotionalValence: 0.1,
        emotionalIntensity: 0.2,
        relatedCharacters: [],
        relatedLocation: "main_area",
        relatedObjects: [],
        tags: ["新闻", "时事", worldName],
      });
    }
  }

  console.log(`[WorldNewsInjector] Injected ${items.length} news items into ${npcs.length} NPCs.`);
}

/** Return cached news items for the API endpoint. */
export async function getWorldNews(worldDir: string, worldName: string): Promise<NewsItem[]> {
  return fetchLocationNews(worldName, worldDir);
}
