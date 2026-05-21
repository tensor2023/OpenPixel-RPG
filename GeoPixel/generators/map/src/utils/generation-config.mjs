const SUPPORTED_IMAGE_SIZES_K = new Set([1, 2, 4]);
const BASE_TILE_SIZE_4K = 16;

export function getMapImageSizeK() {
  const raw = parseInt(process.env.MAP_IMAGE_SIZE_K || "1", 10);
  if (!SUPPORTED_IMAGE_SIZES_K.has(raw)) {
    throw new Error(
      `Invalid MAP_IMAGE_SIZE_K=${process.env.MAP_IMAGE_SIZE_K}. Supported values: 1, 2, 4`,
    );
  }
  return raw;
}

export function getMapImageSizeLabel() {
  return `${getMapImageSizeK()}K`;
}

/**
 * Tile size (in source-image pixels) that scales with MAP_IMAGE_SIZE_K.
 * 4K -> 16px, 2K -> 8px, 1K -> 4px.
 * Can be overridden via BLOCK_SIZE env var for manual tuning.
 */
export function getTileSize() {
  if (process.env.BLOCK_SIZE) {
    return parseInt(process.env.BLOCK_SIZE, 10);
  }
  return (getMapImageSizeK() / 4) * BASE_TILE_SIZE_4K;
}
