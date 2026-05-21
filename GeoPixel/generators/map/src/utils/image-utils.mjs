import sharp from "sharp";

/**
 * Resize an image buffer to the given width, preserving aspect ratio.
 * By default this will not upscale smaller images.
 * @returns {{ buffer: Buffer, width: number, height: number }}
 */
export async function resizeImage(imageBuffer, targetWidth, options = {}) {
  const img = sharp(imageBuffer);
  const meta = await img.metadata();
  const allowUpscale = options.allowUpscale ?? false;
  const finalWidth = allowUpscale ? targetWidth : Math.min(targetWidth, meta.width);
  const ratio = finalWidth / meta.width;
  const targetHeight = Math.round(meta.height * ratio);

  const buffer = await img
    .resize(finalWidth, targetHeight, { fit: "fill" })
    .png()
    .toBuffer();

  return { buffer, width: finalWidth, height: targetHeight };
}

/**
 * Build a lighter-weight working image for overlay localization steps.
 * Keeps 1K-ish inputs unchanged, but downsizes larger images while preserving
 * aspect ratio so overlay editing spends fewer tokens. Returned coordinates
 * should always be mapped back to the original image size by callers.
 */
export async function buildOverlayWorkingImage(imageBuffer) {
  const { width, height } = await getImageSize(imageBuffer);
  if (width <= 1536) {
    return { buffer: imageBuffer, width, height, resized: false };
  }

  const targetWidth = Math.min(1536, Math.max(1152, Math.round(width / 2)));
  const resized = await resizeImage(imageBuffer, targetWidth);
  return {
    ...resized,
    resized: resized.width !== width,
  };
}

/**
 * Get image dimensions.
 */
export async function getImageSize(imageBuffer) {
  const meta = await sharp(imageBuffer).metadata();
  return { width: meta.width, height: meta.height };
}

/**
 * Draw colored bounding boxes on an image.
 * @param {Buffer} imageBuffer
 * @param {{ x: number, y: number, w: number, h: number, color: string, label?: string }[]} boxes
 * @param {{ lineWidth?: number, fontSize?: number, labelTextColor?: string, labelBgColor?: string }} [options]
 * @returns {Buffer} PNG with boxes drawn
 */
export async function drawBoundingBoxes(imageBuffer, boxes, options = {}) {
  const { width, height } = await getImageSize(imageBuffer);
  const lineWidth = options.lineWidth ?? 3;
  const fontSize = options.fontSize ?? 12;
  const labelTextColor = options.labelTextColor ?? null;
  const labelBgColor = options.labelBgColor ?? null;

  const svgRects = boxes.map((box) => {
    const safeX = Math.max(0, box.x);
    const safeY = Math.max(0, box.y);
    const safeW = Math.min(box.w, width - safeX);
    const safeH = Math.min(box.h, height - safeY);
    const color = box.color || "rgba(0,120,255,0.7)";
    let svg = `<rect x="${safeX}" y="${safeY}" width="${safeW}" height="${safeH}" fill="none" stroke="${color}" stroke-width="${lineWidth}" />`;
    if (box.label) {
      const textColor = labelTextColor || color;
      const labelY = safeY + fontSize + 4;
      if (labelBgColor) {
        const labelWidth = Math.max(36, box.label.length * Math.round(fontSize * 0.68) + 8);
        svg += `<rect x="${safeX + 1}" y="${safeY + 1}" width="${labelWidth}" height="${fontSize + 8}" fill="${labelBgColor}" rx="2" ry="2" />`;
      }
      svg += `<text x="${safeX + 5}" y="${labelY}" font-size="${fontSize}" fill="${textColor}" font-family="monospace">${box.label}</text>`;
    }
    return svg;
  }).join("\n");

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${svgRects}</svg>`
  );

  return sharp(imageBuffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Draw a coordinate grid overlay on an image to help VLMs estimate pixel positions.
 * Grid spacing auto-scales with image width: <=1500→100, <=3000→150, 4K+→200.
 * @param {Buffer} imageBuffer
 * @returns {Promise<Buffer>} PNG with grid overlay
 */
export async function drawCoordinateGrid(imageBuffer) {
  const { width, height } = await getImageSize(imageBuffer);

  const gridSpacing = width <= 1500 ? 100 : width <= 3000 ? 150 : 200;
  const lineWidth = 2;
  const lineColor = "rgba(0,0,0,0.22)";
  const dotRadius = 4;
  const dotColor = "rgba(0,0,0,0.35)";
  const labelFontSize = 15;
  const labelColor = "rgba(0,0,0,0.6)";
  const dotLabelFontSize = 12;
  const dotLabelColor = "rgba(0,0,0,0.55)";

  const parts = [];

  for (let x = 0; x <= width; x += gridSpacing) {
    parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${lineColor}" stroke-width="${lineWidth}" />`);
  }
  for (let y = 0; y <= height; y += gridSpacing) {
    parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${lineColor}" stroke-width="${lineWidth}" />`);
  }

  for (let x = 0; x <= width; x += gridSpacing) {
    if (x < width - 20) {
      parts.push(`<text x="${x + 4}" y="${labelFontSize + 3}" font-size="${labelFontSize}" font-weight="bold" fill="${labelColor}" font-family="monospace">${x}</text>`);
    }
  }
  for (let y = gridSpacing; y <= height; y += gridSpacing) {
    if (y < height - 10) {
      parts.push(`<text x="4" y="${y - 4}" font-size="${labelFontSize}" font-weight="bold" fill="${labelColor}" font-family="monospace">${y}</text>`);
    }
  }

  for (let x = gridSpacing; x < width; x += gridSpacing) {
    for (let y = gridSpacing; y < height; y += gridSpacing) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${dotRadius}" fill="${dotColor}" />`);
      parts.push(`<text x="${x + 5}" y="${y - 5}" font-size="${dotLabelFontSize}" fill="${dotLabelColor}" font-family="monospace">${x},${y}</text>`);
    }
  }

  const overlay = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("\n")}</svg>`
  );

  return sharp(imageBuffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Analyze a walkable-marked image by comparing it with the original.
 * Divides both images into blocks and detects which blocks have significantly
 * more cyan (RGB 0,255,255) in the marked version.
 *
 * Key design: always resize ORIGINAL to match MARKED dimensions (upscale),
 * never downscale the marked image — downscaling dilutes the cyan overlay signal.
 *
 * @param {Buffer} originalBuffer - original map image
 * @param {Buffer} markedBuffer   - same map with walkable areas marked cyan
 * @param {number} tileSizeAtSource - desired tile size in the original generated map (e.g. 16)
 * @param {number} origWidth        - original generated image width, used to compute the scale ratio
 * @returns {{ grid: number[][], gridWidth: number, gridHeight: number, actualBlockSize: number }}
 *   grid values: 0 = walkable, 1 = blocked
 */
export async function computeWalkableGrid(originalBuffer, markedBuffer, tileSizeAtSource = 16, origWidth = 5504) {
  const origMeta = await sharp(originalBuffer).metadata();
  const markMeta = await sharp(markedBuffer).metadata();

  const targetW = markMeta.width;
  const targetH = markMeta.height;

  const scale = targetW / origWidth;
  const actualBlockSize = Math.max(1, Math.round(tileSizeAtSource * scale));

  console.log(`[grid] Original: ${origMeta.width}x${origMeta.height}, Marked: ${markMeta.width}x${markMeta.height}, Comparing at: ${targetW}x${targetH}`);
  console.log(`[grid] Source tile=${tileSizeAtSource}px, scale=${scale.toFixed(4)}, actual block=${actualBlockSize}px`);

  const origRaw = await sharp(originalBuffer)
    .resize(targetW, targetH, { fit: "fill" })
    .raw()
    .toBuffer();

  const markRaw = await sharp(markedBuffer)
    .resize(targetW, targetH, { fit: "fill" })
    .raw()
    .toBuffer();

  const channels = origRaw.length / (targetW * targetH);
  const gridWidth = Math.floor(targetW / actualBlockSize);
  const gridHeight = Math.floor(targetH / actualBlockSize);
  const grid = [];
  const evidenceGrid = [];

  let debugWalkable = 0;
  let rescuedThinCorridor = 0;

  for (let gy = 0; gy < gridHeight; gy++) {
    const row = [];
    const evidenceRow = [];
    for (let gx = 0; gx < gridWidth; gx++) {
      let origR = 0, origG = 0, origB = 0;
      let markR = 0, markG = 0, markB = 0;
      let count = 0;
      let strongCyanPixels = 0;
      let weakCyanPixels = 0;

      for (let dy = 0; dy < actualBlockSize; dy++) {
        for (let dx = 0; dx < actualBlockSize; dx++) {
          const px = gx * actualBlockSize + dx;
          const py = gy * actualBlockSize + dy;
          const idx = (py * targetW + px) * channels;

          origR += origRaw[idx];     origG += origRaw[idx + 1]; origB += origRaw[idx + 2];
          markR += markRaw[idx];     markG += markRaw[idx + 1]; markB += markRaw[idx + 2];

          const pixelDeltaR = markRaw[idx] - origRaw[idx];
          const pixelDeltaG = markRaw[idx + 1] - origRaw[idx + 1];
          const pixelDeltaB = markRaw[idx + 2] - origRaw[idx + 2];

          if (pixelDeltaG >= 18 && pixelDeltaB >= 18 && pixelDeltaR <= 8) {
            strongCyanPixels++;
          } else if (pixelDeltaG >= 10 && pixelDeltaB >= 10 && pixelDeltaR <= 14) {
            weakCyanPixels++;
          }
          count++;
        }
      }

      const aOrigR = origR / count, aOrigG = origG / count, aOrigB = origB / count;
      const aMarkR = markR / count, aMarkG = markG / count, aMarkB = markB / count;

      const deltaR = aMarkR - aOrigR;
      const deltaG = aMarkG - aOrigG;
      const deltaB = aMarkB - aOrigB;

      // Cyan overlay increases G and B while suppressing R.
      // Bias conservative: require a meaningful amount of the tile to actually
      // look cyan, not just a slight average tint. This avoids over-expanding
      // walkable zones during tile conversion.
      const cyanShift = Math.min(deltaG, deltaB) - deltaR;
      const strongCoverage = strongCyanPixels / count;
      const weakCoverage = (strongCyanPixels + weakCyanPixels) / count;
      const isWalkable =
        strongCoverage >= 0.22 ||
        (weakCoverage >= 0.38 && cyanShift >= 8 && deltaG >= 8 && deltaB >= 8);

      if (isWalkable) debugWalkable++;
      row.push(isWalkable ? 0 : 1);
      evidenceRow.push({ strongCoverage, weakCoverage, cyanShift, deltaG, deltaB });
    }
    grid.push(row);
    evidenceGrid.push(evidenceRow);
  }

  // Preserve genuinely thin one-tile corridors. If a blocked tile has moderate
  // cyan evidence and is the only connector between two walkable tiles in a
  // straight line, keep it walkable instead of shrinking it away.
  for (let y = 1; y < gridHeight - 1; y++) {
    for (let x = 1; x < gridWidth - 1; x++) {
      if (grid[y][x] === 0) continue;
      const evidence = evidenceGrid[y][x];
      const horizontalBridge = grid[y][x - 1] === 0 && grid[y][x + 1] === 0;
      const verticalBridge = grid[y - 1][x] === 0 && grid[y + 1][x] === 0;
      const moderateEvidence =
        evidence.strongCoverage >= 0.08 ||
        (evidence.weakCoverage >= 0.18 && evidence.cyanShift >= 5);

      if ((horizontalBridge || verticalBridge) && moderateEvidence) {
        grid[y][x] = 0;
        debugWalkable++;
        rescuedThinCorridor++;
      }
    }
  }

  console.log(
    `[grid] Result: ${gridWidth}x${gridHeight}, walkable: ${debugWalkable}/${gridWidth * gridHeight} (${(debugWalkable / (gridWidth * gridHeight) * 100).toFixed(1)}%), thin-corridor rescues: ${rescuedThinCorridor}`,
  );

  return { grid, gridWidth, gridHeight, actualBlockSize };
}

/**
 * Morphological cleanup: remove isolated single-cell walkable noise only.
 * We intentionally do NOT fill blocked gaps here, because that tends to make
 * walkable regions wider than the model actually marked.
 */
export function cleanupGrid(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const result = grid.map((row) => [...row]);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const neighbors = [
        grid[y - 1][x], grid[y + 1][x],
        grid[y][x - 1], grid[y][x + 1],
      ];
      const walkableNeighbors = neighbors.filter((n) => n === 0).length;

      if (grid[y][x] === 0 && walkableNeighbors === 0) {
        result[y][x] = 1;
      }
    }
  }

  return result;
}
