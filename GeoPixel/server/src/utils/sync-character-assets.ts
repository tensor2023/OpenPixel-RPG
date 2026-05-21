import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GLOBAL_CHARACTERS_DIR = path.resolve(__dirname, "../../../output/characters");

/**
 * Copy character spritesheets from the global output/characters/ pool into a
 * world's characters/ directory so the client can serve them as static assets.
 *
 * Also creates a char_player/ spritesheet from the "小同" spritesheet
 * (char_1779005204057) so the player character renders with its own sprite.
 */
export function syncCharacterAssetsToWorld(worldDir: string): void {
  const targetDir = path.join(worldDir, "characters");
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (!fs.existsSync(GLOBAL_CHARACTERS_DIR)) {
    console.warn(`[syncCharacterAssets] Global characters dir not found: ${GLOBAL_CHARACTERS_DIR}`);
    return;
  }

  const entries = fs.readdirSync(GLOBAL_CHARACTERS_DIR, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const srcPath = path.join(GLOBAL_CHARACTERS_DIR, entry.name, "spritesheet.png");
    if (!fs.existsSync(srcPath)) continue;

    const destDir = path.join(targetDir, entry.name);
    const destPath = path.join(destDir, "spritesheet.png");

    if (fs.existsSync(destPath) && fs.statSync(destPath).size === fs.statSync(srcPath).size) {
      continue; // already up to date
    }

    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    copied++;
  }

  // Also create char_player/ from the 小同 spritesheet if it doesn't exist yet.
  const playerDestDir = path.join(targetDir, "char_player");
  const playerDestPath = path.join(playerDestDir, "spritesheet.png");
  if (!fs.existsSync(playerDestPath)) {
    const tongSrc = path.join(GLOBAL_CHARACTERS_DIR, "char_1779005204057", "spritesheet.png");
    if (fs.existsSync(tongSrc)) {
      fs.mkdirSync(playerDestDir, { recursive: true });
      fs.copyFileSync(tongSrc, playerDestPath);
      copied++;
    }
  }

  if (copied > 0) {
    console.log(`[syncCharacterAssets] Copied ${copied} spritesheets to ${targetDir}`);
  }

  // Strip appearanceId from char_player.json so the client falls back to
  // using the character id ("char_player") as the texture key. Otherwise
  // CharacterSprite tries to load the appearanceId as a texture, which
  // BootScene hasn't preloaded → fallback to purple circle.
  const playerConfigPath = path.join(worldDir, "config", "characters", "char_player.json");
  if (fs.existsSync(playerConfigPath)) {
    try {
      const raw = fs.readFileSync(playerConfigPath, "utf-8");
      const profile = JSON.parse(raw);
      if (profile.appearanceId) {
        delete profile.appearanceId;
        fs.writeFileSync(playerConfigPath, JSON.stringify(profile, null, 2));
        console.log(`[syncCharacterAssets] Stripped appearanceId from char_player.json`);
      }
    } catch (err) {
      console.warn(`[syncCharacterAssets] Failed to strip appearanceId:`, err);
    }
  }
}
