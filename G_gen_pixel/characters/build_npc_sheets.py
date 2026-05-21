#!/usr/bin/env python3
"""
Build 6x5 spritesheets from reference images (no AI).

For each NPC type, takes the single character image from 参考/,
removes the white background, and builds a 1020x1020 spritesheet
(6 cols x 5 rows, 170x204 per frame).

Usage: python3 build_npc_sheets.py
"""

import json, math, os, sys
from pathlib import Path
from PIL import Image, ImageFilter

SCRIPT_DIR = Path(__file__).parent
REF_DIR = SCRIPT_DIR / "参考"
OUTPUT_CHAR = SCRIPT_DIR / ".." / ".." / "GeoPixel" / "output" / "characters"

# Output dimensions
FW, FH = 170, 204  # frame width/height
COLS, ROWS = 6, 5
SW, SH = FW * COLS, FH * ROWS  # sheet = 1020x1020
GREEN = (0, 176, 0)

# Walk animation X offsets per frame (6 frames)
WALK_X = [0, -2, -5, 0, 2, 5]
# How much of each frame the character should fill
SCALE_FACTOR = 0.55

NPCS = [
    {"id": "app_npc_woman1",     "file": "npc_woman1.png",     "role": "年轻休闲女性"},
    {"id": "app_npc_woman2",     "file": "npc_woman2.png",     "role": "优雅女性"},
    {"id": "app_npc_woman3",     "file": "npc_woman3.png",     "role": "酷帅女性"},
    {"id": "app_npc_man1",       "file": "npc_man1.png",       "role": "休闲男性"},
    {"id": "app_npc_man2",       "file": "npc_man2.png",       "role": "斯文男性"},
    {"id": "app_npc_man3",       "file": "npc_man3.png",       "role": "运动男性"},
    {"id": "app_npc_girl",       "file": "npc_girl.png",       "role": "小女孩"},
    {"id": "app_npc_boy",        "file": "npc_boy.png",        "role": "小男孩"},
    {"id": "app_npc_oldman1",    "file": "npc_oldman1.png",    "role": "老年学者"},
    {"id": "app_npc_oldman2",    "file": "npc_oldman2.png",    "role": "老年开朗"},
    {"id": "app_npc_oldwoman1",  "file": "npc_oldwoman1.png",  "role": "老年典雅女性"},
    {"id": "app_npc_oldwoman2",  "file": "npc_oldwoman2.png",  "role": "老年热心女性"},
]


def remove_white_bg(img, threshold=35):
    """Remove near-white pixels → transparent."""
    img = img.convert("RGBA")
    pixels = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = pixels[x, y]
            dist = math.sqrt((r - 255) ** 2 + (g - 255) ** 2 + (b - 255) ** 2)
            if dist < threshold:
                pixels[x, y] = (r, g, b, 0)
    return img


def find_content_bounds(img):
    """Find bounding box of non-transparent pixels."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    pixels = img.load()
    min_x, min_y = img.width, img.height
    max_x, max_y = 0, 0
    found = False
    for y in range(img.height):
        for x in range(img.width):
            if pixels[x, y][3] > 30:
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
                found = True
    if not found:
        return None
    return min_x, min_y, max_x - min_x + 1, max_y - min_y + 1


def build_sheet_for(npc):
    """Build and save one NPC spritesheet."""
    ref_path = REF_DIR / npc["file"]
    if not ref_path.exists():
        print(f"  SKIP: {npc['file']} not found")
        return

    print(f"\n[{npc['id']}] {npc['role']} ← {npc['file']}")

    # 1. Load and remove white background
    ref_img = Image.open(ref_path).convert("RGBA")
    char_img = remove_white_bg(ref_img)

    # 2. Find character bounds
    bounds = find_content_bounds(char_img)
    if bounds is None:
        print("  FAIL: no character content")
        return
    bx, by, bw, bh = bounds
    print(f"  bounds: ({bx},{by}) {bw}×{bh}")

    # Crop to content
    char_cropped = char_img.crop((bx, by, bx + bw, by + bh))

    # 3. Scale to fit frame
    target_w = FW * SCALE_FACTOR
    target_h = FH * SCALE_FACTOR
    scale = min(target_w / bw, target_h / bh)
    new_w = max(1, round(bw * scale))
    new_h = max(1, round(bh * scale))
    print(f"  scale: {scale:.3f} → {new_w}×{new_h}")
    char_scaled = char_cropped.resize((new_w, new_h), Image.LANCZOS)

    # Darkened version for back view
    dark_arr = bytearray(char_scaled.tobytes())
    for i in range(0, len(dark_arr), 4):
        dark_arr[i]     = round(dark_arr[i] * 0.70)     # R
        dark_arr[i + 1] = round(dark_arr[i + 1] * 0.70) # G
        dark_arr[i + 2] = round(dark_arr[i + 2] * 0.70) # B
        # alpha unchanged
    char_back = Image.frombytes("RGBA", (new_w, new_h), bytes(dark_arr))

    # Flipped version for left-facing
    char_left = char_scaled.transpose(Image.FLIP_LEFT_RIGHT)

    # 4. Create spritesheet
    sheet = Image.new("RGBA", (SW, SH), GREEN + (255,))
    cx = (FW - new_w) // 2  # centered X within frame
    cy = (FH - new_h) // 2  # centered Y within frame

    for row in range(ROWS):
        for col in range(COLS):
            bx = col * FW
            by = row * FH

            if row == 0:
                # Walk left — flipped horizontally + walk offset
                px = bx + cx + WALK_X[col]
                sheet.paste(char_left, (px, by + cy), char_left)
            elif row == 1:
                # Walk down — front facing + walk offset
                px = bx + cx + WALK_X[col]
                sheet.paste(char_scaled, (px, by + cy), char_scaled)
            elif row == 2:
                # Walk up — darkened back view + walk offset
                px = bx + cx + WALK_X[col]
                sheet.paste(char_back, (px, by + cy), char_back)
            elif row == 3 and col < 3:
                # Idle row: col 0 = front, col 1 = back, col 2 = left
                if col == 0:
                    sheet.paste(char_scaled, (bx + cx, by + cy), char_scaled)
                elif col == 1:
                    sheet.paste(char_back, (bx + cx, by + cy), char_back)
                else:
                    sheet.paste(char_left, (bx + cx, by + cy), char_left)
            # else: leave green (blank cell)

    # 5. Save raw (green bg)
    out_dir = OUTPUT_CHAR / npc["id"]
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_path = out_dir / "spritesheet-raw.png"
    sheet.save(str(raw_path))
    print(f"  → spritesheet-raw.png  ({sheet.tell_size() if hasattr(sheet, 'tell_size') else os.path.getsize(raw_path) // 1024} KB)")

    # 6. Chromakey: remove green background
    transparent = remove_green_bg(sheet)
    sprite_path = out_dir / "spritesheet.png"
    transparent.save(str(sprite_path))
    print(f"  → spritesheet.png      ({os.path.getsize(sprite_path) // 1024} KB)")

    # 7. Metadata
    meta = {
        "id": npc["id"],
        "name": npc["role"],
        "description": f"NPC template: {npc['role']}",
        "frameWidth": FW,
        "frameHeight": FH,
        "columns": COLS,
        "rows": ROWS,
        "createdAt": None,
        "sourceFile": npc["file"],
        "animations": {
            "walk-left":  {"start": 0,  "end": 5,  "frameRate": 8},
            "walk-down":  {"start": 6,  "end": 11, "frameRate": 8},
            "walk-up":    {"start": 12, "end": 17, "frameRate": 8},
            "idle-front": {"frame": 18},
            "idle-back":  {"frame": 19},
            "idle-left":  {"frame": 20},
        },
    }
    from datetime import datetime, timezone
    meta["createdAt"] = datetime.now(timezone.utc).isoformat()
    meta_path = out_dir / "metadata.json"
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    print(f"  → metadata.json")

    # 8. Update manifest
    manifest_path = OUTPUT_CHAR / "characters.json"
    manifest = []
    if manifest_path.exists():
        with open(manifest_path) as f:
            try: manifest = json.load(f)
            except: manifest = []
    manifest = [e for e in manifest if e.get("id") != npc["id"]]
    manifest.append({
        "id": npc["id"], "name": npc["role"],
        "description": meta["description"],
        "createdAt": meta["createdAt"],
    })
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)


def remove_green_bg(img, hard_thresh=35, soft_thresh=65):
    """
    Chromakey: remove green background via flood-fill from edges.
    Returns new RGBA image.
    """
    img = img.convert("RGBA")
    w, h = img.size
    pixels = list(img.getdata())
    # Convert to bytearray for fast access
    arr = bytearray()
    for px in pixels:
        arr.extend(px)

    bg_r, bg_g, bg_b = GREEN
    state = [0] * (w * h)  # 0=unvisited, 1=bg(hard), 2=bg(soft)
    queue = []

    def idx(x, y):
        return y * w + x

    def pi(x, y):
        return (y * w + x) * 4

    def color_dist(r, gg, b):
        return math.sqrt((r - bg_r) ** 2 + (gg - bg_g) ** 2 + (b - bg_b) ** 2)

    def seed_if_bg(x, y):
        if x < 0 or y < 0 or x >= w or y >= h:
            return
        i = idx(x, y)
        if state[i] != 0:
            return
        p = pi(x, y)
        d = color_dist(arr[p], arr[p + 1], arr[p + 2])
        if d < soft_thresh:
            state[i] = 1 if d < hard_thresh else 2
            queue.append((x, y))

    # Seed edges
    for x in range(w):
        seed_if_bg(x, 0)
        seed_if_bg(x, h - 1)
    for y in range(1, h - 1):
        seed_if_bg(0, y)
        seed_if_bg(w - 1, y)

    # BFS
    qi = 0
    while qi < len(queue):
        cx, cy = queue[qi]
        qi += 1
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = cx + dx, cy + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h:
                continue
            ni = idx(nx, ny)
            if state[ni] != 0:
                continue
            p = pi(nx, ny)
            d = color_dist(arr[p], arr[p + 1], arr[p + 2])
            if d < soft_thresh:
                state[ni] = 1 if d < hard_thresh else 2
                queue.append((nx, ny))

    # Apply transparency
    for y in range(h):
        for x in range(w):
            s = state[idx(x, y)]
            p = pi(x, y)
            if s == 1:
                arr[p + 3] = 0
            elif s == 2:
                d = color_dist(arr[p], arr[p + 1], arr[p + 2])
                t = max(0, min(1, (d - hard_thresh) / (soft_thresh - hard_thresh)))
                arr[p + 3] = min(arr[p + 3], round(255 * t))

    result = Image.frombytes("RGBA", (w, h), bytes(arr))
    return result


def main():
    print("=== Build NPC Spritesheets from Reference Images ===\n")
    print(f"Reference images: {REF_DIR}")
    print(f"Output: {OUTPUT_CHAR}\n")

    for npc in NPCS:
        build_sheet_for(npc)

    print("\n=== Done! ===")


if __name__ == "__main__":
    main()
