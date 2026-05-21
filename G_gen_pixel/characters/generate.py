"""
Generate pixel art character sprites from real person reference photos.
Uses openai/gpt-5.4-image-2 via TokenRouter (direct connection, no proxy).
"""
import base64, json, os, urllib.request, urllib.error

API_URL = "https://api.tokenrouter.com/v1/chat/completions"
API_KEY = "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH"
MODEL = "openai/gpt-5.4-image-2"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ORI_DIR = os.path.join(BASE_DIR, "ori_char")

CHARACTERS = [
    {
        "id": "char1_female",
        "ref": os.path.join(ORI_DIR, "female.jpg"),
        "prompt": (
            "Based on this real person photo, create a pixel art JRPG character sprite. "
            "Style: chibi Q-version, 2.5 head-to-body ratio, front-facing idle pose, "
            "cute, trendy, cool, vivid colors, white background, full body visible. "
            "Keep the facial features and overall look recognizable from the reference photo."
        ),
    },
    {
        "id": "char2_child",
        "ref": os.path.join(ORI_DIR, "child.jpg"),
        "prompt": (
            "Based on this real person photo, create a pixel art JRPG character sprite. "
            "Style: chibi Q-version, 2.5 head-to-body ratio, front-facing idle pose, "
            "cute, trendy, cool, vivid colors, white background, full body visible. "
            "The character should look like a small child, about half the height of an adult. "
            "Keep the facial features and overall look recognizable from the reference photo."
        ),
    },
    {
        "id": "char3_male",
        "ref": os.path.join(ORI_DIR, "male.jpg"),
        "prompt": (
            "Based on this real person photo, create a pixel art JRPG character sprite. "
            "Style: chibi Q-version, 2.5 head-to-body ratio, front-facing idle pose, "
            "cute, trendy, cool, vivid colors, white background, full body visible. "
            "The character should look slightly taller than the female character. "
            "Keep the facial features and overall look recognizable from the reference photo."
        ),
    },
]


def load_image_b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


def extract_image(data):
    msg = data.get("choices", [{}])[0].get("message", {})
    # path 1: message.images[]
    for img in msg.get("images", []):
        url = img.get("image_url", {}).get("url", "") if isinstance(img, dict) else str(img)
        if "base64," in url:
            return base64.b64decode(url.split("base64,", 1)[1])
    # path 2: message.content list
    content = msg.get("content", "")
    if isinstance(content, list):
        for part in content:
            if part.get("type") == "image_url":
                url = part["image_url"]["url"]
                if "base64," in url:
                    return base64.b64decode(url.split("base64,", 1)[1])
    # path 3: inline base64 in string content
    if isinstance(content, str) and "base64," in content:
        b64 = content.split("base64,", 1)[1].split('"')[0]
        return base64.b64decode(b64)
    return None


def generate(char):
    print(f"\n[{char['id']}] loading reference: {os.path.basename(char['ref'])}")
    ext = os.path.splitext(char["ref"])[1].lstrip(".")
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else "image/png"
    b64 = load_image_b64(char["ref"])
    print(f"  reference size: {len(b64)//1024} KB b64")

    payload = json.dumps({
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": char["prompt"]},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ],
        }],
        "modalities": ["image", "text"],
    }).encode()

    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    # Bypass system proxy
    proxy_handler = urllib.request.ProxyHandler({})
    opener = urllib.request.build_opener(proxy_handler)

    print("  calling API...")
    with opener.open(req, timeout=180) as resp:
        data = json.loads(resp.read())

    img_bytes = extract_image(data)
    if img_bytes:
        out_path = os.path.join(BASE_DIR, f"{char['id']}.png")
        with open(out_path, "wb") as f:
            f.write(img_bytes)
        print(f"  saved: {char['id']}.png ({len(img_bytes)//1024} KB)")
    else:
        print(f"  no image in response: {json.dumps(data)[:400]}")


def main():
    print("=== Character Generator (gpt-5.4-image-2, reference photos) ===")
    for char in CHARACTERS:
        try:
            generate(char)
        except Exception as e:
            print(f"  FAILED [{char['id']}]: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
