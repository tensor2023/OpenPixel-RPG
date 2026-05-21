import sharp from "sharp";
import { getImageSize } from "./image-utils.mjs";

export const MAX_BATCH_SIZE = 4;

export const COLOR_SPECS = [
  { key: "cyan", label: "亮青色", rgb: [0, 255, 255], rgba: "rgba(0,255,255,0.62)" },
  { key: "magenta", label: "亮品红", rgb: [255, 0, 255], rgba: "rgba(255,0,255,0.62)" },
  { key: "yellow", label: "亮黄色", rgb: [255, 255, 0], rgba: "rgba(255,255,0,0.62)" },
  { key: "blue", label: "电蓝色", rgb: [0, 128, 255], rgba: "rgba(0,128,255,0.62)" },
];

export function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Compare original and color-marked images to extract bounding boxes for each color assignment.
 * @param {Buffer} originalBuffer
 * @param {Buffer} markedBuffer
 * @param {Array<{ region: { id: string, name: string, type?: string }, color: { rgb: number[] } }>} colorAssignments
 * @returns {Promise<Array<{ id: string, name: string, type?: string, topLeft: {x:number,y:number}, bottomRight: {x:number,y:number} }>>}
 */
export async function extractRegionBoxesFromMarkedImage(originalBuffer, markedBuffer, colorAssignments) {
  const { width: originalWidth, height: originalHeight } = await getImageSize(originalBuffer);
  const { width, height } = await getImageSize(markedBuffer);
  const blockSize = width <= 1500 ? 4 : width <= 3000 ? 6 : 8;
  const gridWidth = Math.floor(width / blockSize);
  const gridHeight = Math.floor(height / blockSize);
  const scaleX = originalWidth / width;
  const scaleY = originalHeight / height;

  const originalRaw = await sharp(originalBuffer)
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const markedRaw = await sharp(markedBuffer)
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer();
  const channels = Math.round(originalRaw.length / (width * height));
  const labelGrid = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(-1),
  );

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const avgOriginal = [0, 0, 0];
      const avgMarked = [0, 0, 0];
      let count = 0;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = gx * blockSize + dx;
          const py = gy * blockSize + dy;
          const idx = (py * width + px) * channels;
          avgOriginal[0] += originalRaw[idx];
          avgOriginal[1] += originalRaw[idx + 1];
          avgOriginal[2] += originalRaw[idx + 2];
          avgMarked[0] += markedRaw[idx];
          avgMarked[1] += markedRaw[idx + 1];
          avgMarked[2] += markedRaw[idx + 2];
          count++;
        }
      }

      for (let i = 0; i < 3; i++) {
        avgOriginal[i] /= count;
        avgMarked[i] /= count;
      }

      const diff = [
        avgMarked[0] - avgOriginal[0],
        avgMarked[1] - avgOriginal[1],
        avgMarked[2] - avgOriginal[2],
      ];
      const diffMagnitude = magnitude(diff);
      if (diffMagnitude < 12) continue;

      let bestIndex = -1;
      let bestScore = 0;
      for (let index = 0; index < colorAssignments.length; index++) {
        const target = colorAssignments[index].color.rgb;
        const score = scoreColorOverlay(avgOriginal, avgMarked, diff, target);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }

      if (bestIndex !== -1 && bestScore >= 12) {
        labelGrid[gy][gx] = bestIndex;
      }
    }
  }

  return colorAssignments
    .map(({ region }, index) => {
      const bbox = extractBoundingBoxFromLabelGrid(labelGrid, index, blockSize, width, height);
      if (!bbox) return null;
      return {
        id: region.id,
        name: region.name,
        type: region.type,
        topLeft: {
          x: Math.max(0, Math.min(originalWidth, Math.round(bbox.topLeft.x * scaleX))),
          y: Math.max(0, Math.min(originalHeight, Math.round(bbox.topLeft.y * scaleY))),
        },
        bottomRight: {
          x: Math.max(0, Math.min(originalWidth, Math.round(bbox.bottomRight.x * scaleX))),
          y: Math.max(0, Math.min(originalHeight, Math.round(bbox.bottomRight.y * scaleY))),
        },
      };
    })
    .filter(Boolean);
}

export function scoreColorOverlay(avgOriginal, avgMarked, diff, target) {
  const towardTarget = [
    target[0] - avgOriginal[0],
    target[1] - avgOriginal[1],
    target[2] - avgOriginal[2],
  ];
  const towardMagnitudeSquared = dot(towardTarget, towardTarget);
  if (towardMagnitudeSquared <= 1) return 0;

  const alpha = dot(diff, towardTarget) / towardMagnitudeSquared;
  if (alpha < 0.08 || alpha > 1.2) return 0;

  const reconstructed = [
    towardTarget[0] * alpha,
    towardTarget[1] * alpha,
    towardTarget[2] * alpha,
  ];
  const reconstructionError = magnitude([
    diff[0] - reconstructed[0],
    diff[1] - reconstructed[1],
    diff[2] - reconstructed[2],
  ]);
  if (reconstructionError > 26) return 0;

  const originalDistance = colorDistance(avgOriginal, target);
  const markedDistance = colorDistance(avgMarked, target);
  const closenessGain = originalDistance - markedDistance;
  if (closenessGain < 5 && alpha < 0.2) return 0;

  return alpha * 90 + closenessGain * 0.25 - reconstructionError * 0.6;
}

export function extractBoundingBoxFromLabelGrid(labelGrid, labelIndex, blockSize, width, height) {
  const gridHeight = labelGrid.length;
  const gridWidth = labelGrid[0]?.length || 0;
  const visited = Array.from({ length: gridHeight }, () =>
    Array(gridWidth).fill(false),
  );
  const components = [];

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (visited[y][x] || labelGrid[y][x] !== labelIndex) continue;
      const component = floodFill(labelGrid, visited, x, y, labelIndex);
      if (component.area >= 4) {
        components.push(component);
      }
    }
  }

  if (components.length === 0) return null;

  const largestArea = Math.max(...components.map((c) => c.area));
  const selected = components.filter(
    (c) => c.area >= Math.max(4, largestArea * 0.15),
  );

  const union = selected.reduce(
    (acc, c) => ({
      minX: Math.min(acc.minX, c.minX),
      minY: Math.min(acc.minY, c.minY),
      maxX: Math.max(acc.maxX, c.maxX),
      maxY: Math.max(acc.maxY, c.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  if (!Number.isFinite(union.minX)) return null;

  let { minX, minY, maxX, maxY } = union;

  const TRIM_THRESHOLD = 0.35;
  const rowCoverage = (y) => {
    let count = 0;
    for (let x = minX; x <= maxX; x++) {
      if (labelGrid[y][x] === labelIndex) count++;
    }
    return count / Math.max(1, maxX - minX + 1);
  };
  const colCoverage = (x) => {
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      if (labelGrid[y][x] === labelIndex) count++;
    }
    return count / Math.max(1, maxY - minY + 1);
  };

  while (minY <= maxY && rowCoverage(minY) < TRIM_THRESHOLD) minY++;
  while (maxY >= minY && rowCoverage(maxY) < TRIM_THRESHOLD) maxY--;
  while (minX <= maxX && colCoverage(minX) < TRIM_THRESHOLD) minX++;
  while (maxX >= minX && colCoverage(maxX) < TRIM_THRESHOLD) maxX--;

  if (minX > maxX || minY > maxY) return null;

  const rawX1 = minX * blockSize;
  const rawY1 = minY * blockSize;
  const rawX2 = (maxX + 1) * blockSize;
  const rawY2 = (maxY + 1) * blockSize;

  const INSET_RATIO = 0.03;
  const centerX = (rawX1 + rawX2) / 2;
  const centerY = (rawY1 + rawY2) / 2;
  const halfW = ((rawX2 - rawX1) / 2) * (1 - INSET_RATIO);
  const halfH = ((rawY2 - rawY1) / 2) * (1 - INSET_RATIO);

  return {
    topLeft: {
      x: Math.max(0, Math.round(centerX - halfW)),
      y: Math.max(0, Math.round(centerY - halfH)),
    },
    bottomRight: {
      x: Math.min(width, Math.round(centerX + halfW)),
      y: Math.min(height, Math.round(centerY + halfH)),
    },
  };
}

export function floodFill(labelGrid, visited, startX, startY, labelIndex) {
  const stack = [[startX, startY]];
  visited[startY][startX] = true;
  let area = 0;
  let minX = startX;
  let minY = startY;
  let maxX = startX;
  let maxY = startY;

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    area++;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);

    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (
        ny < 0 || ny >= labelGrid.length ||
        nx < 0 || nx >= labelGrid[0].length ||
        visited[ny][nx] || labelGrid[ny][nx] !== labelIndex
      ) continue;
      visited[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  return { area, minX, minY, maxX, maxY };
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function magnitude(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
