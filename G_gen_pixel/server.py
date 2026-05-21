"""
Pixel Map Generator - Flask backend
  /api/config           → returns Google Maps API key for the frontend 3D Tiles viewer
  /api/geocode          → geocodes a location string to lat/lon
  /api/generate         → converts a 3D tiles render (PNG base64) to pixel art via wan2.7-image-pro
  /api/run-geopixel       → saves pixel art and launches GeoPixel map pipeline (async)
  /api/geopixel-status/<id> → poll GeoPixel job status
"""

import base64
import io
import json
import os
import subprocess
import tempfile
import threading
import uuid

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

load_dotenv()

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")

# ---- Proxy helpers ----
def _get_proxies():
    """Proxy for external APIs (Google) that need it."""
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or \
            os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy")
    return {"http": proxy, "https": proxy} if proxy else {}

def _fetch_without_proxy(url, timeout=60):
    """Fetch URL without proxy — used for China-internal OSS domains (Aliyun)
    that break when routed through Clash."""
    return requests.get(url, timeout=timeout, proxies={"http": None, "https": None})

# ---- Hyperparameters (single source of truth: hyperparams.json) ----
_hp_path = os.path.join(os.path.dirname(__file__), "hyperparams.json")
with open(_hp_path) as _f:
    _HP = json.load(_f)
_grid_cells = int(_HP.get("GRID_CELLS", 64))
_canvas_size = int(_HP.get("CANVAS_SIZE", 1024))
MAP_IMAGE_SIZE_K = _canvas_size // (_grid_cells * 4)  # 64→4, 128→2, 256→1
if MAP_IMAGE_SIZE_K not in (1, 2, 4):
    raise ValueError(
        f"hyperparams.json: CANVAS_SIZE/GRID_CELLS gives MAP_IMAGE_SIZE_K={MAP_IMAGE_SIZE_K}, "
        "must be 1/2/4. Valid combos: GRID_CELLS=64(→K=4), 128(→K=2), 256(→K=1) with CANVAS_SIZE=1024."
    )

GEOPIXEL_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "GeoPixel")
)
GEOPIXEL_MAP_ENTRY = os.path.join(
    GEOPIXEL_ROOT, "generators", "map", "src", "index-from-image.mjs"
)

# In-memory job tracker  {job_id -> {"status": "running|done|error", "runDir": str, "log": str}}
_geopixel_jobs: dict = {}

app = Flask(__name__, static_folder="dist", static_url_path="")
CORS(app)


@app.route("/")
def index():
    try:
        return send_from_directory("dist", "index.html")
    except Exception:
        return (
            "<p>Frontend not built yet. Run <code>npm run build</code> in G_gen_pixel/ "
            "or use <code>npm run dev</code> (port 5173) for development.</p>",
            404,
        )


@app.route("/api/config")
def config():
    return jsonify({"google_maps_api_key": GOOGLE_MAPS_API_KEY})


_tutorial_cache = None


@app.route("/api/tutorial")
def tutorial():
    global _tutorial_cache
    if _tutorial_cache is None:
        import json
        tutorial_path = os.path.join(os.path.dirname(__file__), "dist", "tutorial_content.json")
        with open(tutorial_path, "r", encoding="utf-8") as f:
            _tutorial_cache = json.load(f)
    return jsonify(_tutorial_cache)


@app.route("/api/tile-proxy")
def tile_proxy():
    url = request.args.get("url", "")
    if not url or "tile.googleapis.com" not in url:
        return jsonify({"error": "Invalid URL"}), 400
    try:
        r = requests.get(url, timeout=30, stream=True, proxies=_get_proxies() or None)
        content_type = r.headers.get("content-type", "application/octet-stream")
        return Response(r.iter_content(chunk_size=65536), status=r.status_code, content_type=content_type)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/satellite")
def satellite():
    """Proxy Google Static Maps API satellite image to avoid CORS and hide API key.
    Caches results by rounded lat/lon so repeated loads skip the API call."""
    lat = request.args.get("lat", "")
    lon = request.args.get("lon", "")
    zoom = request.args.get("zoom", "18")
    size = request.args.get("size", "640")
    scale = request.args.get("scale", "2")
    if not lat or not lon:
        return jsonify({"error": "lat and lon required"}), 400
    if not GOOGLE_MAPS_API_KEY:
        return jsonify({"error": "GOOGLE_MAPS_API_KEY not configured"}), 500

    # Round to 4 decimals (~11 m) for cache key — same location hits cache
    key_lat = f"{float(lat):.4f}"
    key_lon = f"{float(lon):.4f}"
    cache_dir = os.path.join(os.path.dirname(__file__), "cache", "satellite")
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = os.path.join(cache_dir, f"{key_lat}_{key_lon}_z{zoom}.png")

    # Serve from cache if available (skip when refresh=1)
    refresh = request.args.get("refresh", "0")
    if refresh != "1" and os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            return Response(f.read(), status=200, content_type="image/png",
                            headers={"X-Cache": "HIT"})

    try:
        url = (
            f"https://maps.googleapis.com/maps/api/staticmap"
            f"?center={key_lat},{key_lon}&zoom={zoom}&size={size}x{size}&scale={scale}"
            f"&maptype=satellite&key={GOOGLE_MAPS_API_KEY}"
        )
        r = requests.get(url, timeout=15, proxies=_get_proxies() or None)
        if r.status_code != 200:
            return jsonify({"error": f"Google API returned {r.status_code}"}), 502

        # Save to cache
        with open(cache_path, "wb") as f:
            f.write(r.content)

        return Response(r.content, status=200, content_type=r.headers.get("content-type", "image/png"))
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/geocode")
def geocode():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"error": "No location query provided"}), 400
    if not GOOGLE_MAPS_API_KEY:
        return jsonify({"error": "GOOGLE_MAPS_API_KEY not configured in .env"}), 500
    try:
        import googlemaps
        gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY, timeout=10, retry_timeout=10)
        results = gmaps.geocode(q)
        if not results:
            return jsonify({"error": f"Location not found: {q}"}), 404
        loc = results[0]["geometry"]["location"]
        return jsonify({
            "lat": loc["lat"],
            "lon": loc["lng"],
            "address": results[0]["formatted_address"],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate", methods=["POST"])
def generate():
    if not DASHSCOPE_API_KEY:
        return jsonify({"error": "DASHSCOPE_API_KEY not configured in .env"}), 500

    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    image_data = data.get("image", "")
    location_name = data.get("location", "city")
    style_prompt = data.get("style_prompt", "").strip()
    image_type = data.get("image_type", "photo3d")  # 'photo3d' | 'pixel'
    lat = data.get("lat")
    lon = data.get("lon")
    skip_cache = data.get("skip_cache", False)
    if not image_data:
        return jsonify({"error": "No image data provided"}), 400

    if "," in image_data:
        image_data = image_data.split(",", 1)[1]

    # Cache check
    import hashlib as _hashlib
    cache_path = None
    if lat is not None and lon is not None:
        style_hash = _hashlib.md5(style_prompt.encode()).hexdigest()[:8] if style_prompt else "default"
        cache_dir = os.path.join(os.path.dirname(__file__), "cache", "pixel_map")
        os.makedirs(cache_dir, exist_ok=True)
        cache_path = os.path.join(cache_dir, f"{float(lat):.4f}_{float(lon):.4f}_{image_type}_{style_hash}.png")

    if not skip_cache and cache_path and os.path.exists(cache_path):
        with open(cache_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode()
        return jsonify({"image": f"data:image/png;base64,{encoded}", "cached": True})

    tmp_path = None
    try:
        from PIL import Image
        from dashscope.aigc.image_generation import ImageGeneration
        from dashscope.api_entities.dashscope_response import Message

        image_bytes = base64.b64decode(image_data)
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        if img.size != (1024, 1024):
            img = img.resize((1024, 1024), Image.Resampling.LANCZOS)

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            img.save(f, format="PNG")
            tmp_path = f.name

        default_style = (
            "isometric 45 degree bird's-eye view, classic 32-bit city builder graphics, "
            "256-color indexed palette, heavy dithering on shadows and gradients, "
            "sharp aliased pixel edges on buildings and roads, "
            "repeating grid textures for windows and facades, "
            "tiny pixel-sprite cars on roads, hard directional shadows"
        )
        style = style_prompt if style_prompt else default_style
        # Use a neutral location label to avoid content moderation false positives
        import unicodedata
        _safe_loc = location_name.encode('ascii', 'ignore').decode().strip() or "urban area"
        if image_type == "pixel":
            prompt = (
                f"Refine this pixel art map of {_safe_loc}. "
                "Keep the existing pixel art style and spatial layout. "
                "Widen roads so they are clearly passable by characters. "
                f"Style: {style}."
            )
        else:
            prompt = (
                f"Transform this overhead isometric 3D view of an {_safe_loc} "
                "into a pixel art map. "
                "Preserve the exact building layout, roads, parks, and spatial arrangement. "
                f"Style: {style}."
            )

        message = Message(
            role="user",
            content=[
                {"text": prompt},
                {"image": f"file://{tmp_path}"},
            ],
        )

        # DashScope is Alibaba Cloud China — must NOT go through proxy
        _saved_proxies = {}
        for _k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
            if _k in os.environ:
                _saved_proxies[_k] = os.environ.pop(_k)
        try:
            rsp = ImageGeneration.call(
                model="wan2.7-image-pro",
                api_key=DASHSCOPE_API_KEY,
                messages=[message],
                watermark=False,
                n=1,
                size="1K",
            )
        finally:
            os.environ.update(_saved_proxies)

        if rsp.status_code != 200:
            return jsonify({"error": f"DashScope error {rsp.status_code}: {rsp.message}"}), 500

        result_url = rsp.output.choices[0].message.content[0]["image"]
        r = _fetch_without_proxy(result_url)
        encoded = base64.b64encode(r.content).decode()

        # Save to cache
        if cache_path:
            with open(cache_path, "wb") as f:
                f.write(r.content)

        return jsonify({"image": f"data:image/png;base64,{encoded}"})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


GEOPIXEL_API = "http://localhost:3100"


@app.route("/api/npc-generate", methods=["POST"])
def npc_generate():
    """Proxy NPC generation request to GeoPixel server."""
    try:
        resp = requests.post(
            f"{GEOPIXEL_API}/api/npc/generate",
            json=request.get_json(),
            timeout=90,
        )
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _find_cached_run(location, prompt=""):
    """Scan GeoPixel output/maps/ for a completed run matching the given location and prompt."""
    maps_dir = os.path.join(GEOPIXEL_ROOT, "output", "maps")
    if not os.path.isdir(maps_dir):
        return None
    try:
        for entry in os.listdir(maps_dir):
            meta_path = os.path.join(maps_dir, entry, "metadata.json")
            if not os.path.isfile(meta_path):
                continue
            try:
                with open(meta_path) as _f:
                    meta = json.loads(_f.read())
            except Exception:
                continue
            if meta.get("error") or not meta.get("completedAt"):
                continue
            user_prompt = meta.get("userPrompt", "")
            stored_style = meta.get("stylePrompt", "")
            if not (location in user_prompt or user_prompt.startswith(location)):
                continue
            # Different prompt => considered a different world
            req_prompt = prompt.strip() if prompt else ""
            if req_prompt != (stored_style or ""):
                continue
            world_dir = os.path.join(GEOPIXEL_ROOT, "output", "worlds", entry)
            if os.path.isdir(world_dir):
                return os.path.join(maps_dir, entry)
    except Exception:
        pass
    return None


@app.route("/api/run-geopixel", methods=["POST"])
def run_geopixel():
    """
    Accepts { image: "data:image/png;base64,...", location: "同济大学" }.
    Saves the pixel art PNG and kicks off the GeoPixel map pipeline in a background thread.
    Returns { jobId } immediately; poll /api/geopixel-status/<jobId> for progress.
    If a completed run for the same location exists, reuses it immediately.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body"}), 400

    image_data = data.get("image", "")
    location = data.get("location", "city")
    prompt = data.get("prompt", "")
    if not image_data:
        return jsonify({"error": "No image data"}), 400

    if "," in image_data:
        image_data = image_data.split(",", 1)[1]

    if not os.path.isdir(GEOPIXEL_ROOT):
        return jsonify({"error": f"GeoPixel not found at {GEOPIXEL_ROOT}"}), 500

    # ── Cache check: reuse completed run for same location + prompt ──
    cached_run_dir = _find_cached_run(location, prompt)
    if cached_run_dir:
        world_id = os.path.basename(cached_run_dir)
        job_id = "cached-" + world_id[:12]
        _geopixel_jobs[job_id] = {
            "status": "done",
            "runDir": cached_run_dir,
            "log": "",
            "cached": True,
        }
        try:
            requests.post(
                "http://localhost:3100/api/world/select",
                json={"worldId": world_id},
                timeout=5,
            )
        except Exception:
            pass
        return jsonify({"jobId": job_id, "cached": True})

    # Save pixel art to GeoPixel input staging directory
    input_dir = os.path.join(GEOPIXEL_ROOT, "output", "pixel_input")
    os.makedirs(input_dir, exist_ok=True)
    image_path = os.path.join(input_dir, "pixel_map.png")
    with open(image_path, "wb") as f:
        f.write(base64.b64decode(image_data))

    job_id = uuid.uuid4().hex[:8]
    _geopixel_jobs[job_id] = {"status": "running", "runDir": None, "log": ""}

    def _run():
        try:
            env = os.environ.copy()
            # Inject GeoPixel .env so Node.js module-level constants get the right values
            geopixel_env_path = os.path.join(GEOPIXEL_ROOT, ".env")
            if os.path.exists(geopixel_env_path):
                with open(geopixel_env_path) as _f:
                    for _line in _f:
                        _line = _line.strip()
                        if _line and not _line.startswith("#") and "=" in _line:
                            _k, _v = _line.split("=", 1)
                            env.setdefault(_k.strip(), _v.strip())
            env["MAP_IMAGE_SIZE_K"] = str(MAP_IMAGE_SIZE_K)
            cmd = ["node", GEOPIXEL_MAP_ENTRY, "--image", image_path, location]
            if prompt and prompt.strip():
                cmd.extend(["--prompt", prompt.strip()])
            result = subprocess.run(
                cmd,
                cwd=GEOPIXEL_ROOT,
                capture_output=True,
                text=True,
                timeout=900,
                env=env,
            )
            combined = result.stdout + "\n" + result.stderr
            # Extract RUN_DIR from stdout line "  RUN_DIR:    /path"
            run_dir = None
            for line in combined.splitlines():
                if "RUN_DIR:" in line:
                    run_dir = line.split("RUN_DIR:")[-1].strip()
                    break
            if result.returncode == 0:
                _geopixel_jobs[job_id]["status"] = "done"
                _geopixel_jobs[job_id]["runDir"] = run_dir
                # Auto-load the new world in GeoPixel game server
                if run_dir:
                    world_id = os.path.basename(run_dir)
                    # Save prompt metadata alongside world for UI dropdown
                    world_dir = os.path.join(GEOPIXEL_ROOT, "output", "worlds", world_id)
                    os.makedirs(world_dir, exist_ok=True)
                    _save_world_prompt(world_dir, location, prompt)
                    try:
                        requests.post(
                            "http://localhost:3100/api/world/select",
                            json={"worldId": world_id},
                            timeout=5,
                        )
                    except Exception:
                        pass
            else:
                _geopixel_jobs[job_id]["status"] = "error"
                _geopixel_jobs[job_id]["log"] = combined[-3000:]
        except subprocess.TimeoutExpired:
            _geopixel_jobs[job_id]["status"] = "error"
            _geopixel_jobs[job_id]["log"] = "Timeout after 15 minutes"
        except Exception as e:
            _geopixel_jobs[job_id]["status"] = "error"
            _geopixel_jobs[job_id]["log"] = str(e)

    threading.Thread(target=_run, daemon=True).start()
    return jsonify({"jobId": job_id})


@app.route("/api/geopixel-status/<job_id>")
def geopixel_status(job_id):
    job = _geopixel_jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/api/worlds")
def list_worlds():
    """List generated worlds — scan GeoPixel output/worlds/ directly."""
    worlds_dir = os.path.join(GEOPIXEL_ROOT, "output", "worlds")
    worlds = []
    if os.path.isdir(worlds_dir):
        for name in sorted(os.listdir(worlds_dir), reverse=True):
            d = os.path.join(worlds_dir, name)
            if not os.path.isdir(d):
                continue
            # Read world name from config
            for cfg_name in ("config/world.json", "world.json"):
                cfg_path = os.path.join(d, cfg_name)
                if not os.path.isfile(cfg_path):
                    continue
                try:
                    with open(cfg_path) as f:
                        cfg = json.load(f)
                    wname = cfg.get("worldName", name)
                    wprompt = cfg.get("stylePrompt", "")
                    worlds.append({
                        "id": name,
                        "worldName": wname,
                        "prompt": wprompt,
                    })
                    break
                except Exception:
                    pass
    # Try to get current world from GeoPixel server
    current_world = None
    try:
        r = requests.get("http://localhost:3100/api/world/worlds", timeout=3)
        current_world = r.json().get("currentWorldId")
    except Exception:
        pass
    return jsonify({"worlds": worlds, "currentWorldId": current_world})


@app.route("/api/world/switch", methods=["POST"])
def switch_world():
    """Select a world — proxy to GeoPixel server."""
    data = request.get_json() or {}
    world_id = data.get("worldId", "")
    if not world_id:
        return jsonify({"error": "worldId required"}), 400
    try:
        r = requests.post(
            "http://localhost:3100/api/world/select",
            json={"worldId": world_id},
            timeout=5,
        )
        return jsonify(r.json())
    except Exception as e:
        return jsonify({"error": f"GeoPixel server unreachable: {e}"}), 503


def _save_world_prompt(world_dir, location, prompt):
    """Save location + user prompt to world directory for UI display."""
    prompt_path = os.path.join(world_dir, "prompt.json")
    try:
        with open(prompt_path, "w") as f:
            json.dump({
                "location": location or "",
                "prompt": (prompt or "").strip(),
            }, f, ensure_ascii=False)
    except Exception:
        pass


def _read_world_prompt(world_dir):
    """Read location + prompt from world directory. Returns dict or None."""
    prompt_path = os.path.join(world_dir, "prompt.json")
    if not os.path.isfile(prompt_path):
        return None
    try:
        with open(prompt_path) as f:
            return json.load(f)
    except Exception:
        return None


def _start_geopixel_dev():
    """Spawn GeoPixel client+server dev processes in background."""
    global _geopixel_dev_proc
    _geopixel_dev_proc = None
    try:
        _geopixel_dev_proc = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=GEOPIXEL_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"  GeoPixel dev started (PID {_geopixel_dev_proc.pid}) → http://localhost:3200")
    except Exception as e:
        print(f"  [warn] Could not start GeoPixel dev server: {e}")


import atexit

@atexit.register
def _cleanup():
    if _geopixel_dev_proc and _geopixel_dev_proc.poll() is None:
        _geopixel_dev_proc.terminate()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    _start_geopixel_dev()
    print(f"Starting server on http://localhost:{port}")
    print("  Open http://localhost:5173 (after npm run dev in G_gen_pixel/)")
    app.run(debug=True, port=port, host="0.0.0.0", threaded=True)
