export const TILE_SIZE = 32;

export const SPRITE_FRAME_WIDTH = 170;
export const SPRITE_FRAME_HEIGHT = 204;
export const SPRITE_COLUMNS = 6;
export const SPRITE_ROWS = 5;
export const SPRITE_WALK_FRAME_RATE = 8;

const CHARACTER_HEIGHT_SUM_RATIO = 0.04;

export interface CharacterDisplayMetrics {
  spriteWidth: number;
  spriteHeight: number;
  hitWidth: number;
  hitHeight: number;
  hitTopY: number;
  circleRadius: number;
  circleStrokeWidth: number;
  circleHighlightRadius: number;
  circleHighlightOffsetX: number;
  circleHighlightOffsetY: number;
  shadowWidth: number;
  shadowHeight: number;
  shadowOffsetY: number;
  bubbleOffsetY: number;
  bubbleFontSize: number;
  bubbleWrapWidth: number;
  bubblePadding: number;
  bubbleTailHeight: number;
  bubbleCornerRadius: number;
  labelNameWorldSize: number;
  labelMbtiWorldSize: number;
  labelIconWorldSize: number;
  labelGapWorld: number;
  labelMbtiPadXWorld: number;
  labelMbtiPadYWorld: number;
  sortFootYOffset: number;
}

export function createCharacterDisplayMetrics(
  mapWidth: number,
  mapHeight: number,
): CharacterDisplayMetrics {
  const spriteHeight = (mapWidth + mapHeight) * CHARACTER_HEIGHT_SUM_RATIO;
  const spriteWidth = spriteHeight * (SPRITE_FRAME_WIDTH / SPRITE_FRAME_HEIGHT);

  return {
    spriteWidth,
    spriteHeight,
    hitWidth: spriteWidth * 0.75,
    hitHeight: spriteHeight * 0.95,
    hitTopY: -spriteHeight * 0.8,
    circleRadius: spriteWidth * 0.45,
    circleStrokeWidth: Math.max(1.5, spriteWidth * 0.075),
    circleHighlightRadius: spriteWidth * 0.2,
    circleHighlightOffsetX: -spriteWidth * 0.125,
    circleHighlightOffsetY: -spriteWidth * 0.125,
    shadowWidth: spriteWidth * 0.3,
    shadowHeight: Math.max(2, spriteWidth * 0.125),
    shadowOffsetY: Math.max(2, spriteWidth * 0.1),
    bubbleOffsetY: -spriteHeight * 1.12,
    bubbleFontSize: Math.max(16, spriteHeight * 0.17),
    bubbleWrapWidth: Math.max(spriteWidth * 1.65, spriteHeight * 2.1),
    bubblePadding: Math.max(8, spriteHeight * 0.06),
    bubbleTailHeight: Math.max(4, spriteHeight * 0.035),
    bubbleCornerRadius: Math.max(6, spriteHeight * 0.045),
    labelNameWorldSize: spriteWidth * 0.20,
    labelMbtiWorldSize: spriteWidth * 0.20,
    labelIconWorldSize: spriteWidth * 0.21,
    labelGapWorld: spriteWidth * 0.07,
    labelMbtiPadXWorld: spriteWidth * 0.14,
    labelMbtiPadYWorld: spriteWidth * 0.045,
    sortFootYOffset: spriteHeight * 0.16,
  };
}

export const CHARACTER_COLORS = [
  0x6c5ce7, 0x74b9ff, 0xd63031, 0xe17055,
  0x00b894, 0xfd79a8, 0xfdcb6e, 0xe84393,
];

export const ACTION_EMOJI: Record<string, string> = {
  cook: "🍳", eat: "🍽️", read: "📖",
  read_bulletin: "📰", write_diary: "📝", talk: "💬", talking: "💬", in_conversation: "💬", idle: "💭",
  fish: "🎣", explore: "🔍", repair: "🔧",
  think_in_bed: "💭", post_dialogue: "🙂", traveling: "🚶",
  people_watch: "👀", use_computer: "💻", have_drink: "☕", craft: "🔨", stroll: "🚶", tend_garden: "🌱", post_message: "📌",
  garden: "🌱", water_plants: "💧", plant_seeds: "🌱", harvest_crops: "🥕",
  buy_goods: "🛒", stock_shelves: "📦", clean_shop: "🧹",
  rest: "🛋️", sleep: "😴", relax: "🌿", sit: "🪑",
  pray: "🙏", perform: "🎭", play_music: "🎵",
  train: "💪", work: "🧰", study: "📚", observe: "👀",
};

export function actionToEmoji(action: string | null): string {
  if (!action) return "";
  return ACTION_EMOJI[action] || "";
}

export function getCharacterColor(index: number): number {
  return CHARACTER_COLORS[index % CHARACTER_COLORS.length];
}
