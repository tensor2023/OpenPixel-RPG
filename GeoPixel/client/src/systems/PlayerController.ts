import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MapManager } from "./MapManager";
import { CameraController } from "./CameraController";
import type { CharacterSprite } from "../objects/CharacterSprite";

const PLAYER_CHAR_ID = "char_player";
const NPC_INTERACT_RADIUS_TILES = 54;

export class PlayerController {
  private scene: Phaser.Scene;
  private mapManager: MapManager;
  private sprites: Map<string, CharacterSprite>;
  private cameraController: CameraController;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private shiftDown = false;
  private enabled: boolean;
  private nearbyNpc: CharacterSprite | null = null;
  private static readonly SPRINT_MULTIPLIER = 3.0;
  private handleWindowKeyDown: (e: KeyboardEvent) => void;
  private handleWindowKeyUp: (e: KeyboardEvent) => void;

  constructor(
    scene: Phaser.Scene,
    mapManager: MapManager,
    sprites: Map<string, CharacterSprite>,
    cameraController: CameraController,
    enabled = true,
  ) {
    this.scene = scene;
    this.mapManager = mapManager;
    this.sprites = sprites;
    this.cameraController = cameraController;
    this.enabled = enabled;
    this.handleWindowKeyDown = (e: KeyboardEvent) => { if (e.key === "Shift") { this.shiftDown = true; } };
    this.handleWindowKeyUp = (e: KeyboardEvent) => { if (e.key === "Shift") { this.shiftDown = false; } };
    window.addEventListener("keydown", this.handleWindowKeyDown);
    window.addEventListener("keyup", this.handleWindowKeyUp);
    this.setupKeyboard();
  }

  private setupKeyboard(): void {
    if (!this.scene.input.keyboard) return;
    this.cursors = this.scene.input.keyboard.addKeys(
      {
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      },
    ) as Phaser.Types.Input.Keyboard.CursorKeys;

    this.scene.input.keyboard.on("keydown-Z", () => {
      if (!this.enabled) return;
      console.log("[PlayerController] Z pressed, nearbyNpc:", this.nearbyNpc?.characterId ?? "none");
      if (this.nearbyNpc) {
        EventBus.instance.emit("player_talk_to_npc", this.nearbyNpc.characterId);
      }
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onSpritesReady(): void { /* no-op: fit zoom shows full map, no follow needed */ }

  update(): void {
    if (!this.enabled) { return; }
    if (!this.cursors) { return; }
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;

    const sprite = this.sprites.get(PLAYER_CHAR_ID);
    if (!sprite) { return; }

    this.updateNpcProximity(sprite);

    if (sprite.isMoving) return;

    let dx = 0;
    let dy = 0;
    if (this.cursors.left.isDown) dx = -1;
    else if (this.cursors.right.isDown) dx = 1;
    else if (this.cursors.up.isDown) dy = -1;
    else if (this.cursors.down.isDown) dy = 1;

    if (dx === 0 && dy === 0) return;

    const from = this.mapManager.pixelToGrid(sprite.x, sprite.y);
    const tgx = from.gx + dx;
    const tgy = from.gy + dy;
    if (!this.mapManager.isWalkable(tgx, tgy)) return;

    const target = this.mapManager.gridToPixel(tgx, tgy);
    if (this.shiftDown) {
      // Shift: 瞬移
      sprite.x = target.x;
      sprite.y = target.y;
    } else {
      // 正常走路
      sprite.walkAlongPath([target]);
    }
  }

  private updateNpcProximity(playerSprite: CharacterSprite): void {
    const threshold = this.mapManager.tileSize * NPC_INTERACT_RADIUS_TILES;
    let closest: CharacterSprite | null = null;
    let closestDist = threshold;

    for (const [charId, npcSprite] of this.sprites) {
      if (charId === PLAYER_CHAR_ID) continue;
      const dx = npcSprite.x - playerSprite.x;
      const dy = npcSprite.y - playerSprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = npcSprite;
      }
    }

    if (closest !== this.nearbyNpc) {
      if (this.nearbyNpc) {
        this.nearbyNpc.setActionLabel(null);
      }
      this.nearbyNpc = closest;
      if (this.nearbyNpc) {
        console.log("[PlayerController] NPC nearby:", this.nearbyNpc.characterId, "dist:", closestDist.toFixed(1));
        this.nearbyNpc.setActionLabel("[Z] 对话");
      }
    }
  }
}
