import Phaser from "phaser";
import { EventBus } from "../EventBus";
import type { CharacterSprite } from "../objects/CharacterSprite";

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3;
const KEY_PAN_SPEED = 14;
const CAMERA_EDGE_PADDING_PX = 160;

export class CameraController {
  private scene: Phaser.Scene;
  private mapWidth: number;
  private mapHeight: number;
  private defaultCenter: { x: number; y: number };
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private isDragging = false;
  private playerControlMode = true;

  constructor(
    scene: Phaser.Scene,
    mapWidth: number,
    mapHeight: number,
    initialCenter?: { x: number; y: number }
  ) {
    this.scene = scene;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.defaultCenter = initialCenter ?? { x: mapWidth / 2, y: mapHeight / 2 };

    const cam = scene.cameras.main;
    this.applyViewportConstraints(cam);
    this.applyFitView(cam);

    this.setupDragPan(cam);
    this.setupKeyboard();
    this.setupEventBus();
    scene.scale.on("resize", () => {
      this.applyFitView(this.scene.cameras.main);
      this.emitState();
    });

    this.applyFitView(cam);
    this.emitState();
  }

  private setupDragPan(cam: Phaser.Cameras.Scene2D.Camera) {
    this.scene.input.on("pointerdown", () => {
      this.isDragging = false;
    });
    this.scene.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      const dx = pointer.x - pointer.prevPosition.x;
      const dy = pointer.y - pointer.prevPosition.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) this.isDragging = true;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.applyViewportConstraints(cam);
    });
  }

  private setupKeyboard() {
    if (!this.scene.input.keyboard) return;
    this.cursors = this.scene.input.keyboard.addKeys(
      {
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      },
    ) as Phaser.Types.Input.Keyboard.CursorKeys;
  }

  private setupEventBus() {
    const bus = EventBus.instance;
    bus.on("camera_pan_to", (pos: { x: number; y: number }) => {
      this.stopFollowing();
      this.panTo(pos.x, pos.y, 400);
    });
  }

  update() {
    const cam = this.scene.cameras.main;
    this.handleKeyboardPan(cam);
    this.applyViewportConstraints(cam);
    this.emitState();
  }

  setPlayerControlMode(enabled: boolean): void {
    this.playerControlMode = enabled;
  }

  private handleKeyboardPan(cam: Phaser.Cameras.Scene2D.Camera) {
    if (!this.cursors || this.playerControlMode) return;
    if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
    const speed = KEY_PAN_SPEED / cam.zoom;
    if (this.cursors.left.isDown) cam.scrollX -= speed;
    if (this.cursors.right.isDown) cam.scrollX += speed;
    if (this.cursors.up.isDown) cam.scrollY -= speed;
    if (this.cursors.down.isDown) cam.scrollY += speed;
  }

  private emitZoom(zoom: number) {
    EventBus.instance.emit("camera_zoom_changed", zoom);
  }

  private emitState() {
    const cam = this.scene.cameras.main;
    const wv = cam.worldView;
    EventBus.instance.emit("camera_state", {
      x: wv.x,
      y: wv.y,
      width: wv.width,
      height: wv.height,
      zoom: cam.zoom,
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
    });
  }

  private getFitZoom(cam: Phaser.Cameras.Scene2D.Camera): number {
    const zx = cam.width / this.mapWidth;
    const zy = cam.height / this.mapHeight;
    return Phaser.Math.Clamp(Math.min(zx, zy), MIN_ZOOM, MAX_ZOOM);
  }

  private applyFitView(cam: Phaser.Cameras.Scene2D.Camera): void {
    const zoom = this.getFitZoom(cam);
    cam.setZoom(zoom);
    cam.centerOn(this.defaultCenter.x, this.defaultCenter.y);
    this.applyViewportConstraints(cam);
    this.emitZoom(cam.zoom);
  }

  private applyViewportConstraints(cam: Phaser.Cameras.Scene2D.Camera): void {
    const viewWidth = cam.width / Math.max(cam.zoom, 0.0001);
    const viewHeight = cam.height / Math.max(cam.zoom, 0.0001);
    const extraX = Math.max(0, viewWidth - this.mapWidth);
    const extraY = Math.max(0, viewHeight - this.mapHeight);
    const paddingX = Math.min(CAMERA_EDGE_PADDING_PX, Math.max(48, this.mapWidth * 0.08));
    const paddingY = Math.min(CAMERA_EDGE_PADDING_PX, Math.max(48, this.mapHeight * 0.08));

    // When the visible world area is larger than the map, expand bounds symmetrically
    // so Phaser clamps the camera to a centered presentation instead of top-left locking.
    cam.setBounds(
      -extraX / 2 - paddingX,
      -extraY / 2 - paddingY,
      this.mapWidth + extraX + paddingX * 2,
      this.mapHeight + extraY + paddingY * 2,
    );
  }

  followCharacter(sprite: CharacterSprite, lerp = 0.05): void {
    this.scene.cameras.main.startFollow(sprite, true, lerp, lerp);
  }

  stopFollowing(): void {
    this.scene.cameras.main.stopFollow();
  }

  panTo(x: number, y: number, duration = 500): void {
    this.scene.cameras.main.pan(x, y, duration);
  }

  destroy() {
    // cleanup if needed
  }
}
