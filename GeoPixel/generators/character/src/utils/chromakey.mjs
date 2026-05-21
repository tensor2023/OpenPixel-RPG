/**
 * Green-screen (chromakey) removal for AI-generated sprite sheets.
 *
 * Strategy: flood-fill from image edges so only the *connected* background
 * region is removed.  Character clothing of a similar color is preserved
 * because it is enclosed by the character outline and unreachable from the
 * edges.
 */

import sharp from "sharp";

const HARD_THRESHOLD = 35;
const SOFT_THRESHOLD = 65;

/**
 * Remove the green background from a sprite sheet image.
 * @param {Buffer} inputBuffer - PNG image with green background
 * @returns {Promise<Buffer>} PNG image with transparent background
 */
export async function removeGreenBackground(inputBuffer) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const pixels = new Uint8Array(data);

  const bgColor = detectBackgroundColor(pixels, width, height, channels);
  console.log(
    `[chromakey] Detected BG color: rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`,
  );

  // Phase 1: flood-fill from edges to find connected background pixels
  const state = new Uint8Array(width * height); // 0=unvisited, 1=bg, 2=soft-edge
  const queue = [];

  const idx = (x, y) => y * width + x;
  const pixelIdx = (x, y) => (y * width + x) * channels;

  const distAt = (x, y) => {
    const pi = pixelIdx(x, y);
    return colorDistance(
      pixels[pi], pixels[pi + 1], pixels[pi + 2],
      bgColor.r, bgColor.g, bgColor.b,
    );
  };

  // Seed all edge pixels that match background
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const d = distAt(x, y);
      if (d < SOFT_THRESHOLD) {
        state[idx(x, y)] = d < HARD_THRESHOLD ? 1 : 2;
        queue.push(x, y);
      }
    }
  }
  for (let y = 1; y < height - 1; y++) {
    for (const x of [0, width - 1]) {
      const d = distAt(x, y);
      if (d < SOFT_THRESHOLD) {
        state[idx(x, y)] = d < HARD_THRESHOLD ? 1 : 2;
        queue.push(x, y);
      }
    }
  }

  // BFS flood fill
  let qi = 0;
  const dx4 = [-1, 1, 0, 0];
  const dy4 = [0, 0, -1, 1];

  while (qi < queue.length) {
    const cx = queue[qi++];
    const cy = queue[qi++];

    for (let dir = 0; dir < 4; dir++) {
      const nx = cx + dx4[dir];
      const ny = cy + dy4[dir];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = idx(nx, ny);
      if (state[ni] !== 0) continue;

      const d = distAt(nx, ny);
      if (d < HARD_THRESHOLD) {
        state[ni] = 1;
        queue.push(nx, ny);
      } else if (d < SOFT_THRESHOLD) {
        state[ni] = 2;
        queue.push(nx, ny);
      }
    }
  }

  // Phase 2: apply transparency + color decontamination based on flood-fill results
  let removedCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = state[idx(x, y)];
      const pi = pixelIdx(x, y);
      if (s === 1) {
        pixels[pi + 3] = 0;
        removedCount++;
      } else if (s === 2) {
        const d = distAt(x, y);
        const t = Math.max(0, Math.min(1, (d - HARD_THRESHOLD) / (SOFT_THRESHOLD - HARD_THRESHOLD)));
        pixels[pi + 3] = Math.min(pixels[pi + 3], Math.round(255 * t));

        // Remove background color spill from the foreground RGB.
        // A mixed pixel = fg * t + bg * (1-t), so fg = (pixel - bg*(1-t)) / t.
        // Only apply when t is large enough to avoid extreme amplification.
        if (t >= 0.15 && t < 1) {
          const bgMix = 1 - t;
          pixels[pi]     = clampByte((pixels[pi]     - bgColor.r * bgMix) / t);
          pixels[pi + 1] = clampByte((pixels[pi + 1] - bgColor.g * bgMix) / t);
          pixels[pi + 2] = clampByte((pixels[pi + 2] - bgColor.b * bgMix) / t);
        }
      }
    }
  }

  const totalPixels = width * height;
  console.log(
    `[chromakey] Removed ${removedCount}/${totalPixels} pixels (${((removedCount / totalPixels) * 100).toFixed(1)}%)`,
  );

  return sharp(Buffer.from(pixels.buffer), {
    raw: { width, height, channels },
  })
    .png()
    .toBuffer();
}

/**
 * Auto-detect background color by sampling corner regions.
 * Samples a small patch (5x5) from each corner and averages.
 */
function detectBackgroundColor(pixels, width, height, channels) {
  const patchSize = 5;
  const corners = [
    { x: 0, y: 0 },
    { x: width - patchSize, y: 0 },
    { x: 0, y: height - patchSize },
    { x: width - patchSize, y: height - patchSize },
  ];

  let totalR = 0,
    totalG = 0,
    totalB = 0,
    count = 0;

  for (const corner of corners) {
    for (let dy = 0; dy < patchSize; dy++) {
      for (let dx = 0; dx < patchSize; dx++) {
        const px = corner.x + dx;
        const py = corner.y + dy;
        const idx = (py * width + px) * channels;
        totalR += pixels[idx];
        totalG += pixels[idx + 1];
        totalB += pixels[idx + 2];
        count++;
      }
    }
  }

  return {
    r: Math.round(totalR / count),
    g: Math.round(totalG / count),
    b: Math.round(totalB / count),
  };
}

function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function clampByte(v) {
  return Math.min(255, Math.max(0, Math.round(v)));
}
