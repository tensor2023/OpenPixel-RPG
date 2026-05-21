"""
Generate multiple UP and DOWN strip variants for manual selection.
- Reuses canonical sprite from v3 (char1_canonical_front.png)
- White background (#FFFFFF)
- Generates N variants each for UP and DOWN
"""

import base64, io, json, os, urllib.request
from PIL import Image

API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
OUT_DIR   = os.path.join(BASE_DIR, "forge")
CANONICAL = os.path.join(OUT_DIR, "char1_canonical_front.png")

N_VARIANTS = 4  # how many variants to generate per direction

CHAR_STYLE = (
    "Top-down 2D pixel art for a 16-bit RPG overworld. "
    "3/4 view from slightly above — you can see the top of the head, shoulders, and full body. "
    "Chunky pixel-art with crisp dark outlines and saturated colors. "
    "Character fills ~65% of its cell with white margin for engine rendering. "
    "Background is 100% solid flat white (#FFFFFF), no gradients, no shadow. "
    "NO text, NO labels, NO UI."
)

GRID_RULES = (
    "ABSOLUTE RULES: "
    "1. EXACTLY 4 equal cells in a 2x2 grid. "
    "2. NO borders, NO lines between cells — only white space. "
    "3. NO text, NO labels, NO numbers. "
    "4. IDENTICAL character height and pixel scale in every cell. "
    "5. No body part may cross a cell edge."
)

IDENTITY_LOCK = (
    "Use the pixel art sprite shown as the EXACT visual reference. "
    "Preserve IDENTICALLY: face shape, facial expression, hair color, hairstyle (twin tails), "
    "outfit color and style (pink plaid dress, bow), body proportions, pixel scale, and art style. "
    "Do NOT redesign — copy the character exactly, only change direction and walking pose. "
)

DOWN_PROMPT = (
    IDENTITY_LOCK +
    "Create a 2x2 sprite sheet: 4-frame walk cycle, ALL FRAMES FACING DOWN (toward camera, face fully visible). "
    "The walk must be CLEARLY VISIBLE — exaggerate the leg movement so each frame looks different. "
    "Top-left:  neutral stance — both feet flat on ground, arms at sides. "
    "Top-right: LEFT leg lifted and stepped forward (knee visibly bent), left arm swings forward, right arm swings back. "
    "Bottom-left: neutral stance again — both feet on ground, weight settled. "
    "Bottom-right: RIGHT leg lifted and stepped forward (knee visibly bent), right arm swings forward, left arm swings back. "
    "The leg stride should be obvious — feet should visibly separate between neutral and step frames. "
    "Head and torso face forward and stay identical in all 4 frames. "
    + CHAR_STYLE + " " + GRID_RULES
)

UP_PROMPT = (
    IDENTITY_LOCK +
    "Create a 2x2 sprite sheet: 4-frame walk cycle, ALL FRAMES FACING UP (walking away, back to camera). "
    "Show the BACK of the character — back of head and hair (twin tails visible from behind), back of outfit. "
    "The walk must be CLEARLY VISIBLE — exaggerate the leg movement so each frame looks different. "
    "Top-left:  neutral stance — both feet flat, back to camera. "
    "Top-right: LEFT leg lifted and stepped forward (away from camera, knee visibly bent), left arm swings forward. "
    "Bottom-left: neutral stance again. "
    "Bottom-right: RIGHT leg lifted and stepped forward, right arm swings forward. "
    "The stride should be obvious between frames. Head and torso stay identical facing away. "
    + CHAR_STYLE + " " + GRID_RULES
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
        print(f"  [warn] no image: {json.dumps(data)[:200]}")
    return raw


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Loading canonical sprite: {CANONICAL}")
    canon_img = Image.open(CANONICAL).convert("RGB")
    canon_b64 = img_to_b64(canon_img, max_px=128)
    print(f"  ref → {len(canon_b64)//1024} KB b64\n")

    for direction, prompt in [("down", DOWN_PROMPT), ("up", UP_PROMPT)]:
        print(f"=== {direction.upper()} — generating {N_VARIANTS} variants ===")
        for i in range(1, N_VARIANTS + 1):
            print(f"  [{direction} variant {i}/{N_VARIANTS}] …")
            raw = call_api(prompt, canon_b64)
            if raw is None:
                print(f"  FAILED variant {i}")
                continue
            path = os.path.join(OUT_DIR, f"char1_v4_{direction}_{i:02d}.png")
            with open(path, "wb") as f:
                f.write(raw)
            print(f"  saved: {path}  ({len(raw)//1024} KB)")

    print("\nDone. Pick your preferred DOWN and UP strips from forge/char1_v4_*.png")


if __name__ == "__main__":
    main()
