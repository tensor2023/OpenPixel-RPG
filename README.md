<p align="center">
  <h1 align="center">OpenPixel-RPG</h1>
  <p align="center"><strong>AI-powered pixel-art open-world JRPG — turn any place on Earth into a playable pixel world.</strong></p>
</p>

<p align="center">
  <a href="./GeoPixel/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/Gemini-2.5%20%7C%203.1-4285F4?logo=google&logoColor=white" alt="Gemini 2.5 / 3.1">
  <img src="https://img.shields.io/badge/Baidu%20Maps-API-2932E1?logo=baidu&logoColor=white" alt="Baidu Maps API">
  <img src="https://img.shields.io/badge/Status-Alpha-orange" alt="Alpha">
</p>

---

## Overview

Turn any place on Earth into an interactive pixel-art JRPG.

**OpenPixel-RPG** is an AI-powered pixel-art open-world UGC game. Input any location name, or upload your own photo, describe the art style you want, and OpenPixel-RPG generates a complete interactive pixel map with local NPCs. Every character has their own memory, personality, and social relationships — they make decisions, talk to each other, and produce emergent narratives no one scripted. You can also play "god" at any time: inject events, edit character memories or traits, and watch the world shift in response.

Born from [isometric.nyc](https://isometric.nyc), this project replaces the NYC-specific data pipeline with globally available OSM + satellite + 3D Tiles, and deeply integrates [WorldX](https://github.com/YGYOOO/WorldX)'s AI world engine.

![Game Tutorial](video/教程.png)

> Game tutorial here

---

## Three Modes

### Mode 1 — Upload & Play

Upload your own photo, and OpenPixel-RPG turns it into a pixel-art JRPG world.

![Mode 1 Demo](video/mode1_demo.gif)

> [Watch full video](https://tensor2023.github.io/xueqinggao.github.io/video/mode1_demo.mp4)

**How it works:**
1. Select a local image from your device.
2. The 3D View shows your image — set a **Pixel Style** prompt, then click **Generate Pixel Map**.
3. Once the pixel map loads, click **Generate GeoPixel Game** and wait.
4. Click **Enter World** (or the browser loads it automatically) to start playing.

### Mode 2 — NYC Landmark Exploration

Enter a Manhattan landmark name, and OpenPixel-RPG fetches pre-generated pixel tiles from [isometric.nyc](https://isometric.nyc) to build an interactive map.

![Mode 2 Demo](video/demo.gif)

> [Watch full video](https://tensor2023.github.io/xueqinggao.github.io/video/Demo2.mp4)

**How it works:**
1. Click **City Map**, then input a location (e.g. Times Square, Central Park, Empire State Building, Brooklyn Bridge, and many more).
2. Wait for the tile to load.
3. Select **Fast Mode** (bottom-right), then click **Generate GeoPixel Game**.
4. Once loaded, click **Enter World**.

### Mode 3 — Anywhere on Earth

Input any address on Earth, and OpenPixel-RPG generates an interactive pixel map using OSM whitebox + satellite imagery + AI style transfer.

![Mode 3 Demo](video/mode3_demo.gif)

> [Watch full video](https://tensor2023.github.io/xueqinggao.github.io/video/mode3_demo.mp4)

**How it works:**
1. Input an address and click **Load Map**.
2. The 3D View loads a satellite image. Drag to fine-tune the area. Set a **Pixel Style** prompt.
3. Click **Generate Global Map** — the backend runs a three-step pipeline:
   - **Step 1 — OSM Whitebox**: Queries the OpenStreetMap Overpass API for all building footprints with height/levels data. Renders an isometric PNG showing building roof faces (light grey) and walls (shaded by orientation). Contains only building geometry — no roads, water, or labels. Serves as the geometric blueprint.
   - **Step 2 — 3D Tiles Render**: Captures a Google 3D Tiles isometric screenshot for real-world color/texture reference.
   - **Step 3 — AI Pixel Map**: Feeds the whitebox (geometry), 3D Tiles render (color), and style prompt to Gemini (`gemini-3.1-flash-image-preview`), which generates a pixel-art map respecting the building layout of the whitebox and the color palette of the real-world view.
4. Click **Generate WorldX Game** to build the playable world with NPCs.
5. Click **Enter World** (or it loads automatically) to start playing.

| Mode | Description | Status |
|------|-------------|--------|
| **Mode 1** — Upload & Play | Upload a photo → AI generates pixel map → playable JRPG world. | Done |
| **Mode 2** — NYC Exploration | Input an NYC landmark → fetch isometric.nyc pixel tile → GeoPixel pipeline. | Done |
| **Mode 3** — Anywhere on Earth | Input any global address → OSM whitebox + satellite + Google 3D Tiles → AI pixel map → playable world. | Done |

---

## Getting Started (port 5173)

```bash
# 1. Enter the G_gen_pixel directory
cd G_gen_pixel

# 2. Install frontend dependencies
npm install

# 3. Install Python dependencies
pip install -r requirements.txt

# 4. Configure API keys
cp .env.example .env
# Edit .env with your Google Maps and DashScope API keys

# 5. Start all services
# Terminal 1: Vite frontend (port 5173)
npm run dev

# Terminal 2: Main backend (port 5001)
python server.py

# Terminal 3: Global map backend (port 5002, for Mode 3)
python global_server.py
```

Open `http://localhost:5173` in your browser, choose a mode, and go.

---

## AI Architecture

### LLM Models — Gemini

All AI workloads run on Google Gemini models via TokenRouter. Each role uses a specialized model:

| Role | Model | Purpose |
|------|-------|---------|
| **Orchestrator** | `gemini-2.5-pro-preview` | One-shot world design from a user prompt — creates character profiles, zones, world rules, and action templates. |
| **Image Generation** | `gemini-3.1-flash-image-preview` | Map pixel-art generation (Mode 1/3) + character sprite sheet generation. |
| **Vision Review** | `gemini-3.1-pro-preview` | Quality review pass — checks generated map images for artifacts and consistency before they go live. |
| **Simulation** | `gemini-2.5-flash-preview` | Runtime character behavior — action decisions, multi-turn dialogue, reflection, and memory consolidation. |
| **Character Sprites** | `gemini-2.5-flash-image` | NPC sprite sheet generation for in-game characters (walk cycles, idle poses). |

### Custom Agent Simulation System

No external agent frameworks (LangGraph, LangChain) — fully custom perceive-decide-act loop running tick-by-tick for every NPC:

| Component | Responsibility |
|-----------|---------------|
| `SimulationEngine` | Drives the tick loop — each tick, every NPC perceives, decides, acts, and remembers. |
| `Perceiver` | Builds each NPC's perception context from nearby entities, recent events, and world state. |
| `DecisionMaker` | Calls the Simulation LLM to select an action (move, talk, emote, use item, etc.) based on personality + perception. |
| `DialogueGenerator` | Produces multi-turn NPC-to-NPC and NPC-to-player conversations with memory-aware context. |
| `MemoryManager` | Stores individual memories, applies decay over time, and periodically consolidates related memories via LLM reflection. |
| `EmotionManager` | Tracks valence and arousal per character, updated by events and dialogue outcomes. |

Each NPC autonomously: **perceives** the environment → **decides** what to do → **executes** the action → **forms memories** → **reflects** on experiences. You can also play "god" at any time: inject events, edit memories or traits, and watch the social dynamics shift in response.

**NPC Generation flow:** Click **Spawn NPC** in the game world → input location → the Orchestrator calls Gemini to design a character with local knowledge, personality, and backstory → sprite generated via `gemini-2.5-flash-image` → NPC appears on the map (~30s). Walk up and press **Z** to interact. Click **Spawn NPC** again to edit or delete existing NPCs.

### OSM Whitebox — Global Map Generation Pipeline (Mode 3)

When you generate a pixel map for any location on Earth, the first step is building the **OSM whitebox**:

- Queries the **OpenStreetMap Overpass API** for all building footprints in the selected area (coordinates + `height` / `building:levels` tags).
- Renders an isometric PNG at 1280×960 with the same camera angles as the 3D Tiles viewer:
  - **Roof faces**: light grey with outlines for shape clarity.
  - **Wall faces**: shaded by orientation — right-facing walls get medium grey, left-facing walls darker grey.
  - **Background**: near-black for contrast.
- **Contains**: building geometry only — footprints, heights, and 3D shapes. No roads, water, vegetation, labels, or terrain.
- **Why it's needed**: The whitebox acts as a **geometric blueprint** for the AI. When Gemini generates the pixel-art map, it's instructed to place every white shape as a building at exactly the same position. Without this constraint, AI image generation would produce aesthetically pleasing but geographically inaccurate buildings. The whitebox ensures the output preserves real-world building layouts.

### Baidu Maps API

The Baidu Maps API provides street-level scene context for the reference collage pipeline:

- **Baidu Maps Static Image API** (`staticimage/v2`): Given a coordinate, fetches a street-block scene image (实景图) at zoom level 17.
- Used in the `Map_gen_RPG` pipeline to build a reference collage — satellite view on the left, Baidu street scene on the right — giving the AI both top-down and ground-level visual references.
- Optional — the pipeline continues gracefully if the `BAIDU_MAP_AK` key is not configured.
- Legacy: early versions used Baidu Maps WebGL API to capture 3D building whitebox screenshots (NYC-only, deprecated in favor of OSM Overpass for global coverage).

---

## Acknowledgments

This project stands on the shoulders of two incredible open-source projects:

- **[isometric-nyc](https://github.com/cannoneyed/isometric-nyc)** ([isometric.nyc](https://isometric.nyc)) — The first open-source project to combine AI generation with isometric pixel city maps at scale. It proved "vibe-engineering" could work, and its NYC tile pipeline is the foundation of Mode 2.
- **[WorldX](https://github.com/YGYOOO/WorldX)** — The AI world engine that powers character generation, dialogue, memory, and emergent narrative. One sentence in, a living world out.

OpenPixel-RPG extends isometric-nyc's NYC pipeline to global coverage and integrates GeoPixel's character simulation for a complete AI JRPG experience.

---

## Project Structure

```
OpenPixel-RPG/
├── G_gen_pixel/            # Mode 3 frontend + backends (5173 / 5001 / 5002)
│   ├── server.py              # Main API: geocode, satellite, pixel generation, WorldX jobs
│   ├── global_server.py       # Mode 3 API: OSM whitebox + three-image pipeline
│   ├── whitebox/              # OSM Overpass global whitebox generation
│   ├── src/                   # Vite frontend (main.js, three-column UI)
│   ├── index.html             # Three-column layout (View+Pixel / Global / Game)
│   ├── hyperparams.json       # Unified config (grid cells, canvas size, etc.)
│   └── cache/                 # Satellite image disk cache
├── GeoPixel/                # AI world engine (Mode 2 NYC + NPC + character simulation)
│   ├── client/                # React + Phaser game client
│   ├── server/                # Node.js backend API (Express + WebSocket + SQLite)
│   ├── orchestrator/          # LLM world orchestration engine
│   └── generators/            # Map & character image generation pipeline
├── WorldX-main/             # WorldX game engine (map pipeline, game runtime)
│   ├── generators/map/        # index-from-image.mjs (Steps 2–6: compress → TMJ output)
│   └── client/                # WorldX React + Phaser frontend
├── Map_gen_RPG/             # Satellite → pixel map pipeline scripts (legacy/experimental)
├── Blog/                    # Documentation & tutorials (Chinese)
├── Paper/                   # Academic paper draft
├── ref/                     # Reference projects (isometric-nyc, etc.)
└── video/                   # Demo videos & GIFs
```

---

## License

MIT © OpenPixel-RPG contributors
