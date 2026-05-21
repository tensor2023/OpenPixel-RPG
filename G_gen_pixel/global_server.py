"""
Global Pixel Map Server — port 5002
Extends server.py (port 5001) with global-coverage routes.

New routes:
  POST /api/whitebox          → OSM whitebox for any lat/lon (returns base64 PNG)
  POST /api/generate-three    → whitebox + satellite/3D render + user prompt → Gemini 3.1 → pixel art

Run alongside server.py:
  python server.py        &   # port 5001 (NYC / existing)
  python global_server.py &   # port 5002 (global)

Frontend calls /api/whitebox to get the layout image, then /api/generate-three
with the whitebox + the satellite/3D screenshot it already captured + user's style prompt.
Gemini 3.1 Flash receives whitebox as geometry blueprint, render as color reference,
and the user's text prompt as style guide.
"""

import base64
import io
import json
import os
import sys
import tempfile
import urllib.request

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from PIL import Image

# ── Make whitebox module importable ──────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "whitebox"))
from osm_whitebox_global import generate_whitebox  # noqa: E402

load_dotenv()

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
TOKENROUTER_API_KEY = os.environ.get(
    "TOKENROUTER_API_KEY",
    "sk-kIohGc5eWf9pwV9BCMe0xqMhI8g7upm9xVgzdywqAbgp1gEH",
)
TOKENROUTER_BASE_URL = "https://api.tokenrouter.com/v1"
GEMINI_MODEL = "google/gemini-3.1-flash-image-preview"

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_proxies():
    proxy = (os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or
             os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy"))
    return {"http": proxy, "https": proxy} if proxy else {}

def _fetch_oss(url, timeout=60):
    """Fetch OSS URL — try direct first (China-internal), fall back to proxy on timeout."""
    try:
        return requests.get(url, timeout=timeout, proxies={"http": None, "https": None})
    except requests.Timeout:
        pass
    # Retry with proxy
    return requests.get(url, timeout=timeout, proxies=_get_proxies() or None)


def _call_gemini(messages, timeout=180):
    """Call Gemini image generation via TokenRouter (OpenAI-compatible API).
    Must bypass system proxy — TokenRouter requires direct connection."""
    payload = json.dumps({
        "model": GEMINI_MODEL,
        "messages": messages,
        "modalities": ["image", "text"],
    }).encode()

    req = urllib.request.Request(
        f"{TOKENROUTER_BASE_URL}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {TOKENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:
        data = json.loads(resp.read())

    if "error" in data:
        raise Exception(f"TokenRouter error: {data['error']}")

    msg = data["choices"][0]["message"]

    # Try message.images[] first
    for img in msg.get("images", []):
        url = img["image_url"]["url"]
        if "base64," in url:
            return base64.b64decode(url.split("base64,", 1)[1])
        else:
            r = _fetch_oss(url)
            return r.content

    # Fallback: content list
    for part in msg.get("content", []):
        if isinstance(part, dict) and part.get("type") == "image_url":
            url = part["image_url"]["url"]
            if "base64," in url:
                return base64.b64decode(url.split("base64,", 1)[1])
            else:
                r = _fetch_oss(url)
                return r.content

    raise Exception(f"No image in Gemini response. Message keys: {list(msg.keys())}")


def _b64_to_image(b64_str):
    """Convert base64 (with optional data URL prefix) to PIL Image."""
    b64_str = b64_str.split(",", 1)[-1]
    return Image.open(io.BytesIO(base64.b64decode(b64_str))).convert("RGB")


def _image_to_b64(img):
    """Convert PIL Image to base64 PNG string."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _resize_fit(img, max_size=512):
    """Resize image to fit within max_size x max_size, maintaining aspect ratio."""
    w, h = img.size
    if w <= max_size and h <= max_size:
        return img
    ratio = min(max_size / w, max_size / h)
    new_w, new_h = int(w * ratio), int(h * ratio)
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)

app = Flask(__name__)
CORS(app)


# ── Proxied routes (same as server.py, needed so the frontend works standalone) ──

@app.route("/api/config")
def config():
    return jsonify({"google_maps_api_key": GOOGLE_MAPS_API_KEY})


@app.route("/api/tile-proxy")
def tile_proxy():
    url = request.args.get("url", "")
    if not url or "tile.googleapis.com" not in url:
        return jsonify({"error": "Invalid URL"}), 400
    try:
        proxies = _get_proxies()
        r = requests.get(url, timeout=30, stream=True, proxies=proxies or None)
        content_type = r.headers.get("content-type", "application/octet-stream")
        return Response(r.iter_content(chunk_size=65536), status=r.status_code,
                        content_type=content_type)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/geocode")
def geocode():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "No location query"}), 400
    if not GOOGLE_MAPS_API_KEY:
        return jsonify({"error": "GOOGLE_MAPS_API_KEY not set"}), 500
    try:
        import googlemaps
        gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY, timeout=10, retry_timeout=10)
        results = gmaps.geocode(q)
        if not results:
            return jsonify({"error": f"Location not found: {q}"}), 404
        loc = results[0]["geometry"]["location"]
        return jsonify({"lat": loc["lat"], "lon": loc["lng"],
                        "address": results[0]["formatted_address"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── New global route 1: generate whitebox for any lat/lon ────────────────────

@app.route("/api/whitebox", methods=["POST"])
def whitebox():
    """
    Body: { "lat": float, "lon": float, "radius": int (metres, default 400), "skip_cache": bool }
    Returns: { "image": "data:image/png;base64,..." }

    Fetches OSM building data and renders an isometric whitebox PNG.
    Typical call time: 5-15 s (Overpass API fetch + local render).
    Results are cached by lat/lon/radius.
    """
    data = request.get_json() or {}
    lat = data.get("lat")
    lon = data.get("lon")
    if lat is None or lon is None:
        return jsonify({"error": "lat and lon are required"}), 400

    radius = float(data.get("radius", 400))
    skip_cache = data.get("skip_cache", False)

    # Cache check
    cache_dir = os.path.join(os.path.dirname(__file__), "cache", "whitebox")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{float(lat):.4f}_{float(lon):.4f}_r{int(radius)}.png")

    if not skip_cache and os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode()
        return jsonify({"image": f"data:image/png;base64,{encoded}", "cached": True})

    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            tmp_path = f.name

        generate_whitebox(lat=lat, lon=lon, radius_m=radius, output=tmp_path)

        with open(tmp_path, "rb") as f:
            img_data = f.read()

        # Save to cache
        with open(cache_path, "wb") as f:
            f.write(img_data)

        encoded = base64.b64encode(img_data).decode()
        return jsonify({"image": f"data:image/png;base64,{encoded}"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if "tmp_path" in dir() and os.path.exists(tmp_path):
            os.unlink(tmp_path)


# ── New global route 2: three-image pipeline ─────────────────────────────────

@app.route("/api/generate-three", methods=["POST"])
def generate_three():
    """
    Multi-image pixel art pipeline for any global location.
    Uses Gemini 3.1 Flash via TokenRouter with whitebox (geometry) + render (color) +
    user text prompt (style).

    Body:
      whitebox_image  : base64 PNG (OSM building footprints — geometry blueprint)
      render_image    : base64 PNG (satellite or 3D tiles screenshot — color reference)
      style_prompt    : str (user's style description, e.g. "pixel art, RPG game map")
      location        : str (optional; used in prompt context)
      lat, lon        : float (for disk cache)
      skip_cache      : bool
    """
    if not TOKENROUTER_API_KEY:
        return jsonify({"error": "TOKENROUTER_API_KEY not configured"}), 500

    data = request.get_json() or {}
    wb_b64 = data.get("whitebox_image", "")
    rnd_b64 = data.get("render_image", "")
    style = data.get("style_prompt", "").strip()
    location = data.get("location", "city").strip()
    lat = data.get("lat")
    lon = data.get("lon")
    skip_cache = data.get("skip_cache", False)

    if not rnd_b64:
        return jsonify({"error": "render_image is required"}), 400

    # Cache key: lat/lon + style hash + model version
    import hashlib
    style_hash = hashlib.md5((style + GEMINI_MODEL).encode()).hexdigest()[:8] if style else "gemini"
    cache_dir = os.path.join(os.path.dirname(__file__), "cache", "global_pixel")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = None
    if lat is not None and lon is not None:
        cache_path = os.path.join(
            cache_dir, f"{float(lat):.4f}_{float(lon):.4f}_{style_hash}_v5.png"
        )

    if not skip_cache and cache_path and os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode()
        return jsonify({"image": f"data:image/png;base64,{encoded}", "cached": True})

    try:
        # --- Prepare images --------------------------------------------------
        render_img = _b64_to_image(rnd_b64)
        render_img = _resize_fit(render_img, 512)
        render_b64 = _image_to_b64(render_img)

        safe_loc = location.encode("ascii", "ignore").decode().strip() or "urban area"

        # --- Build prompt following isometric-nyc's multi-image strategy -----
        style_desc = style if style else (
            "isometric pixel art, SimCity 3000 aesthetic, "
            "sharp aliased edges, limited palette, dithering"
        )

        prompt = (
            f"Image 1 is a depth map (whitebox) showing the building footprints "
            f"and heights of {safe_loc}. Use this as the BLUEPRINT for all building "
            f"shapes, positions, and relative sizes. Every white shape in Image 1 "
            f"must appear as a building in the output, at exactly the same position.\n\n"
            f"Image 2 is a satellite/3D render of {safe_loc}. Use this as a COLOR "
            f"and TEXTURE reference: sample real-world roof colors, road colors, "
            f"and greenery colors from this image. Pay attention to building roof "
            f"colors, road layouts, and vegetation patterns.\n\n"
            f"**Task:** Create an isometric pixel art city scene of {safe_loc} that:\n"
            f"1. Uses Image 1 as the building layout blueprint — every building must "
            f"be in the correct position\n"
            f"2. Uses Image 2 for real-world colors and textures\n"
            f"3. Follows the user's style description below\n\n"
            f"**Style Description (user input):**\n"
            f"{style_desc}\n\n"
            f"**Critical Rules:**\n"
            f"- Clean isometric pixel art, sharp aliased edges, 2:1 pixel slope\n"
            f"- Every building from Image 1 must appear in the output at correct position\n"
            f"- Do NOT copy the blurry/realistic look of Image 2 — redraw as clean pixel art\n"
            f"- Single unified scene, no text labels, no watermarks\n\n"
            f"**Style:** (((Isometric pixel art:1.6))), (orthographic projection:1.5), "
            f"(sharp crisp edges:1.3), ({style_desc}:1.4), neutral color palette, "
            f"bird's-eye view.\n\n"
            f"**Negative:** NO photographic textures, NO blurry upscaling, "
            f"NO untextured white/grey blocks, NO side-by-side panels, NO text labels."
        )

        # --- Build content array ---------------------------------------------
        content = [{"type": "text", "text": prompt}]

        # Image 1: Whitebox (geometry blueprint)
        if wb_b64:
            wb_img = _b64_to_image(wb_b64)
            wb_img = _resize_fit(wb_img, 512)
            wb_b64_clean = _image_to_b64(wb_img)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{wb_b64_clean}"},
            })

        # Image 2: Render (color/texture reference)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{render_b64}"},
        })

        messages = [{"role": "user", "content": content}]

        # --- Call Gemini via TokenRouter -------------------------------------
        result_bytes = _call_gemini(messages)

        # --- Save to cache ---------------------------------------------------
        if cache_path:
            with open(cache_path, "wb") as f:
                f.write(result_bytes)

        encoded = base64.b64encode(result_bytes).decode()
        return jsonify({"image": f"data:image/png;base64,{encoded}"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/check-pixel-cache")
def check_pixel_cache():
    """Lightweight cache check — avoids loading 3D Tiles / OSM if pixel map exists."""
    import hashlib
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    style = request.args.get("style", "")
    if not lat or not lon:
        return jsonify({"cached": False})
    style_hash = hashlib.md5((style + GEMINI_MODEL).encode()).hexdigest()[:8] if style else "gemini"
    cache_dir = os.path.join(os.path.dirname(__file__), "cache", "global_pixel")
    cache_path = os.path.join(cache_dir, f"{float(lat):.4f}_{float(lon):.4f}_{style_hash}_v5.png")
    if os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode()
        return jsonify({"cached": True, "image": f"data:image/png;base64,{encoded}"})
    return jsonify({"cached": False})


if __name__ == "__main__":
    port = int(os.environ.get("GLOBAL_PORT", 5002))
    print(f"Global pipeline server → http://localhost:{port}")
    print("  POST /api/whitebox        — OSM whitebox for any lat/lon")
    print("  POST /api/generate-three  — whitebox + render + style → Gemini 3.1 Flash → pixel art")
    app.run(debug=True, port=port, host="0.0.0.0", threaded=True)
