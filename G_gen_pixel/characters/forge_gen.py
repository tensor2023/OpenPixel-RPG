"""
Generate 4-directional walk sprite sheet for Character 1 (female)
using AGF 4x4 format via tokenrouter gemini-2.5-flash-image.

Output: G_gen_pixel/characters/forge/char1_female_walk_4x4.png

4x4 layout (AGF player sheet):
  Row 1: walking DOWN  — col1: neutral, col2: left-foot, col3: neutral, col4: right-foot
  Row 2: walking LEFT  — same foot phases
  Row 3: walking RIGHT — same foot phases
  Row 4: walking UP    — same foot phases
"""

import base64, io, json, os, urllib.request
from PIL import Image

# ── Config ──────────────────────────────────────────────────────────────────
API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
REF_PATH  = os.path.join(BASE_DIR, "ori_char", "female.jpg")
OUT_DIR   = os.path.join(BASE_DIR, "forge")
OUT_FILE  = os.path.join(OUT_DIR, "char1_female_walk_4x4.png")

# ── Prompt ───────────────────────────────────────────────────────────────────
PROMPT = """Create a pixel art 4x4 sprite sheet — a top-down walk animation for a young adult female character inspired by the reference photo.

SHEET LAYOUT — exactly 4 rows × 4 columns, 16 equal cells:
  Row 1 (top):    character walks TOWARD the viewer (facing down/south)
  Row 2:          character walks LEFT (facing west)
  Row 3:          character walks RIGHT (facing east)
  Row 4 (bottom): character walks AWAY from the viewer (facing up/north)

  Within each row, the 4 columns are walk cycle phases:
    Col 1: neutral stance (feet together)
    Col 2: left foot forward
    Col 3: neutral stance (feet together)
    Col 4: right foot forward

CHARACTER STYLE:
  - Pixel art, chibi/Q-version proportions (head is about 1/2.5 of total body height)
  - Cute, trendy, cool, vivid saturated colors
  - 20-year-old young woman, modern/casual outfit
  - Preserve the face shape, hair color, clothing style, and overall vibe from the reference photo
  - Dark crisp pixel outlines, readable at small scale
  - Full body visible in every cell (head to feet)

TECHNICAL REQUIREMENTS:
  - Background: 100% solid flat magenta #FF00FF — no gradients, no shadows, no vignette
  - NO borders, NO lines, NO frames between cells — only magenta separates cells
  - NO text, NO labels, NO numbers, NO arrows
  - The character MUST be the identical height and scale in all 16 cells (same bounding box)
  - Character fills roughly 60% of each cell, with equal magenta margin on all four sides
  - No body part (hair, feet, arms) may cross a cell edge
  - Consistent pixel scale across all 16 frames"""

# ── Helpers ──────────────────────────────────────────────────────────────────
def resize_ref(path: str, max_px: int = 128) -> str:
    """Resize reference image to ≤max_px on each side, return base64 PNG."""
    img = Image.open(path).convert("RGB")
    if img.width > max_px or img.height > max_px:
        img.thumbnail((max_px, max_px), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def extract_image(data: dict) -> bytes | None:
    msg = data.get("choices", [{}])[0].get("message", {})
    # path 1: message.images[]
    for img in msg.get("images", []):
        url = (img.get("image_url", {}).get("url", "")
               if isinstance(img, dict) else str(img))
        if "base64," in url:
            return base64.b64decode(url.split("base64,", 1)[1])
    # path 2: message.content list
    content = msg.get("content", "")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = part["image_url"]["url"]
                if "base64," in url:
                    return base64.b64decode(url.split("base64,", 1)[1])
    # path 3: raw base64 string
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
    print("  calling gemini-2.5-flash-image …  (may take 60-120 s)")
    with opener.open(req, timeout=300) as resp:
        data = json.loads(resp.read())
    return data, extract_image(data)


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"[char1_female] loading reference: {os.path.basename(REF_PATH)}")
    ref_b64 = resize_ref(REF_PATH)
    print(f"  resized reference → {len(ref_b64)//1024} KB b64")

    data, img_bytes = call_api(PROMPT, ref_b64)

    if img_bytes:
        with open(OUT_FILE, "wb") as f:
            f.write(img_bytes)
        print(f"  saved: {OUT_FILE}  ({len(img_bytes)//1024} KB)")

        # also save raw API response for debugging
        meta_path = OUT_FILE.replace(".png", "_meta.json")
        safe = {k: v for k, v in data.items() if k != "choices"}
        safe["choices_text"] = [
            c.get("message", {}).get("content", "")[:200]
            for c in data.get("choices", [])
            if isinstance(c.get("message", {}).get("content"), str)
        ]
        with open(meta_path, "w") as f:
            json.dump(safe, f, indent=2)
        print(f"  meta: {meta_path}")
    else:
        print("  ERROR: no image in response")
        print("  raw response (first 800 chars):")
        print(json.dumps(data)[:800])


if __name__ == "__main__":
    main()
