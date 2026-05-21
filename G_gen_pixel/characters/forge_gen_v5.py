"""
Generate individual single-frame sprites for DOWN and UP directions.
Each frame is one API call → model focuses entirely on one pose → best consistency.

Output layout in forge/:
  char1_v5_down_idle.png
  char1_v5_down_walk_01.png ... char1_v5_down_walk_10.png
  char1_v5_up_idle.png
  char1_v5_up_walk_01.png  ... char1_v5_up_walk_10.png
"""

import base64, io, json, os, time, urllib.request
from PIL import Image

API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
OUT_DIR   = os.path.join(BASE_DIR, "forge")
CANONICAL = os.path.join(OUT_DIR, "char1_canonical_front.png")

# ── Identity lock (prepended to every prompt) ────────────────────────────────
IDENTITY = (
    "Use the pixel art character shown as the EXACT visual reference. "
    "You MUST copy identically: the face shape, eyes, expression (gentle smile), "
    "hair (dark brown twin tails), skin tone, outfit (pink plaid dress, white collar, black bow), "
    "white socks, black shoes, body proportions (chibi 2.5-head ratio), and pixel art style. "
    "Do NOT change any of these features. Only the walking pose changes. "
)

# ── Art style rules ───────────────────────────────────────────────────────────
STYLE = (
    "Style: pixel art RPG overworld sprite. "
    "Chunky pixels, crisp dark outlines, saturated vivid colors. "
    "Full body visible from head to feet. "
    "Character centered, fills about 70% of the canvas height. "
    "Background: 100% solid white (#FFFFFF), no shadows, no gradients. "
    "NO text, NO labels, NO borders, NO extra characters."
)

# ── DOWN walk pose descriptions (10 variants, alternating legs) ───────────────
DOWN_WALK_POSES = [
    # odd = left foot forward, even = right foot forward
    "LEFT foot stepped clearly forward, RIGHT foot planted behind. "
    "Left knee slightly bent, foot in front. Right arm swings forward, left arm back. "
    "Body upright, facing DIRECTLY toward camera — both shoulders fully visible and symmetric. "
    "NO side turn, NO head tilt.",

    "RIGHT foot stepped clearly forward, LEFT foot planted behind. "
    "Right knee slightly bent, foot in front. Left arm swings forward, right arm back. "
    "Body upright, facing DIRECTLY toward camera — both shoulders fully visible and symmetric. "
    "NO side turn, NO head tilt.",

    "LEFT leg lifted — knee raised noticeably, foot off the ground mid-step. "
    "Right foot grounded. Right arm swings forward. "
    "Body strictly FRONT-FACING toward camera, both shoulders even. NO side view.",

    "RIGHT leg lifted — knee raised noticeably, foot off the ground mid-step. "
    "Left foot grounded. Left arm swings forward. "
    "Body strictly FRONT-FACING toward camera, both shoulders even. NO side view.",

    "LEFT foot landed in front, heel touching ground, toe up slightly (heel-strike). "
    "Right foot pushing off behind. Right arm forward. "
    "Facing DIRECTLY at camera, body perfectly straight. NO 3/4 angle.",

    "RIGHT foot landed in front, heel touching ground, toe up slightly (heel-strike). "
    "Left foot pushing off behind. Left arm forward. "
    "Facing DIRECTLY at camera, body perfectly straight. NO 3/4 angle.",

    "Both feet apart in mid-stride — LEFT foot forward, RIGHT foot back, weight on right. "
    "Arms counterswing strongly. Body upright, FULLY FRONT-FACING, shoulders symmetric.",

    "Both feet apart in mid-stride — RIGHT foot forward, LEFT foot back, weight on left. "
    "Arms counterswing strongly. Body upright, FULLY FRONT-FACING, shoulders symmetric.",

    "LEFT foot one step ahead, skirt swaying slightly left from motion. "
    "Right arm noticeably forward. Facing camera head-on — NO turning, NO side profile.",

    "RIGHT foot one step ahead, skirt swaying slightly right from motion. "
    "Left arm noticeably forward. Facing camera head-on — NO turning, NO side profile.",
]

# ── UP walk pose descriptions (10 variants) ───────────────────────────────────
UP_WALK_POSES = [
    "LEFT foot stepped clearly forward (away from camera). Right foot behind. "
    "Left arm swings back (toward viewer), right arm forward (away). "
    "Back STRICTLY facing camera — both shoulders visible and symmetric from behind. "
    "NO side turn, NO profile view. Show back of head and hair twin tails from behind.",

    "RIGHT foot stepped clearly forward (away from camera). Left foot behind. "
    "Right arm swings back (toward viewer), left arm forward (away). "
    "Back STRICTLY facing camera — both shoulders symmetric from behind. NO side view.",

    "LEFT leg lifted — knee raised, foot off ground, stepping away. "
    "Right foot grounded. Back fully to camera, both shoulders even. "
    "Twin tails visible from behind. NO turning.",

    "RIGHT leg lifted — knee raised, foot off ground, stepping away. "
    "Left foot grounded. Back fully to camera, both shoulders even. "
    "Twin tails visible from behind. NO turning.",

    "LEFT foot landed far forward (away), heel first. Right foot pushing off. "
    "Back to camera, shoulders straight and symmetric. NO profile.",

    "RIGHT foot landed far forward (away), heel first. Left foot pushing off. "
    "Back to camera, shoulders straight and symmetric. NO profile.",

    "Both feet apart in mid-stride away — LEFT foot further from camera, RIGHT foot near. "
    "Back entirely to viewer, arms counterswing. Shoulders symmetric.",

    "Both feet apart in mid-stride away — RIGHT foot further, LEFT foot near. "
    "Back entirely to viewer, arms counterswing. Shoulders symmetric.",

    "LEFT foot forward (away), skirt swaying from motion. "
    "Back of head visible, twin tails bouncing. Body straight, back to camera, NO side turn.",

    "RIGHT foot forward (away), skirt swaying from motion. "
    "Back of head visible, twin tails bouncing. Body straight, back to camera, NO side turn.",
]

DOWN_IDLE = (
    "Standing still, FACING DIRECTLY TOWARD THE CAMERA. "
    "Neutral relaxed pose — both feet flat on ground, slightly apart. "
    "Arms hanging naturally at sides. Head looks straight at camera. "
    "Body perfectly upright, both shoulders equal and symmetric. "
    "This is a pure FRONT VIEW — NO 3/4 angle, NO side turn whatsoever."
)

UP_IDLE = (
    "Standing still, BACK FULLY TOWARD THE CAMERA. "
    "Neutral relaxed pose — both feet flat on ground, slightly apart. "
    "Arms hanging at sides. Back of head and twin tails visible. "
    "Body perfectly upright, both shoulders equal from behind. "
    "This is a pure BACK VIEW — NO 3/4 angle, NO side turn whatsoever."
)


def img_to_b64(img: Image.Image, max_px: int = 128) -> str:
    if img.width > max_px or img.height > max_px:
        img = img.copy()
        img.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
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
    return extract_image(data)


def gen(label: str, pose_desc: str, canon_b64: str, out_path: str):
    prompt = IDENTITY + "\n\n" + pose_desc + "\n\n" + STYLE
    print(f"  [{label}] generating …")
    raw = call_api(prompt, canon_b64)
    if raw:
        with open(out_path, "wb") as f:
            f.write(raw)
        print(f"    saved: {os.path.basename(out_path)}  ({len(raw)//1024} KB)")
    else:
        print(f"    FAILED: {label}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Loading canonical: {CANONICAL}")
    canon_b64 = img_to_b64(Image.open(CANONICAL).convert("RGB"), 128)
    print(f"  ref → {len(canon_b64)//1024} KB\n")

    total = 2 + len(DOWN_WALK_POSES) + len(UP_WALK_POSES)
    print(f"Total API calls: {total}  (1 idle + 10 walk) × 2 directions\n")

    # ── DOWN ──────────────────────────────────────────────────────────────────
    print("=== DOWN (front-facing) ===")
    gen("down_idle", DOWN_IDLE,
        canon_b64, os.path.join(OUT_DIR, "char1_v5_down_idle.png"))

    for i, pose in enumerate(DOWN_WALK_POSES, 1):
        gen(f"down_walk_{i:02d}", pose,
            canon_b64, os.path.join(OUT_DIR, f"char1_v5_down_walk_{i:02d}.png"))

    # ── UP ────────────────────────────────────────────────────────────────────
    print("\n=== UP (back-facing) ===")
    gen("up_idle", UP_IDLE,
        canon_b64, os.path.join(OUT_DIR, "char1_v5_up_idle.png"))

    for i, pose in enumerate(UP_WALK_POSES, 1):
        gen(f"up_walk_{i:02d}", pose,
            canon_b64, os.path.join(OUT_DIR, f"char1_v5_up_walk_{i:02d}.png"))

    print("\nDone. Check forge/char1_v5_*.png and pick your favorites.")


if __name__ == "__main__":
    main()
