/**
 * Build sprite sheet metadata (frame dimensions + animation definitions)
 * for use by the Phaser.js viewer.
 */

import sharp from "sharp";

const COLUMNS = 6;
const ROWS = 5;
const WALK_FRAME_RATE = 8;

/**
 * Generate metadata JSON for a processed sprite sheet.
 * @param {Buffer} spritesheetBuffer - the transparent-background spritesheet
 * @param {{ id: string, name: string, description: string }} charInfo
 * @returns {Promise<object>} metadata object
 */
export async function buildMetadata(spritesheetBuffer, charInfo) {
  const { width, height } = await sharp(spritesheetBuffer).metadata();

  const frameWidth = Math.floor(width / COLUMNS);
  const frameHeight = Math.floor(height / ROWS);

  return {
    id: charInfo.id,
    name: charInfo.name,
    description: charInfo.description,
    createdAt: new Date().toISOString(),
    frameWidth,
    frameHeight,
    columns: COLUMNS,
    rows: ROWS,
    animations: {
      "walk-left": { start: 0, end: 5, frameRate: WALK_FRAME_RATE },
      "walk-down": { start: 6, end: 11, frameRate: WALK_FRAME_RATE },
      "walk-up": { start: 12, end: 17, frameRate: WALK_FRAME_RATE },
      "idle-front": { frame: 18 },
      "idle-back": { frame: 19 },
      "idle-left": { frame: 20 },
    },
  };
}
