"""
AGF-style 4-direction walk sheet generator.

Strategy (mirrors AGF player_sheet methodology):
  1. Generate 4 separate 2x2 direction strips (DOWN, LEFT, UP, RIGHT=mirror of LEFT)
  2. Each strip: one direction only, detailed per-frame pose descriptions
  3. Assemble into 4x4 sheet with PIL

Character 1: 20yo female, reference from ori_char/female.jpg
Output: forge/char1_female_walk_4x4_v2.png
"""

import base64, io, json, os, urllib.request
from PIL import Image

# ── Config ───────────────────────────────────────────────────────────────────
API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REF_PATH = os.path.join(BASE_DIR, "ori_char", "female.jpg")
OUT_DIR  = os.path.join(BASE_DIR, "forge")

# AGF CHAR_STYLE + GRID_RULES (from generate2dsprite.py)
CHAR_STYLE = (
    "Top-down 2D pixel art for a 16-bit RPG overworld. "
    "3/4 view from slightly above — you can see the top of the head, shoulders, and full body. "
    "Chunky pixel-art with crisp dark outlines and saturated colors. "
    "Character fills ~65% of its cell with magenta margin for engine rendering. "
    "Background is 100% solid flat magenta (#FF00FF), no gradients, no shadow. "
    "NO text, NO labels, NO UI, NO speech bubbles."
)

GRID_RULES = (
    "ABSOLUTE RULES: "
    "1. EXACTLY 4 equal cells in a 2x2 grid. "
    "2. NO borders, NO lines, NO frames between cells — only magenta. "
    "3. NO text, NO labels, NO numbers. "
    "4. IDENTICAL character height and pixel scale in every cell. "
    "5. No body part, hair, or foot may cross a cell edge."
)

# Character identity (shared across all directions)
CHAR_ID = (
    "CHARACTER: A 20-year-old young adult woman, chibi Q-version proportions "
    "(head is roughly half the total body height, 2.5-head ratio), "
    "cute, trendy, cool, vivid saturated colors. "
    "Match the face shape, hair color, hairstyle, and clothing style from the reference photo. "
    "SAME costume, SAME palette in every cell."
)

# ── Per-direction strip prompts (2×2, 4 frames each) ─────────────────────────
DIRECTIONS = {
    "down": (
        "A 2x2 pixel art sprite sheet: walk cycle ALL FRAMES FACING DOWN (toward camera, face fully visible). "
        f"{CHAR_ID} "
        "Top-left:  neutral stance — both feet together, arms hanging at sides, face looking toward viewer. "
        "Top-right: LEFT foot stepping forward, right foot planted back, LEFT arm swinging slightly forward. "
        "Bottom-left: neutral stance again — both feet together, reset. "
        "Bottom-right: RIGHT foot stepping forward, left foot planted back, RIGHT arm swinging slightly forward. "
        "The HEAD and TORSO do not move. ONLY legs alternate and arms counter-swing. "
        f"{CHAR_STYLE} {GRID_RULES}"
    ),
    "left": (
        "A 2x2 pixel art sprite sheet: walk cycle ALL FRAMES FACING LEFT (character has turned to face left). "
        f"{CHAR_ID} "
        "Camera angle: 3/4 top-down view — you see the LEFT SIDE of the body. "
        "The face is turned left (you see the left cheek/ear, NOT the front of the face). "
        "The body is turned so the LEFT SHOULDER leads. "
        "Arms swing FORWARD and BACKWARD (from viewer's perspective: one arm toward viewer, other away). "
        "Top-left:  neutral stance — feet together, body facing left. "
        "Top-right: forward foot stepping toward left, rear foot planted, arms counterswing. "
        "Bottom-left: neutral stance again. "
        "Bottom-right: other foot forward, arms swing to opposite position. "
        "ONLY legs and arms move. Head/torso direction stays consistently facing left. "
        f"{CHAR_STYLE} {GRID_RULES}"
    ),
    "up": (
        "A 2x2 pixel art sprite sheet: walk cycle ALL FRAMES FACING UP (away from camera, back of head visible). "
        f"{CHAR_ID} "
        "Camera angle: 3/4 top-down view — you see the BACK of the character. "
        "The BACK OF HEAD is visible (hair back), no face shown. "
        "Shoulders visible from behind. "
        "Top-left:  neutral stance — both feet together, back to camera. "
        "Top-right: LEFT foot stepping forward (away from camera), right foot planted, arms counterswing. "
        "Bottom-left: neutral stance again. "
        "Bottom-right: RIGHT foot stepping forward, left foot planted, arms swing other way. "
        "ONLY legs and arms move. "
        f"{CHAR_STYLE} {GRID_RULES}"
    ),
}
# RIGHT will be created by horizontally mirroring LEFT strip.

# ── Helpers ───────────────────────────────────────────────────────────────────
def resize_ref(path: str, max_px: int = 128) -> str:
    img = Image.open(path).convert("RGB")
    if img.width > max_px or img.height > max_px:
        img.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


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
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=300) as resp:
        data = json.loads(resp.read())
    raw = extract_image(data)
    if raw is None:
        print(f"    raw response: {json.dumps(data)[:400]}")
    return raw


def split_2x2(img: Image.Image) -> list[Image.Image]:
    """Split a 2x2 strip into 4 individual cell images [TL, TR, BL, BR]."""
    w, h = img.size
    cw, ch = w // 2, h // 2
    return [
        img.crop((0,  0,  cw, ch)),   # TL
        img.crop((cw, 0,  w,  ch)),   # TR
        img.crop((0,  ch, cw, h)),    # BL
        img.crop((cw, ch, w,  h)),    # BR
    ]


def assemble_4x4(strips: dict[str, Image.Image]) -> Image.Image:
    """
    Assemble four 2×2 strip images into a 4×4 sheet.
    Row order: down, left, right, up.
    Cell size is derived from the DOWN strip.
    """
    down_cells  = split_2x2(strips["down"])
    left_cells  = split_2x2(strips["left"])
    right_cells = split_2x2(strips["right"])
    up_cells    = split_2x2(strips["up"])

    cw, ch = down_cells[0].size
    sheet = Image.new("RGB", (cw * 4, ch * 4), (255, 0, 255))

    rows = [down_cells, left_cells, right_cells, up_cells]
    for r, row_cells in enumerate(rows):
        for c, cell in enumerate(row_cells):
            cell_resized = cell.resize((cw, ch), Image.LANCZOS)
            sheet.paste(cell_resized, (c * cw, r * ch))
    return sheet


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print("[char1_female] loading reference …")
    ref_b64 = resize_ref(REF_PATH)
    print(f"  resized ref → {len(ref_b64)//1024} KB b64\n")

    strips: dict[str, Image.Image] = {}

    for direction, prompt in DIRECTIONS.items():
        print(f"[{direction}] generating 2×2 strip …")
        raw = call_api(prompt, ref_b64)
        if raw is None:
            print(f"  ERROR: no image returned for '{direction}'")
            return
        strip = Image.open(io.BytesIO(raw)).convert("RGB")
        path = os.path.join(OUT_DIR, f"char1_female_strip_{direction}.png")
        strip.save(path)
        print(f"  saved: {path}  ({len(raw)//1024} KB)")
        strips[direction] = strip

    # RIGHT = horizontal mirror of LEFT
    print("[right] mirroring left strip …")
    strips["right"] = strips["left"].transpose(Image.FLIP_LEFT_RIGHT)
    r_path = os.path.join(OUT_DIR, "char1_female_strip_right.png")
    strips["right"].save(r_path)
    print(f"  saved: {r_path}")

    # Assemble 4×4
    print("\n[assemble] combining into 4×4 sheet …")
    sheet = assemble_4x4(strips)
    out_path = os.path.join(OUT_DIR, "char1_female_walk_4x4_v2.png")
    sheet.save(out_path)
    print(f"  saved: {out_path}  ({os.path.getsize(out_path)//1024} KB)")
    print("\nDone. Row order: DOWN | LEFT | RIGHT (mirrored) | UP")


if __name__ == "__main__":
    main()
