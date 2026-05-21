"""
Generate 5 isometric idle sprites for the main character.
Camera: elevation -45°, azimuth -15° (classic isometric RPG, like Stardew Valley).

Outputs in forge/iso/:
  iso_combined.png   — 2×2 grid, all 4 directions for style reference
  iso_south_idle.png — 向前 (facing camera / south)
  iso_north_idle.png — 向后 (back to camera / north)
  iso_west_idle.png  — 向左 (facing upper-left / west)
  iso_east_idle.png  — 向右 (facing lower-right / east)

Reference: 参考/正面.png (already pixel art, used directly as identity anchor)
"""

import base64, io, json, os
import requests
from PIL import Image

API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
REF_IMG   = os.path.join(BASE_DIR, "参考", "正面.png")
OUT_DIR   = os.path.join(BASE_DIR, "forge", "iso")

# ── Identity lock ─────────────────────────────────────────────────────────────
IDENTITY = (
    "Use the pixel art character shown as the EXACT visual reference. "
    "You MUST copy identically: the face shape, big brown eyes, gentle smile, "
    "dark brown twin tails hair, skin tone, pink plaid dress, white collar with black bow, "
    "white socks, black shoes, chibi body proportions (2.5-head ratio), "
    "chunky pixel art style, vivid colors, dark outlines. "
    "Do NOT change any of these features. Only the viewing angle and direction changes."
)

# ── Isometric perspective rules (appended to every prompt) ────────────────────
ISO_VIEW = (
    "Viewing angle: isometric RPG perspective. "
    "Camera is elevated 45 degrees above the ground, looking slightly down. "
    "This is the classic isometric view used in Stardew Valley or GBA Pokémon overworld sprites. "
    "The character appears viewed from above-and-in-front, "
    "so the top of the head is slightly visible and the body has mild vertical foreshortening. "
)

# ── Art style rules ───────────────────────────────────────────────────────────
STYLE = (
    "Style: pixel art RPG overworld sprite, isometric perspective. "
    "Chunky pixels, crisp dark outlines, saturated vivid colors. "
    "Full body visible from head to feet. "
    "Character centered, fills about 70% of the canvas height. "
    "Background: 100% solid white (#FFFFFF), no shadows, no gradients. "
    "NO text, NO labels, NO borders, NO extra characters."
)

# ── Pose descriptions ─────────────────────────────────────────────────────────
COMBINED = (
    "Create a single image with a 2×2 grid showing the SAME character standing idle "
    "in 4 isometric directions. No borders or labels between panels. "
    "TOP-LEFT panel:    character faces SOUTH (toward camera) — front face visible, "
    "                   top of head slightly visible from 45° above. "
    "TOP-RIGHT panel:   character faces NORTH (away from camera) — back of head and "
    "                   twin tails visible, back of dress showing. "
    "BOTTOM-LEFT panel: character faces WEST (upper-left on screen) — "
    "                   3/4 left-side profile, left cheek and ear visible. "
    "BOTTOM-RIGHT panel: character faces EAST (lower-right on screen) — "
    "                   3/4 right-side profile, right cheek and ear visible. "
    "All 4 poses: standing still, arms relaxed at sides, weight balanced. "
    "Maintain perfectly consistent character appearance across all 4 panels."
)

SOUTH = (
    "Single character, standing idle, facing SOUTH — directly toward the camera. "
    "Isometric view: camera 45° above, so top of head slightly visible. "
    "Front of face clearly shown: both eyes visible, gentle smile, face forward. "
    "Both shoulders visible from above-front angle. "
    "Arms relaxed at sides. Feet flat on ground. Pink dress hangs naturally. "
    "Body upright. This is the SOUTH / toward-viewer direction."
)

NORTH = (
    "Single character, standing idle, facing NORTH — directly away from the camera. "
    "Isometric view: camera 45° above, so top of head and back of hair visible. "
    "Back of head shown: twin tails hanging behind. No face visible. "
    "Back of pink plaid dress visible. Both shoulders from above-back angle. "
    "Arms relaxed at sides. Feet flat. "
    "This is the NORTH / away-from-viewer direction."
)

WEST = (
    "Single character, standing idle, facing WEST — toward upper-left of screen. "
    "Isometric view: camera 45° above. "
    "3/4 left-side profile: left cheek and ear visible, face angled to the left. "
    "Left shoulder forward (closer to camera), right shoulder further back. "
    "Left side of dress and left arm visible. Right arm partially behind body. "
    "Arms relaxed at sides. Feet flat. "
    "This is the WEST / upper-left direction."
)

EAST = (
    "Single character, standing idle, facing EAST — toward lower-right of screen. "
    "Isometric view: camera 45° above. "
    "3/4 right-side profile: right cheek and ear visible, face angled to the right. "
    "Right shoulder forward (closer to camera), left shoulder further back. "
    "Right side of dress and right arm visible. Left arm partially behind body. "
    "Arms relaxed at sides. Feet flat. "
    "This is the EAST / lower-right direction."
)

TASKS = [
    ("combined",   COMBINED),
    ("south_idle", SOUTH),
    ("north_idle", NORTH),
    ("west_idle",  WEST),
    ("east_idle",  EAST),
]


def img_to_b64(path: str, max_px: int = 128) -> str:
    img = Image.open(path).convert("RGBA")
    # Composite onto white background before resizing
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    bg.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    bg.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def extract_image(data: dict) -> bytes | None:
    msg = data.get("choices", [{}])[0].get("message", {})
    for img_item in msg.get("images", []):
        url = (img_item.get("image_url", {}).get("url", "")
               if isinstance(img_item, dict) else str(img_item))
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
    payload = {
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
    }
    resp = requests.post(
        API_URL, json=payload,
        headers={"Authorization": f"Bearer {API_KEY}"},
        proxies={"http": "", "https": ""},
        timeout=900,
    )
    resp.raise_for_status()
    return extract_image(resp.json())


def gen(label: str, pose_desc: str, ref_b64: str):
    prompt = IDENTITY + "\n\n" + ISO_VIEW + "\n\n" + pose_desc + "\n\n" + STYLE
    out_path = os.path.join(OUT_DIR, f"iso_{label}.png")
    print(f"[{label}] generating …")
    raw = call_api(prompt, ref_b64)
    if raw:
        with open(out_path, "wb") as f:
            f.write(raw)
        print(f"  saved: iso_{label}.png  ({len(raw)//1024} KB)")
    else:
        print(f"  FAILED: {label}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Reference: {REF_IMG}")
    ref_b64 = img_to_b64(REF_IMG)
    print(f"  resized to ≤128px, {len(ref_b64)//1024} KB\n")
    print(f"Output dir: {OUT_DIR}")
    print(f"Total API calls: {len(TASKS)}\n")

    for label, pose in TASKS:
        gen(label, pose, ref_b64)

    print("\nDone. Check forge/iso/ for results.")


if __name__ == "__main__":
    main()
