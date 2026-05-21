"""
Generate 12 NPC front-facing sprites in the same pixel art style as 正面.png.
Style reference only — each character has unique appearance.

Output: 参考/npc_*.png
"""

import base64, io, json, os
import requests
from PIL import Image

API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL   = "google/gemini-2.5-flash-image"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REF_IMG  = os.path.join(BASE_DIR, "参考", "正面.png")
OUT_DIR  = os.path.join(BASE_DIR, "参考")

# ── Style rules (same art style, different character) ────────────────────────
STYLE_PREFIX = (
    "Match the pixel art style of the reference image EXACTLY: "
    "same chunky pixel art aesthetic, same crisp dark outlines, same vivid saturated colors, "
    "same chibi body proportions, same cute facial expression style (big eyes, rosy cheeks, gentle smile or matching expression), "
    "same clean white background, same full-body front-facing view. "
    "Do NOT copy the reference character's appearance — create a completely DIFFERENT character with unique hair, outfit, and colors. "
)

STYLE_SUFFIX = (
    "View: PURE FRONT VIEW, both eyes fully visible, facing directly at camera, NO side turn, NO 3/4 angle. "
    "Full body from head to feet. Character centered, fills ~70% of canvas height. "
    "Background: 100% solid white (#FFFFFF). No shadows, no gradients. NO text, NO labels, NO borders."
)

# ── 12 NPC descriptions ──────────────────────────────────────────────────────
NPCS = [
    # ── Young Women ──────────────────────────────────────────────────────────
    (
        "npc_woman1",
        "Young adult woman, ~22 years old. "
        "Warm orange hair in a messy bun with loose strands. Bright cheerful smile, rosy cheeks. "
        "Wearing a cozy oversized cream knit sweater and denim mini skirt. White sneakers. "
        "Energetic and friendly expression."
    ),
    (
        "npc_woman2",
        "Young adult woman, ~25 years old. "
        "Long straight platinum blonde hair, slightly wavy at ends. Soft gentle smile. "
        "Wearing an elegant mint green floral dress with a small bow at waist. White heels. "
        "Graceful and calm expression."
    ),
    (
        "npc_woman3",
        "Young adult woman, ~20 years old. "
        "Short bob haircut, vivid purple hair. Confident smirk expression. "
        "Wearing a black leather jacket over a red crop top, plaid skirt in dark tones. Black boots. "
        "Cool and stylish look."
    ),

    # ── Young Men ────────────────────────────────────────────────────────────
    (
        "npc_man1",
        "Young adult man, ~23 years old. "
        "Black tousled messy hair. Friendly warm grin, rosy cheeks. "
        "Wearing a plain white t-shirt under an open blue flannel shirt, khaki shorts. White sneakers. "
        "Relaxed and easygoing expression."
    ),
    (
        "npc_man2",
        "Young adult man, ~26 years old. "
        "Neat light brown side-parted hair. Polite gentle smile. "
        "Wearing a tucked-in sky blue button-up shirt with rolled sleeves, dark navy slacks. Brown leather shoes. "
        "Smart and composed expression."
    ),
    (
        "npc_man3",
        "Young adult man, ~21 years old. "
        "Spiky bright blue hair tips (dark roots). Excited energetic grin. "
        "Wearing a color-blocked sports jacket in orange and black, matching track pants. Athletic sneakers. "
        "Dynamic sporty expression."
    ),

    # ── Young Girl ───────────────────────────────────────────────────────────
    (
        "npc_girl",
        "Young girl, ~8 years old. Smaller and shorter body than adults, bigger head-to-body ratio (~3:1 head ratio). "
        "Bright red hair in two high pigtails tied with yellow ribbons. Big sparkling eyes, wide happy smile, rosy cheeks. "
        "Wearing a bright yellow sundress with white daisy pattern. White ankle socks, red mary-jane shoes. "
        "Cheerful innocent expression."
    ),

    # ── Young Boy ────────────────────────────────────────────────────────────
    (
        "npc_boy",
        "Young boy, ~8 years old. Smaller and shorter body than adults, bigger head-to-body ratio (~3:1 head ratio). "
        "Blonde bowl-cut hair. Round eyes, excited open-mouth grin, rosy cheeks. "
        "Wearing light blue overalls over a striped red-and-white t-shirt. White sneakers. "
        "Playful energetic expression."
    ),

    # ── Old Men ──────────────────────────────────────────────────────────────
    (
        "npc_oldman1",
        "Elderly man, ~70 years old. Slightly shorter and more stooped posture than young adults. "
        "Neat white hair, round glasses on nose, white bushy eyebrows, gentle wrinkled face. Warm wise smile. "
        "Wearing a comfortable beige cardigan over a light shirt, dark brown trousers. Brown loafers. "
        "Kind scholarly expression."
    ),
    (
        "npc_oldman2",
        "Elderly man, ~68 years old. Slightly stooped posture. "
        "Completely bald head, short white beard and mustache, deep-set wrinkled eyes. Jolly laughing expression, rosy cheeks. "
        "Wearing a loose dark red traditional vest over a cream shirt, grey loose pants. Sandals. "
        "Cheerful and hearty expression."
    ),

    # ── Old Women ────────────────────────────────────────────────────────────
    (
        "npc_oldwoman1",
        "Elderly woman, ~65 years old. Slightly shorter and more stooped than young adults. "
        "White hair neatly pinned into a bun, with a decorative jade hairpin. Soft kind wrinkled face. Warm gentle smile. "
        "Wearing a pale lavender traditional floral qipao (cheongsam) dress. Black flat shoes. "
        "Serene and dignified expression."
    ),
    (
        "npc_oldwoman2",
        "Elderly woman, ~70 years old. Slightly stooped. "
        "Short permed silver-gray hair. Round wrinkled face with laugh lines, cheerful squinting eyes, rosy cheeks. Big warm smile. "
        "Wearing a bright colorful floral cardigan (teal and orange flowers) over a light blouse, comfortable dark skirt. "
        "Lively and warm-hearted expression."
    ),
]


def img_to_b64(path: str, max_px: int = 128) -> str:
    img = Image.open(path).convert("RGBA")
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


def gen(name: str, desc: str, ref_b64: str):
    prompt = STYLE_PREFIX + "\n\n" + desc + "\n\n" + STYLE_SUFFIX
    out_path = os.path.join(OUT_DIR, f"{name}.png")
    print(f"[{name}] generating …")
    raw = call_api(prompt, ref_b64)
    if raw:
        with open(out_path, "wb") as f:
            f.write(raw)
        print(f"  saved: {name}.png  ({len(raw)//1024} KB)")
    else:
        print(f"  FAILED: {name}")


def main():
    print(f"Reference: {REF_IMG}")
    ref_b64 = img_to_b64(REF_IMG)
    print(f"  resized to ≤128px, {len(ref_b64)//1024} KB\n")
    print(f"Total: {len(NPCS)} characters\n")

    for name, desc in NPCS:
        gen(name, desc, ref_b64)

    print("\nDone. Check 参考/ for npc_*.png")


if __name__ == "__main__":
    main()
