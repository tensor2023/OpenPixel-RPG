import { computeWalkableGrid, cleanupGrid } from "../utils/image-utils.mjs";
import { getTileSize } from "../utils/generation-config.mjs";

/**
 * Compute the walkable grid from the optimized model-input map and the marked image.
 * @param {Buffer} originalBuffer - same-resolution optimized map used for model input
 * @param {Buffer} markedBuffer   - map with walkable areas marked red
 * @param {number} origWidth      - original generated image width (for scale calculation)
 * @returns {{ grid: number[][], gridWidth: number, gridHeight: number, tileSize: number }}
 */
export async function computeGrid(originalBuffer, markedBuffer, origWidth) {
  const BLOCK_SIZE = getTileSize();
  console.log(`[Step 5] Target tile size at source resolution: ${BLOCK_SIZE}px`);

  const { grid: rawGrid, gridWidth, gridHeight, actualBlockSize } = await computeWalkableGrid(
    originalBuffer,
    markedBuffer,
    BLOCK_SIZE,
    origWidth,
  );

  const walkableBefore = rawGrid.flat().filter((v) => v === 0).length;
  console.log(`[Step 5] Raw grid: ${gridWidth}x${gridHeight}, walkable cells: ${walkableBefore}`);

  const grid = cleanupGrid(rawGrid);
  const walkableAfter = grid.flat().filter((v) => v === 0).length;
  console.log(`[Step 5] After cleanup: walkable cells: ${walkableAfter} (delta ${walkableAfter - walkableBefore})`);

  return { grid, gridWidth, gridHeight, tileSize: BLOCK_SIZE };
}
