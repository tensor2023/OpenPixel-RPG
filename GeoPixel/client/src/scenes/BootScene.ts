import Phaser from "phaser";
import { SPRITE_FRAME_WIDTH, SPRITE_FRAME_HEIGHT } from "../config/game-config";

const MAP_TMJ_PATH = "/assets/map/06-final.tmj";
const MAP_BACKGROUND_PATH = "/assets/map/06-background.png";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  private async fetchCharacterManifest(): Promise<string[]> {
    try {
      const res = await fetch("/api/characters");
      const characters: { id: string }[] = await res.json();
      return characters.map((c) => c.id);
    } catch {
      return [];
    }
  }

  private async fetchAppearanceManifest(): Promise<string[]> {
    try {
      const res = await fetch("/api/characters/appearances");
      const ids: string[] = await res.json();
      return ids;
    } catch {
      return [];
    }
  }

  async preload() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add.text(w / 2, h / 2 - 20, "GeoPixel", {
      fontSize: "24px",
      color: "#e0e0e0",
      fontFamily: "Arial",
    }).setOrigin(0.5);

    const barW = 320;
    const barY = h / 2 + 20;
    const barX = (w - barW) / 2;

    this.add.rectangle(barX + barW / 2, barY + 3, barW, 6, 0x333333);
    const barFill = this.add.rectangle(barX, barY, 1, 6, 0x74b9ff).setOrigin(0, 0);

    const statusText = this.add.text(w / 2, barY + 24, "Loading...", {
      fontSize: "12px",
      color: "#888",
      fontFamily: "Arial",
    }).setOrigin(0.5);

    // progress only fires on success; track both success+failure manually
    let completed = 0;
    const updateBar = () => {
      const total = this.load.totalToLoad;
      if (total <= 0) return;
      completed++;
      const pct = Math.min(1, completed / total);
      try {
        barFill.width = Math.max(1, barW * pct);
        statusText.setText(`Loading... ${Math.round(pct * 100)}%`);
      } catch (_) { /* protect the loader pipeline */ }
    };
    this.load.on("filecomplete", updateBar);
    this.load.on("loaderror", updateBar);

    this.load.json("world-map", MAP_TMJ_PATH);
    this.load.image("world-base", MAP_BACKGROUND_PATH);

    // Preload character spritesheets
    const charIds = await this.fetchCharacterManifest();
    for (const charId of charIds) {
      this.load.spritesheet(charId, `/assets/characters/${charId}/spritesheet.png`, {
        frameWidth: SPRITE_FRAME_WIDTH,
        frameHeight: SPRITE_FRAME_HEIGHT,
      });
    }

    // Preload appearance spritesheets (for dynamic NPCs without their own sprites)
    const appIds = await this.fetchAppearanceManifest();
    for (const appId of appIds) {
      this.load.spritesheet(appId, `/assets/characters/${appId}/spritesheet.png`, {
        frameWidth: SPRITE_FRAME_WIDTH,
        frameHeight: SPRITE_FRAME_HEIGHT,
      });
    }
  }

  create() {
    for (const key of this.textures.getTextureKeys()) {
      if (key === "world-base" || key.startsWith("char_")) {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      }
    }
    console.log("[BootScene] Loading complete, starting WorldScene");
    this.scene.start("WorldScene");
  }
}
