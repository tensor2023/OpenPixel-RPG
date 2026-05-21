import sharp from "sharp";
import { dirname, extname, basename, resolve } from "path";
import { fileURLToPath } from "url";

const DEFAULT_COLOR_THRESHOLD = 28;
const DEFAULT_MIN_FOREGROUND_PIXELS = 16;
const DEFAULT_ROW_GAP_TOLERANCE = 14;

async function main() {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

  const absoluteInputPath = resolve(inputPath);
  const absoluteOutputPath = resolve(
    outputPath || buildDefaultOutputPath(absoluteInputPath),
  );

  const { data, info } = await sharp(absoluteInputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const { width, height, channels } = info;
  const bgColor = detectBackgroundColor(pixels, width, height, channels);
  const contentBands = detectContentBands(
    pixels,
    width,
    height,
    channels,
    bgColor,
  );

  if (contentBands.length === 0) {
    throw new Error("没有检测到角色内容，未生成输出图片。");
  }

  const lastBand = contentBands[contentBands.length - 1];
  const previousBand = contentBands[contentBands.length - 2] || null;
  const coverTop = previousBand
    ? Math.floor((previousBand.end + lastBand.start) / 2) + 1
    : lastBand.start;

  fillBottomRegion(
    pixels,
    width,
    height,
    channels,
    coverTop,
    bgColor,
  );

  await sharp(Buffer.from(pixels.buffer), {
    raw: { width, height, channels },
  })
    .png()
    .toFile(absoluteOutputPath);

  console.log(`Input:  ${absoluteInputPath}`);
  console.log(`Output: ${absoluteOutputPath}`);
  console.log(
    `Covered rows: y=${coverTop}..${height - 1} with rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`,
  );
}

function parseArgs(args) {
  const inputPath = args[0];
  if (!inputPath) {
    printUsageAndExit();
  }

  const outputFlagIndex = args.indexOf("--output");
  const outputPath =
    outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined;

  if (outputFlagIndex !== -1 && !outputPath) {
    throw new Error("--output 后面需要传输出路径。");
  }

  return { inputPath, outputPath };
}

function printUsageAndExit() {
  console.error(
    "Usage: node src/erase-bottom-row.mjs <input.png> [--output <output.png>]",
  );
  process.exit(1);
}

function buildDefaultOutputPath(inputPath) {
  const extension = extname(inputPath) || ".png";
  const fileName = basename(inputPath, extension);
  return resolve(dirname(inputPath), `${fileName}-bottom-row-erased${extension}`);
}

function detectContentBands(pixels, width, height, channels, bgColor) {
  const contentRows = [];
  const minForegroundPixels = Math.max(
    DEFAULT_MIN_FOREGROUND_PIXELS,
    Math.round(width * 0.01),
  );

  for (let y = 0; y < height; y++) {
    let foregroundPixels = 0;

    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * channels;
      if (
        colorDistance(
          pixels[pixelOffset],
          pixels[pixelOffset + 1],
          pixels[pixelOffset + 2],
          bgColor.r,
          bgColor.g,
          bgColor.b,
        ) > DEFAULT_COLOR_THRESHOLD
      ) {
        foregroundPixels++;
      }
    }

    if (foregroundPixels >= minForegroundPixels) {
      contentRows.push(y);
    }
  }

  return clusterRows(contentRows, DEFAULT_ROW_GAP_TOLERANCE);
}

function clusterRows(rows, gapTolerance) {
  if (rows.length === 0) {
    return [];
  }

  const bands = [];
  let start = rows[0];
  let end = rows[0];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row - end <= gapTolerance) {
      end = row;
      continue;
    }

    bands.push({ start, end });
    start = row;
    end = row;
  }

  bands.push({ start, end });
  return bands;
}

function fillBottomRegion(pixels, width, height, channels, startY, bgColor) {
  for (let y = startY; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelOffset = (y * width + x) * channels;
      pixels[pixelOffset] = bgColor.r;
      pixels[pixelOffset + 1] = bgColor.g;
      pixels[pixelOffset + 2] = bgColor.b;
      if (channels >= 4) {
        pixels[pixelOffset + 3] = 255;
      }
    }
  }
}

function detectBackgroundColor(pixels, width, height, channels) {
  const patchSize = Math.min(8, width, height);
  const corners = [
    { x: 0, y: 0 },
    { x: width - patchSize, y: 0 },
    { x: 0, y: height - patchSize },
    { x: width - patchSize, y: height - patchSize },
  ];

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (const corner of corners) {
    for (let dy = 0; dy < patchSize; dy++) {
      for (let dx = 0; dx < patchSize; dx++) {
        const pixelOffset = ((corner.y + dy) * width + corner.x + dx) * channels;
        totalR += pixels[pixelOffset];
        totalG += pixels[pixelOffset + 1];
        totalB += pixels[pixelOffset + 2];
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

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
