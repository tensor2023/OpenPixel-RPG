import dotenv from "dotenv";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
} from "fs";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
dotenv.config({ path: join(ROOT, ".env") });

import { designWorld } from "./world-designer.mjs";
import { generateConfigs } from "./config-generator.mjs";

const MAP_GENERATION_TIMEOUT_MS = parseInt(process.env.MAP_GENERATION_TIMEOUT_MS || "900000", 10);
const CHARACTER_GENERATION_TIMEOUT_MS = parseInt(
  process.env.CHARACTER_GENERATION_TIMEOUT_MS || "300000",
  10,
);
const KEEP_GENERATION_ARTIFACTS = process.env.KEEP_GENERATION_ARTIFACTS === "1";

/**
 * 阶段 F：合并 Map_gen_RPG 产出的美术风格到 worldDesign，供地图 Step1 使用。
 * 优先级：环境变量 ART_STYLE_PROMPT > MAP_GEN_RUNTIME_DIR/prompt_context.json
 */
function mergeArtStyleFromMapGenRuntime(root, worldDesign) {
  if (process.env.ART_STYLE_PROMPT?.trim()) {
    worldDesign.artStylePrompt = process.env.ART_STYLE_PROMPT.trim();
    console.log("[Map_gen] artStylePrompt 来自 ART_STYLE_PROMPT");
    return;
  }
  const runtimeDir =
    process.env.MAP_GEN_RUNTIME_DIR?.trim() || join(root, "..", "Map_gen_RPG", "runtime-refs");
  const ctxPath = join(runtimeDir, "prompt_context.json");
  if (!existsSync(ctxPath)) {
    return;
  }
  try {
    const pc = JSON.parse(readFileSync(ctxPath, "utf-8"));
    if (typeof pc.art_style_prompt === "string" && pc.art_style_prompt.trim()) {
      worldDesign.artStylePrompt = pc.art_style_prompt.trim();
      console.log(`[Map_gen] 已从 prompt_context.json 合并 artStylePrompt（${ctxPath}）`);
    }
  } catch (e) {
    console.warn("[Map_gen] 读取 prompt_context.json 失败:", e?.message || e);
  }
}

async function main() {
  const userPrompt = process.argv.slice(2).join(" ");
  if (!userPrompt) {
    console.error('Usage: node orchestrator/src/index.mjs "描述你想创造的世界"');
    console.error(
      'Example: node orchestrator/src/index.mjs'
    );
    process.exit(1);
  }

  const worldId = `world_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const worldDir = join(ROOT, "output/worlds", worldId);
  mkdirSync(worldDir, { recursive: true });
  const logsDir = join(worldDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║         GeoPixel: One Sentence, One World       ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`World ID: ${worldId}`);
  console.log(`Prompt:   ${userPrompt}\n`);

  console.log("━━━ Phase 1: Designing World ━━━");
  const worldDesign = await designWorld(userPrompt);
  mergeArtStyleFromMapGenRuntime(ROOT, worldDesign);
  writeFileSync(join(worldDir, "world-design.json"), JSON.stringify(worldDesign, null, 2));

  const mapDir = join(worldDir, "map");
  mkdirSync(mapDir, { recursive: true });
  const charsDir = join(worldDir, "characters");
  mkdirSync(charsDir, { recursive: true });
  const mapScript = join(ROOT, "generators/map/src/index.mjs");
  const charScript = join(ROOT, "generators/character/src/index.mjs");

  console.log("\n━━━ Phase 2 + Phase 3: Generating Map and Characters in Parallel ━━━");
  const [mapResult, characterResult] = await Promise.allSettled([
    generateMapAssets({
      mapDir,
      worldDir,
      logsDir,
      mapScript,
      mapDescription: worldDesign.mapDescription,
      originalPrompt: userPrompt,
    }),
    generateCharacterAssets({
      charsDir,
      charScript,
      characters: worldDesign.characters,
      worldDesign,
      originalPrompt: userPrompt,
    }),
  ]);
  if (mapResult.status === "rejected") throw mapResult.reason;
  if (characterResult.status === "rejected") throw characterResult.reason;

  purgeFailedCharacters(charsDir, worldDesign);

  console.log("\n━━━ Phase 4: Generating Simulation Configs ━━━");
  const { worldConfig, characterConfigs, sceneConfig } = generateConfigs(
    worldDesign,
    worldDir,
    { originalPrompt: userPrompt },
  );

  if (!KEEP_GENERATION_ARTIFACTS) {
    cleanupIntermediateImages(worldDir);
  } else {
    console.log("\n[Artifacts] Dev mode detected; keeping intermediate images for debugging.");
  }

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║              World Generation Complete!           ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\n  World:      ${worldDesign.worldName}`);
  console.log(`  ID:         ${worldId}`);
  console.log(`  Characters: ${characterConfigs.length}`);
  console.log(`  Locations:  ${worldConfig.locations.length}`);
  console.log(`  Scene type: ${sceneConfig.sceneType}`);
  console.log(`  Output:     ${worldDir}`);
  console.log(`\n  To run:     WORLD_ID=${worldId} npm run dev`);
  console.log();
}

async function generateMapAssets({ mapDir, worldDir, logsDir, mapScript, mapDescription, originalPrompt }) {
  console.log("\n━━━ Phase 2: Generating Map ━━━");

  try {
    await runNodeScript(mapScript, [mapDescription], {
      env: {
        MAP_OUTPUT_DIR: mapDir,
        MAP_LOG_DIR: logsDir,
        MAP_LOG_FILE_NAME: "map-pipeline.log",
        WORLD_DESIGN_PATH: join(worldDir, "world-design.json"),
        ORIGINAL_USER_PROMPT: originalPrompt || "",
      },
      timeoutMs: MAP_GENERATION_TIMEOUT_MS,
      label: "Map generation",
    });
  } catch (err) {
    console.error("Map generation failed:", err.message);
    flattenNestedOutputInto(mapDir);
    if (!existsSync(join(mapDir, "06-final.tmj"))) {
      throw new Error("Map generation failed and no TMJ output found");
    }
  }

  if (!existsSync(join(mapDir, "06-final.tmj"))) {
    flattenNestedOutputInto(mapDir);
  }

  if (!existsSync(join(mapDir, "06-final.tmj"))) {
    throw new Error("Map generation completed without a TMJ output");
  }
}

async function generateCharacterAssets({ charsDir, charScript, characters, worldDesign, originalPrompt }) {
  console.log("\n━━━ Phase 3: Generating Characters ━━━");
  const worldVisualContext = buildWorldVisualContext(worldDesign);

  const ipSource = extractIpSource(worldDesign, originalPrompt);

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    console.log(`\nGenerating character ${i + 1}/${characters.length}: ${char.name}`);

    const charIpSource = char.canonicalRefs?.source || ipSource;

    try {
      await runNodeScript(
        charScript,
        [
          char.appearance,
          "--name",
          char.name,
          "--role",
          typeof char.role === "string" ? char.role : "",
          "--world-visual-context",
          worldVisualContext,
          ...(charIpSource ? ["--ip-source", charIpSource] : []),
        ],
        {
        env: {
          CHAR_OUTPUT_DIR: charsDir,
        },
        timeoutMs: CHARACTER_GENERATION_TIMEOUT_MS,
        label: `Character "${char.name}" generation`,
        },
      );
    } catch (err) {
      console.error(`Character "${char.name}" generation failed: ${err.message}`);
      console.error("Continuing with remaining characters...");
    }
  }
}

function purgeFailedCharacters(charsDir, worldDesign) {
  const charsJsonPath = join(charsDir, "characters.json");
  if (!existsSync(charsJsonPath)) return;

  const generatedChars = JSON.parse(
    readFileSync(charsJsonPath, "utf-8"),
  );

  const validChars = generatedChars.filter((entry) => {
    const spritePath = join(charsDir, entry.id, "spritesheet.png");
    if (existsSync(spritePath)) return true;
    console.warn(`[Cleanup] Removing failed character "${entry.name}" (${entry.id})`);
    rmSync(join(charsDir, entry.id), { recursive: true, force: true });
    return false;
  });

  // Also remove empty char directories that never made it into characters.json
  for (const entry of readdirSync(charsDir)) {
    if (!entry.startsWith("char_")) continue;
    const dirPath = join(charsDir, entry);
    if (!statSync(dirPath).isDirectory()) continue;
    if (!existsSync(join(dirPath, "spritesheet.png"))) {
      console.warn(`[Cleanup] Removing orphan directory: ${entry}`);
      rmSync(dirPath, { recursive: true, force: true });
    }
  }

  if (validChars.length < generatedChars.length) {
    writeFileSync(charsJsonPath, JSON.stringify(validChars, null, 2));
  }

  // Keep worldDesign.characters in sync so index-based mapping in config-generator stays correct
  const validNames = new Set(validChars.map((c) => c.name));
  const before = worldDesign.characters.length;
  worldDesign.characters = worldDesign.characters.filter((c) => validNames.has(c.name));
  const removed = before - worldDesign.characters.length;
  if (removed > 0) {
    console.warn(`[Cleanup] Dropped ${removed} design character(s) with no valid sprite.`);
  }

  if (worldDesign.characters.length === 0) {
    throw new Error("All character generations failed — no valid sprites found.");
  }
}

function extractIpSource(worldDesign, originalPrompt) {
  for (const char of worldDesign.characters || []) {
    if (char.canonicalRefs?.source) return char.canonicalRefs.source;
  }
  const text = `${originalPrompt || ""} ${worldDesign.worldName || ""} ${worldDesign.worldDescription || ""}`;
  const ipPatterns = [
    /赛博朋克\s*2077/,
    /Cyberpunk\s*2077/i,
    /进击的巨人|Attack on Titan/i,
    /指环王|Lord of the Rings/i,
    /哈利[·.]?波特|Harry Potter/i,
    /星球大战|Star Wars/i,
    /漫威|Marvel/i,
    /原神|Genshin/i,
  ];
  for (const p of ipPatterns) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return "";
}

function buildWorldVisualContext(worldDesign) {
  const parts = [
    typeof worldDesign?.mapDescription === "string" ? worldDesign.mapDescription.trim() : "",
    typeof worldDesign?.worldDescription === "string" ? worldDesign.worldDescription.trim() : "",
    typeof worldDesign?.worldName === "string" ? worldDesign.worldName.trim() : "",
  ].filter(Boolean);
  return parts.join("；");
}

function runNodeScript(scriptPath, args, { env = {}, timeoutMs = 0, label = "Process" } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeoutHandle = null;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (error) rejectPromise(error);
      else resolvePromise();
    };

    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill("SIGTERM");
        const forceKillHandle = setTimeout(() => child.kill("SIGKILL"), 5000);
        forceKillHandle.unref?.();
        finish(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeoutHandle.unref?.();
    }

    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}`,
        ),
      );
    });
  });
}

function flattenNestedOutputInto(parentDir) {
  const entries = readdirSync(parentDir).filter((entry) => !entry.startsWith("."));

  for (const entry of entries) {
    const entryPath = join(parentDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    if (!existsSync(join(entryPath, "06-final.tmj"))) continue;

    for (const nestedEntry of readdirSync(entryPath)) {
      renameSync(join(entryPath, nestedEntry), join(parentDir, nestedEntry));
    }
    rmSync(entryPath, { recursive: true, force: true });
    break;
  }
}

function cleanupIntermediateImages(worldDir) {
  const mapDir = join(worldDir, "map");
  const charsDir = join(worldDir, "characters");
  let removedCount = 0;

  if (existsSync(mapDir)) {
    for (const entry of readdirSync(mapDir)) {
      const entryPath = join(mapDir, entry);
      if (!statSync(entryPath).isFile()) continue;
      const isImage = /\.(png|jpg|jpeg|webp)$/i.test(entry);
      const keepImage = entry === "06-background.png";
      if (isImage && !keepImage) {
        rmSync(entryPath, { force: true });
        removedCount++;
      }
    }
  }

  if (existsSync(charsDir)) {
    for (const entry of readdirSync(charsDir)) {
      const charDir = join(charsDir, entry);
      if (!statSync(charDir).isDirectory()) continue;
      for (const charFile of readdirSync(charDir)) {
        const charFilePath = join(charDir, charFile);
        if (!statSync(charFilePath).isFile()) continue;
        const isImage = /\.(png|jpg|jpeg|webp)$/i.test(charFile);
        const keepImage = charFile === "spritesheet.png";
        if (isImage && !keepImage) {
          rmSync(charFilePath, { force: true });
          removedCount++;
        }
      }
    }
  }

  console.log(`\n[Artifacts] Removed ${removedCount} intermediate image${removedCount === 1 ? "" : "s"}. Logs were kept.`);
}

main().catch((err) => {
  console.error("\nWorld generation failed:", err);
  process.exit(1);
});
