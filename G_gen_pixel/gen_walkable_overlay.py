"""
Generate a walkable-area overlay for isometric NYC pixel art tiles.

Roads/sidewalks in isometric-nyc appear as low-saturation grayish/tan pixels.
Buildings and trees have higher saturation or distinctive hues.

Usage:
  python gen_walkable_overlay.py <input.png> <output.png>
"""
import sys
import numpy as np
from PIL import Image


def is_road_pixel(r, g, b):
    """Detect road/sidewalk pixels in isometric NYC style."""
    # Convert to HSV-like analysis
    maxc = max(r, g, b)
    minc = min(r, g, b)
    saturation = (maxc - minc) / maxc if maxc > 0 else 0
    brightness = maxc / 255.0

    # Roads/sidewalks: low saturation (gray/tan), medium-high brightness
    if saturation < 0.22 and brightness > 0.35:
        return True

    # Tan/beige pavement (warm-toned sidewalks)
    if (r > g > b and r > 150 and saturation < 0.30 and brightness > 0.50):
        return True

    # Yellow road markings / lane lines
    if r > 200 and g > 180 and b < 100 and saturation > 0.3:
        return False  # yellow paint on road - part of road surface, counted below

    return False


def generate_walkable_overlay(input_path: str, output_path: str):
    img = Image.open(input_path).convert("RGB")
    arr = np.array(img, dtype=np.uint8)
    h, w = arr.shape[:2]

    # Create mask
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    maxc = np.maximum(np.maximum(r, g), b).astype(float)
    minc = np.minimum(np.minimum(r, g), b).astype(float)
    saturation = np.where(maxc > 0, (maxc - minc) / maxc, 0)
    brightness = maxc / 255.0

    # Road mask: low saturation (gray/beige) + medium brightness
    road_mask = (saturation < 0.22) & (brightness > 0.35)

    # Also capture warm-toned sidewalks (r > g > b, low-moderate sat)
    warm_mask = (r.astype(int) > g.astype(int)) & (g.astype(int) > b.astype(int)) & \
                (r > 150) & (saturation < 0.30) & (brightness > 0.50)

    walkable = road_mask | warm_mask

    # Morphological cleanup: simple numpy-based closing (fill small gaps)
    # Dilation: a pixel is walkable if any neighbor in a 3x3 window is walkable
    kernel_size = 5
    pad = kernel_size // 2
    padded = np.pad(walkable.astype(np.uint8), pad, mode='constant')
    dilated = np.zeros_like(walkable, dtype=np.uint8)
    for dy in range(kernel_size):
        for dx in range(kernel_size):
            dilated |= padded[dy:dy+h, dx:dx+w]
    # Erosion on dilated: shrink back
    padded2 = np.pad(dilated, pad, mode='constant')
    eroded = np.ones_like(walkable, dtype=np.uint8)
    for dy in range(kernel_size):
        for dx in range(kernel_size):
            eroded &= padded2[dy:dy+h, dx:dx+w]
    walkable = eroded.astype(bool)

    # Create output image: original + cyan overlay on walkable areas
    out = arr.copy().astype(float)
    alpha = 0.65  # overlay opacity

    # Apply cyan (0, 255, 255) overlay on walkable pixels
    mask3 = walkable[:, :, np.newaxis]
    cyan = np.array([0, 255, 255], dtype=float)
    out = np.where(mask3, out * (1 - alpha) + cyan * alpha, out)
    out = np.clip(out, 0, 255).astype(np.uint8)

    result = Image.fromarray(out)
    result.save(output_path)

    walkable_pct = walkable.sum() / (h * w) * 100
    print(f"Walkable pixels: {walkable.sum()} / {h*w} ({walkable_pct:.1f}%)")
    print(f"Saved to: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <input.png> <output.png>")
        sys.exit(1)
    generate_walkable_overlay(sys.argv[1], sys.argv[2])
