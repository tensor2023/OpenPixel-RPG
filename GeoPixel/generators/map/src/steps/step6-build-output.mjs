import { buildTMJ } from "../utils/tmj-builder.mjs";

/**
 * Build the final TMJ output.
 * Regions and elements come from Step 3 (already with coordinates scaled to world space).
 */
export function buildOutput({ grid, gridWidth, gridHeight, tileSize, regions, elements, backgroundImage }) {
  console.log("[Step 6] Building TMJ output...");

  const tmj = buildTMJ({
    gridWidth,
    gridHeight,
    tileSize,
    collisionGrid: grid,
    regions,
    interactiveObjects: elements,
    backgroundImage,
  });

  console.log(`[Step 6] TMJ built: ${gridWidth}x${gridHeight} tiles, ${regions.length} regions, ${elements.length} objects`);
  return tmj;
}
