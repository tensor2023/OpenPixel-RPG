"""
img2img chained approach for consistent 4-direction walk sheet.

Step 1: Generate a single canonical front-facing pixel art sprite from the real photo.
Step 2: Use THAT pixel art sprite as the reference image for each direction strip.
        The model sees the exact same character each time → consistent look.
Step 3: Mirror LEFT to get RIGHT. Assemble into 4x4.

Key insight: real photo reference → model interprets differently each time.
             pixel art sprite reference → model copies identity faithfully.
"""

import base64, io, json, os, urllib.request
from PIL import Image

# ── Config ────────────────────────────────────────────────────────────────────
API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
PHOTO_REF    = os.path.join(BASE_DIR, "ori_char", "female.jpg")
OUT_DIR      = os.path.join(BASE_DIR, "forge")
CANONICAL    = os.path.join(OUT_DIR, "char1_canonical_front.png")

CHAR_STYLE = (
    "Top-down 2D pixel art for a 16-bit RPG overworld. "
    "3/4 view from slightly above — you can see the top of the head, shoulders, and full body. "
    "Chunky pixel-art with crisp dark outlines and saturated colors. "
    "Character fills ~65% of its cell with magenta margin for engine rendering. "
    "Background is 100% solid flat magenta (#FF00FF), no gradients, no shadow. "
    "NO text, NO labels, NO UI."
)

GRID_RULES = (
    "ABSOLUTE RULES: "
    "1. EXACTLY 4 equal cells in a 2x2 grid. "
    "2. NO borders, NO lines between cells — only magenta. "
    "3. NO text, NO labels, NO numbers. "
    "4. IDENTICAL character height and pixel scale in every cell. "
    "5. No body part may cross a cell edge."
)

# ── Helpers ───────────────────────────────────────────────────────────────────
def img_to_b64(img: Image.Image, max_px: int = 128) -> str:
    """Resize image to ≤max_px and return base64 PNG."""
    if img.width > max_px or img.height > max_px:
        img = img.copy()
        img.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def file_to_b64(path: str, max_px: int = 128) -> str:
    ext = os.path.splitext(path)[1].lower()
    img = Image.open(path).convert("RGB")
    return img_to_b64(img, max_px)


def extract_image(data: dict) -> bytes | None:
    msg = data.get("choices", [{}])[0].get("message", {})
    for img in msg.get("images", []):
        url = (img.get("image_url", {}).get("url", "")
               if isinstance(img, dict) else str(img))
        if "base64," in url:
            return base64.b64decode(url.split("base64,", 1)[1])
    content = msg.get("content", "")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = part["image_url"]["url"]
                if "base64," in url:
                    return base64.b64decode(url.split("base64,", 1)[1])
    if isinstance(content, str) and "base64," in content:
        b64 = content.split("base64,", 1)[1].split('"')[0]
        return base64.b64decode(b64)
    return None


def call_api(prompt: str, ref_b64: str) -> bytes | None:
    payload = json.dumps({
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{ref_b64}"}},
            ],
        }],
        "modalities": ["image", "text"],
    }).encode()
    req = urllib.request.Request(
        API_URL, data=payload,
        headers={"Authorization": f"Bearer {API_KEY}",
                 "Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=300) as resp:
        data = json.loads(resp.read())
    raw = extract_image(data)
    if raw is None:
        print(f"  [warn] no image in response: {json.dumps(data)[:300]}")
    return raw


def split_2x2(img: Image.Image) -> list[Image.Image]:
    w, h = img.size
    cw, ch = w // 2, h // 2
    return [
        img.crop((0,  0,  cw, ch)),
        img.crop((cw, 0,  w,  ch)),
        img.crop((0,  ch, cw, h)),
        img.crop((cw, ch, w,  h)),
    ]


def assemble_4x4(strips: dict[str, Image.Image]) -> Image.Image:
    # Normalize all strips to the same size as DOWN
    ref_w, ref_h = strips["down"].size
    sheet = Image.new("RGB", (ref_w * 2, ref_h * 2), (255, 0, 255))
    for r, direction in enumerate(["down", "left", "right", "up"]):
        strip = strips[direction].resize((ref_w, ref_h), Image.LANCZOS)
        row = r // 2
        col = r % 2
        sheet.paste(strip, (col * ref_w, row * ref_h))
    # Actually assemble row by row (down=row0, left=row1, right=row2, up=row3)
    # Each strip is 2 cols wide, so the final sheet is 4 cols × 4 rows
    cells_down  = split_2x2(strips["down"])
    cells_left  = split_2x2(strips["left"])
    cells_right = split_2x2(strips["right"])
    cells_up    = split_2x2(strips["up"])
    cw, ch = cells_down[0].size
    sheet = Image.new("RGB", (cw * 4, ch * 4), (255, 0, 255))
    for r, row_cells in enumerate([cells_down, cells_left, cells_right, cells_up]):
        for c, cell in enumerate(row_cells):
            cell = cell.resize((cw, ch), Image.LANCZOS)
            sheet.paste(cell, (c * cw, r * ch))
    return sheet


# ── Step 1: Canonical front-facing sprite ─────────────────────────────────────
STEP1_PROMPT = (
    "Use the image just shown as the visual reference (real person photo). "
    "Create a SINGLE front-facing pixel art sprite of this character. "
    "Style: top-down 2D pixel art RPG overworld, 3/4 view from slightly above, "
    "chibi Q-version proportions (head is ~1/2.5 of total body height), "
    "cute, trendy, cool, vivid saturated colors. "
    "Preserve the face shape, hair color and style, and overall vibe from the reference. "
    "Outfit: casual/trendy, keep it close to what the person is wearing in the photo. "
    "The character must face TOWARD the viewer (front-facing, face fully visible). "
    "Full body visible from head to feet. "
    "Character centered in the image with generous magenta margin on all sides. "
    "Background: 100% solid flat magenta #FF00FF. "
    "Chunky pixel outlines, crisp and readable at small scale. "
    "NO text, NO labels, NO borders."
)

# ── Step 2: Direction strips using canonical sprite as reference ───────────────
def make_strip_prompt(direction: str) -> str:
    base = (
        "Use the pixel art sprite shown as the EXACT visual reference. "
        "Preserve IDENTICALLY: face shape, facial expression, hair color, hairstyle, "
        "outfit color and style, body proportions, pixel scale, and art style. "
        "Do NOT redesign or reinterpret the character — copy it exactly, only change the direction and pose. "
    )

    if direction == "down":
        body = (
            "Create a 2x2 sprite sheet: 4-frame walk cycle, ALL FRAMES FACING DOWN (toward camera). "
            "Top-left:  neutral — feet together, arms at sides. "
            "Top-right: LEFT foot stepped forward, right foot back, left arm slightly forward. "
            "Bottom-left: neutral again — feet together, reset. "
            "Bottom-right: RIGHT foot stepped forward, left foot back, right arm slightly forward. "
            "ONLY legs alternate and arms counter-swing. Head and torso are IDENTICAL across all 4 frames. "
        )
    elif direction == "left":
        body = (
            "Create a 2x2 sprite sheet: 4-frame walk cycle, ALL FRAMES FACING LEFT. "
            "The character has turned to face LEFT — show the LEFT SIDE of the body. "
            "You see the left cheek/ear (not the front of the face), left shoulder leads. "
            "Arms swing FORWARD and BACKWARD (one toward viewer, one away). "
            "Top-left:  neutral — feet together, body facing left. "
            "Top-right: one foot forward (toward left), arms counterswing. "
            "Bottom-left: neutral again. "
            "Bottom-right: other foot forward, arms in opposite swing. "
            "ONLY legs and arms move. Head/torso stays consistently facing left. "
        )
    elif direction == "up":
        body = (
            "Create a 2x2 sprite sheet: 4-frame walk cycle, ALL FRAMES FACING UP (away from camera). "
            "You see the BACK of the character — back of head and hair, back of outfit. "
            "Top-left:  neutral — feet together, back to camera. "
            "Top-right: LEFT foot stepped forward (away), right back, arms counterswing. "
            "Bottom-left: neutral again. "
            "Bottom-right: RIGHT foot stepped forward, left back, arms in opposite swing. "
            "ONLY legs and arms move. "
        )
    else:
        body = ""

    return (
        base + body +
        f"{CHAR_STYLE} {GRID_RULES}"
    )


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # ── Step 1: Generate canonical sprite from photo ──────────────────────────
    print("=== Step 1: Generate canonical front-facing sprite ===")
    photo_b64 = file_to_b64(PHOTO_REF)
    print(f"  photo ref → {len(photo_b64)//1024} KB b64")

    raw = call_api(STEP1_PROMPT, photo_b64)
    if raw is None:
        print("FAILED: could not generate canonical sprite"); return
    with open(CANONICAL, "wb") as f:
        f.write(raw)
    print(f"  saved: {CANONICAL}  ({len(raw)//1024} KB)")

    # ── Step 2: Generate direction strips using canonical sprite ──────────────
    print("\n=== Step 2: Generate direction strips (using pixel art as reference) ===")
    canonical_img = Image.open(CANONICAL).convert("RGB")
    canon_b64 = img_to_b64(canonical_img, max_px=128)
    print(f"  canonical sprite ref → {len(canon_b64)//1024} KB b64")

    strips: dict[str, Image.Image] = {}
    for direction in ["down", "left", "up"]:
        print(f"\n[{direction}] generating 2×2 strip …")
        prompt = make_strip_prompt(direction)
        raw = call_api(prompt, canon_b64)
        if raw is None:
            print(f"  FAILED for '{direction}'"); return
        strip = Image.open(io.BytesIO(raw)).convert("RGB")
        path = os.path.join(OUT_DIR, f"char1_v3_strip_{direction}.png")
        strip.save(path)
        print(f"  saved: {path}  ({len(raw)//1024} KB)")
        strips[direction] = strip

    # RIGHT = mirror of LEFT
    print("\n[right] mirroring left …")
    strips["right"] = strips["left"].transpose(Image.FLIP_LEFT_RIGHT)
    strips["right"].save(os.path.join(OUT_DIR, "char1_v3_strip_right.png"))

    # ── Step 3: Assemble 4×4 ─────────────────────────────────────────────────
    print("\n=== Step 3: Assemble 4×4 sheet ===")
    sheet = assemble_4x4(strips)
    out_path = os.path.join(OUT_DIR, "char1_female_walk_4x4_v3.png")
    sheet.save(out_path)
    print(f"  saved: {out_path}  ({os.path.getsize(out_path)//1024} KB)")
    print("\nDone. Row order: DOWN | LEFT | RIGHT (mirrored) | UP")


if __name__ == "__main__":
    main()
