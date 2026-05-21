import sharp from "sharp";

/**
 * Optimize the source map for downstream model input without changing resolution.
 * The smallest variant is selected from:
 * - original PNG
 * - lossless PNG recompression
 * - low-loss palette PNG for compact model input on simpler game-map visuals
 * @returns {{ compressedMap: Buffer, width: number, height: number, originalBytes: number, compressedBytes: number, strategy: string }}
 */
export async function compressMap(originalBuffer) {
  console.log("[Step 2] Optimizing map for model input...");

  const meta = await sharp(originalBuffer).metadata();
  const width = meta.width;
  const height = meta.height;

  const losslessPng = await sharp(originalBuffer)
    .png({
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: true,
    })
    .toBuffer();

  const lowLossPalettePng = await sharp(originalBuffer)
    .png({
      compressionLevel: 9,
      effort: 10,
      adaptiveFiltering: false,
      palette: true,
      quality: 95,
      colors: 256,
      dither: 0.25,
    })
    .toBuffer();

  const candidates = [
    { strategy: "original", buffer: originalBuffer },
    { strategy: "lossless_png", buffer: losslessPng },
    { strategy: "low_loss_palette_png", buffer: lowLossPalettePng },
  ].sort((a, b) => a.buffer.length - b.buffer.length);

  const selected = candidates[0];
  const savedBytes = originalBuffer.length - selected.buffer.length;
  const savedPercent = originalBuffer.length > 0
    ? ((savedBytes / originalBuffer.length) * 100).toFixed(1)
    : "0.0";

  console.log(`[Step 2] Resolution kept at ${width}x${height}`);
  console.log(`[Step 2] Original: ${originalBuffer.length} bytes`);
  console.log(`[Step 2] Lossless PNG: ${losslessPng.length} bytes`);
  console.log(`[Step 2] Low-loss palette PNG: ${lowLossPalettePng.length} bytes`);
  console.log(`[Step 2] Selected ${selected.strategy}: ${selected.buffer.length} bytes (${savedBytes >= 0 ? "-" : "+"}${Math.abs(savedPercent)}%)`);

  return {
    compressedMap: selected.buffer,
    width,
    height,
    originalBytes: originalBuffer.length,
    compressedBytes: selected.buffer.length,
    strategy: selected.strategy,
  };
}
