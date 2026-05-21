import Phaser from "phaser";
import {
  SPRITE_FRAME_HEIGHT,
  SPRITE_FRAME_WIDTH,
  SPRITE_WALK_FRAME_RATE,
  type CharacterDisplayMetrics,
} from "../config/game-config";

type FacingDirection = "down" | "up" | "left" | "right";
const WALK_SPEED_BODY_HEIGHT_RATIO = 1.1;

export interface MovementAnchor {
  x: number;
  y: number;
  pinned: boolean;
}

export class CharacterSprite extends Phaser.GameObjects.Container {
  characterId: string;
  characterName: string;
  currentLocationId = "";
  mainAreaPointId: string | null = null;
  currentAction: string | null = null;
  isMoving = false;
  movementAnchor: MovementAnchor | null = null;
  profileAnchor: { type: "region" | "element"; targetId: string } | null = null;

  private shadow!: Phaser.GameObjects.Ellipse;
  private bodyCircle: Phaser.GameObjects.Arc | null = null;
  private bodySprite: Phaser.GameObjects.Sprite | null = null;
  private bodyContainer!: Phaser.GameObjects.Container;
  private bubbleContainer!: Phaser.GameObjects.Container;
  private bubbleBg!: Phaser.GameObjects.Graphics;
  private bubbleText!: Phaser.GameObjects.Text;
  private bubbleHideTimer: Phaser.Time.TimerEvent | null = null;
  private currentBubbleVerticalSpan = 0;
  private osBubbleContainer!: Phaser.GameObjects.Container;
  private osBubbleBg!: Phaser.GameObjects.Graphics;
  private osBubbleText!: Phaser.GameObjects.Text;
  private osBubbleHideTimer: Phaser.Time.TimerEvent | null = null;
  private moveTween: Phaser.Tweens.Tween | null = null;
  private idleTween: Phaser.Tweens.Tween | null = null;
  private walkTween: Phaser.Tweens.Tween | null = null;
  private labelRoot: HTMLDivElement | null = null;
  private dialogueBubbleRoot: HTMLDivElement | null = null;
  private dialogueBubbleCard: HTMLDivElement | null = null;
  private dialogueBubbleTail: HTMLDivElement | null = null;
  private dialogueBubbleMainEl: HTMLDivElement | null = null;
  private dialogueBubbleTranslationEl: HTMLDivElement | null = null;
  private dialogueBubbleInnerWrapEl: HTMLDivElement | null = null;
  private dialogueBubbleInnerEl: HTMLDivElement | null = null;

  private nameRowEl: HTMLDivElement | null = null;
  private nameEl: HTMLDivElement | null = null;
  private actionIconEl: HTMLSpanElement | null = null;
  private actionPillEl: HTMLDivElement | null = null;
  private hasSprite = false;
  private textureKey: string;
  private facing: FacingDirection = "down";
  private overlayZoom = 1;
  private displayMetrics: CharacterDisplayMetrics;
  private dialogueBubbleVisible = false;
  public spriteScale: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: {
      characterId: string;
      name: string;
      color: number;
      appearanceId?: string | null;
      displayMetrics: CharacterDisplayMetrics;
      spriteScale?: number;
    }
  ) {
    super(scene, x, y);
    this.characterId = config.characterId;
    this.characterName = config.name;
    this.displayMetrics = config.displayMetrics;
    this.spriteScale = config.spriteScale ?? 1;
    this.textureKey = config.appearanceId || config.characterId;
    this.hasSprite = scene.textures.exists(this.textureKey);
    this.createVisuals(config.color);
    const s = this.spriteScale;
    const hitW = this.hasSprite ? this.displayMetrics.hitWidth * s : this.displayMetrics.circleRadius * 2 * s;
    const hitH = this.hasSprite ? this.displayMetrics.hitHeight * s : this.displayMetrics.circleRadius * 2 * s;
    const hitTopY = this.hasSprite ? this.displayMetrics.hitTopY * s : -this.displayMetrics.circleRadius * s;
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-hitW / 2, hitTopY, hitW, hitH),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    scene.add.existing(this);
  }

  private createVisuals(color: number): void {
    const s = this.spriteScale;
    const shadowWidth = this.hasSprite ? this.displayMetrics.shadowWidth * s : this.displayMetrics.circleRadius * 1.3 * s;
    const shadowHeight = this.hasSprite ? this.displayMetrics.shadowHeight * s : this.displayMetrics.circleRadius * 0.55 * s;
    const shadowOffsetY = this.hasSprite ? this.displayMetrics.shadowOffsetY * s : this.displayMetrics.circleRadius * 0.65 * s;
    this.shadow = this.scene.add.ellipse(0, shadowOffsetY, shadowWidth, shadowHeight, 0x000000, 0.4);

    if (this.hasSprite) {
      this.createSpriteBody();
    } else {
      this.createCircleBody(color);
    }

    const bubbleAnchorOffsetY = this.getBubbleAnchorOffsetY();
    this.bubbleContainer = this.scene.add.container(0, bubbleAnchorOffsetY);
    this.bubbleBg = this.scene.add.graphics();
    this.bubbleText = this.scene.add
      .text(0, 0, "", {
        fontSize: `${this.displayMetrics.bubbleFontSize}px`,
        color: "#222222",
        fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
        fontStyle: "bold",
        wordWrap: { width: this.displayMetrics.bubbleWrapWidth, useAdvancedWrap: true },
        resolution: 2,
      })
      .setOrigin(0.5, 1);

    this.bubbleContainer.add([this.bubbleBg, this.bubbleText]);
    this.bubbleContainer.setVisible(false);

    this.osBubbleContainer = this.scene.add.container(0, bubbleAnchorOffsetY);
    this.osBubbleBg = this.scene.add.graphics();
    this.osBubbleText = this.scene.add
      .text(0, 0, "", {
        fontSize: `${this.displayMetrics.bubbleFontSize * 0.9}px`,
        color: "#444444",
        fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
        fontStyle: "italic",
        wordWrap: { width: this.displayMetrics.bubbleWrapWidth, useAdvancedWrap: true },
        resolution: 2,
      })
      .setOrigin(0.5, 1);
    this.osBubbleContainer.add([this.osBubbleBg, this.osBubbleText]);
    this.osBubbleContainer.setVisible(false);
    this.updateOsBubblePosition();

    this.createDomLabel();

    this.add([
      this.shadow,
      this.bodyContainer,
      this.bubbleContainer,
      this.osBubbleContainer,
    ]);

    this.syncOverlayZoom(this.scene.cameras.main.zoom);
  }

  private createDomLabel(): void {
    const overlayRoot =
      document.getElementById("label-root") ?? document.getElementById("ui-root");
    if (!overlayRoot) return;

    const root = document.createElement("div");
    root.className = "character-label";

    const nameRow = document.createElement("div");
    nameRow.className = "character-label__name-row";

    const name = document.createElement("div");
    name.className = "character-label__name";
    name.textContent = this.characterName;

    const icon = document.createElement("span");
    icon.className = "character-label__icon";
    icon.style.display = "none";

    const actionPill = document.createElement("div");
    actionPill.className = "character-label__action-pill";
    actionPill.style.display = "none";

    nameRow.append(name, icon);
    root.append(nameRow, actionPill);
    overlayRoot.appendChild(root);
    this.createDomDialogueBubble(overlayRoot);

    this.labelRoot = root;
    this.nameRowEl = nameRow;
    this.nameEl = name;
    this.actionIconEl = icon;
    this.actionPillEl = actionPill;
    this.updateDomLabelStyle();
    this.updateDomLabelVisibility();
    this.updateDomLabelPosition();
  }

  private createDomDialogueBubble(overlayRoot: HTMLElement): void {
    const root = document.createElement("div");
    root.className = "character-dialogue-bubble";
    root.style.position = "absolute";
    root.style.display = "none";
    root.style.flexDirection = "column";
    root.style.alignItems = "center";
    root.style.transform = "translate(-50%, -100%)";
    root.style.pointerEvents = "none";
    root.style.userSelect = "none";
    root.style.zIndex = "40";

    const card = document.createElement("div");
    const main = document.createElement("div");
    const translation = document.createElement("div");
    const innerWrap = document.createElement("div");
    const inner = document.createElement("div");
    const tail = document.createElement("div");

    translation.style.display = "none";
    innerWrap.style.display = "none";
    innerWrap.append(inner);
    card.append(main, translation, innerWrap);
    root.append(card, tail);
    overlayRoot.appendChild(root);

    this.dialogueBubbleRoot = root;
    this.dialogueBubbleCard = card;
    this.dialogueBubbleTail = tail;
    this.dialogueBubbleMainEl = main;
    this.dialogueBubbleTranslationEl = translation;
    this.dialogueBubbleInnerWrapEl = innerWrap;
    this.dialogueBubbleInnerEl = inner;
    this.updateDialogueBubbleStyle();
  }

  private createCircleBody(color: number): void {
    const strokeWidth = this.displayMetrics.circleStrokeWidth;
    this.bodyCircle = this.scene.add
      .circle(0, 0, this.displayMetrics.circleRadius, color)
      .setStrokeStyle(strokeWidth, 0xffffff, 1);

    const highlight = this.scene.add.arc(
      this.displayMetrics.circleHighlightOffsetX,
      this.displayMetrics.circleHighlightOffsetY,
      this.displayMetrics.circleHighlightRadius,
      0,
      360,
      false,
      0xffffff,
      0.35,
    );
    this.bodyContainer = this.scene.add.container(0, 0, [this.bodyCircle, highlight]);

    this.idleTween = this.scene.tweens.add({
      targets: this.bodyContainer,
      scaleY: 0.94,
      scaleX: 1.04,
      y: 4,
      duration: 800 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private createSpriteBody(): void {
    this.bodySprite = this.scene.add.sprite(0, 0, this.textureKey, 18);
    this.bodySprite.setDisplaySize(this.displayMetrics.spriteWidth * this.spriteScale, this.displayMetrics.spriteHeight * this.spriteScale);
    this.bodySprite.setOrigin(0.5, 0.85);

    this.bodyContainer = this.scene.add.container(0, 0, [this.bodySprite]);

    const prefix = `${this.textureKey}_`;
    const anims = this.scene.anims;
    if (!anims.exists(prefix + "walk-left")) {
      anims.create({
        key: prefix + "walk-left",
        frames: anims.generateFrameNumbers(this.textureKey, { start: 0, end: 5 }),
        frameRate: SPRITE_WALK_FRAME_RATE,
        repeat: -1,
      });
    }
    if (!anims.exists(prefix + "walk-down")) {
      anims.create({
        key: prefix + "walk-down",
        frames: anims.generateFrameNumbers(this.textureKey, { start: 6, end: 11 }),
        frameRate: SPRITE_WALK_FRAME_RATE,
        repeat: -1,
      });
    }
    if (!anims.exists(prefix + "walk-up")) {
      anims.create({
        key: prefix + "walk-up",
        frames: anims.generateFrameNumbers(this.textureKey, { start: 12, end: 17 }),
        frameRate: SPRITE_WALK_FRAME_RATE,
        repeat: -1,
      });
    }

    this.setIdleFrame("down");
  }

  private setIdleFrame(direction: FacingDirection): void {
    if (!this.bodySprite) return;
    this.bodySprite.stop();
    switch (direction) {
      case "down":
        this.bodySprite.flipX = false;
        this.bodySprite.setFrame(18);
        break;
      case "up":
        this.bodySprite.flipX = false;
        this.bodySprite.setFrame(19);
        break;
      case "left":
        this.bodySprite.flipX = false;
        this.bodySprite.setFrame(20);
        break;
      case "right":
        this.bodySprite.flipX = true;
        this.bodySprite.setFrame(20);
        break;
    }
  }

  private playWalkAnim(direction: FacingDirection): void {
    if (!this.bodySprite) return;
    const prefix = `${this.textureKey}_`;
    let animKey: string;
    let flipX = false;

    switch (direction) {
      case "left":
        animKey = prefix + "walk-left";
        break;
      case "right":
        animKey = prefix + "walk-left";
        flipX = true;
        break;
      case "up":
        animKey = prefix + "walk-up";
        break;
      case "down":
      default:
        animKey = prefix + "walk-down";
        break;
    }

    this.bodySprite.flipX = flipX;
    const currentKey = this.bodySprite.anims?.currentAnim?.key;
    if (currentKey !== animKey || !this.bodySprite.anims.isPlaying) {
      this.bodySprite.play(animKey, true);
    }
  }

  private getDirectionTo(targetX: number, targetY: number): FacingDirection {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx < 0 ? "left" : "right";
    }
    return dy < 0 ? "up" : "down";
  }

  walkAlongPath(path: { x: number; y: number }[], onComplete?: () => void, speedMultiplier = 1): void {
    if (this.isMoving) this.stopMoving();
    this.isMoving = true;
    this.startWalkingAnimation();
    let index = 0;

    const walkNext = () => {
      if (index >= path.length) {
        this.isMoving = false;
        this.moveTween = null;
        this.stopWalkingAnimation();
        onComplete?.();
        return;
      }
      const target = path[index];
      const dist = Phaser.Math.Distance.Between(this.x, this.y, target.x, target.y);
      const speed = this.getWalkSpeed() * speedMultiplier;
      const duration = Math.max(50, (dist / speed) * 1000);

      if (this.hasSprite) {
        this.facing = this.getDirectionTo(target.x, target.y);
        this.playWalkAnim(this.facing);
      }

      this.moveTween = this.scene.tweens.add({
        targets: this,
        x: target.x,
        y: target.y,
        duration,
        ease: "Linear",
        onComplete: () => {
          index++;
          walkNext();
        },
      });
    };
    walkNext();
  }

  stopMoving(): void {
    if (this.moveTween) {
      this.moveTween.stop();
      this.moveTween = null;
    }
    this.isMoving = false;
    this.stopWalkingAnimation();
  }

  setCurrentAction(action: string | null): void {
    this.currentAction = action;
  }

  setMovementAnchor(anchor: MovementAnchor | null): void {
    this.movementAnchor = anchor ? { ...anchor } : null;
  }

  faceTowards(otherX: number, otherY: number): void {
    this.facing = this.getDirectionTo(otherX, otherY);
    this.setIdleFrame(this.facing);
  }

  canAmbientWander(): boolean {
    return !this.isMoving && (!this.currentAction || this.currentAction === "idle" || this.currentAction === "post_dialogue");
  }

  getSortFootY(): number {
    return this.y + (this.hasSprite ? this.displayMetrics.sortFootYOffset * this.spriteScale : this.displayMetrics.circleRadius * 0.65 * this.spriteScale);
  }

  getWorldBodyHeight(): number {
    if (this.hasSprite) {
      return this.bodySprite?.displayHeight ?? this.displayMetrics.spriteHeight;
    }
    return (this.bodyCircle?.radius ?? this.displayMetrics.circleRadius) * 2;
  }

  showBubble(
    text: string,
    duration = 3000,
    textStyleOverrides: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
    innerMonologue?: string,
    translatedText?: string,
  ): void {
    if (this.bubbleHideTimer) {
      this.bubbleHideTimer.remove(false);
      this.bubbleHideTimer = null;
    }
    if (this.osBubbleHideTimer) {
      this.osBubbleHideTimer.remove(false);
      this.osBubbleHideTimer = null;
    }
    if (this.osBubbleContainer.visible) {
      this.osBubbleContainer.setVisible(false);
    }

    const hasMainText = !!text.trim();
    const hasInnerMonologue = !!innerMonologue?.trim();
    const hasTranslation = !!translatedText?.trim();

    if (
      this.dialogueBubbleRoot &&
      this.dialogueBubbleMainEl &&
      this.dialogueBubbleTranslationEl &&
      this.dialogueBubbleInnerWrapEl &&
      this.dialogueBubbleInnerEl
    ) {
      this.dialogueBubbleMainEl.textContent = text;
      this.dialogueBubbleMainEl.style.display = hasMainText ? "block" : "none";

      this.dialogueBubbleTranslationEl.textContent = translatedText ?? "";
      this.dialogueBubbleTranslationEl.style.display = hasTranslation ? "block" : "none";

      this.dialogueBubbleInnerEl.textContent = innerMonologue ?? "";
      this.dialogueBubbleInnerWrapEl.style.display = hasInnerMonologue ? "flex" : "none";

      this.updateDialogueBubbleStyle();
      this.dialogueBubbleVisible = true;
      this.bubbleContainer.setVisible(false);
      this.currentBubbleVerticalSpan = 0;
      this.updateDomLabelVisibility();
      this.updateDomLabelPosition();
      this.bubbleHideTimer = this.scene.time.delayedCall(duration, () => {
        this.dialogueBubbleVisible = false;
        this.updateDomLabelVisibility();
        this.updateDomLabelPosition();
        this.bubbleHideTimer = null;
      });
      return;
    }

    this.applyBubbleTextStyle({
      fontStyle: "bold",
      color: "#222222",
      ...textStyleOverrides,
    });
    this.bubbleText.setText(text || (innerMonologue ?? ""));
    this.bubbleText.updateText();
    const textW = this.bubbleText.width;
    const textH = this.bubbleText.height;
    const pad = this.displayMetrics.bubblePadding;
    const tailH = this.displayMetrics.bubbleTailHeight;
    const w = textW + pad * 2;
    const h = textH + pad * 2;
    const shadowOffset = Math.max(1, pad * 0.22);
    this.currentBubbleVerticalSpan = h + tailH;

    this.bubbleBg.clear();
    this.bubbleBg.fillStyle(0x000000, 0.12);
    this.bubbleBg.fillRoundedRect(
      -w / 2 + shadowOffset,
      -h - tailH + shadowOffset,
      w,
      h,
      this.displayMetrics.bubbleCornerRadius,
    );
    this.bubbleBg.fillStyle(0xffffff, 1);
    this.bubbleBg.fillRoundedRect(
      -w / 2,
      -h - tailH,
      w,
      h,
      this.displayMetrics.bubbleCornerRadius,
    );
    this.bubbleBg.fillTriangle(-tailH, -tailH - 1, tailH, -tailH - 1, 0, 0);

    this.bubbleText.setY(-tailH - pad);

    this.bubbleContainer.setVisible(true);
    this.updateDomLabelVisibility();
    this.updateOsBubblePosition();
    this.bubbleHideTimer = this.scene.time.delayedCall(duration, () => {
      this.bubbleContainer.setVisible(false);
      this.currentBubbleVerticalSpan = 0;
      this.updateDomLabelVisibility();
      this.updateOsBubblePosition();
      this.bubbleHideTimer = null;
    });
  }

  showMonologue(text: string): void {
    this.showBubble("", 7000, {}, text);
  }

  setActionIcon(emoji: string): void {
    if (!this.actionIconEl) return;
    this.actionIconEl.textContent = emoji;
    this.actionIconEl.style.display = emoji ? "inline-block" : "none";
  }

  setActionLabel(text: string | null): void {
    if (!this.actionPillEl) return;
    if (text) {
      this.actionPillEl.textContent = text;
      this.actionPillEl.style.display = "block";
    } else {
      this.actionPillEl.style.display = "none";
      this.actionPillEl.textContent = "";
    }
  }

  clearTransientUi(): void {
    if (this.bubbleHideTimer) {
      this.bubbleHideTimer.remove(false);
      this.bubbleHideTimer = null;
    }
    if (this.osBubbleHideTimer) {
      this.osBubbleHideTimer.remove(false);
      this.osBubbleHideTimer = null;
    }
    this.bubbleContainer.setVisible(false);
    this.osBubbleContainer.setVisible(false);
    this.dialogueBubbleVisible = false;
    this.currentBubbleVerticalSpan = 0;
    this.updateDomLabelVisibility();
    this.updateOsBubblePosition();
    this.updateDomLabelPosition();
  }

  syncOverlayZoom(cameraZoom: number): void {
    const safeZoom = Math.max(cameraZoom, 0.01);
    if (Math.abs(this.overlayZoom - safeZoom) >= 0.001) {
      this.overlayZoom = safeZoom;
    }

    this.updateDomLabelStyle();
    this.updateDomLabelPosition();
  }

  private updateDomLabelStyle(): void {
    if (!this.labelRoot || !this.nameRowEl || !this.nameEl || !this.actionIconEl) return;

    const zoom = Math.max(this.overlayZoom, 0.01);
    const nameSize = Phaser.Math.Clamp(this.displayMetrics.labelNameWorldSize * zoom, 9, 20);
    const iconSize = Phaser.Math.Clamp(this.displayMetrics.labelIconWorldSize * zoom, 9, 18);
    const gap = Phaser.Math.Clamp(this.displayMetrics.labelGapWorld * zoom, 1, 6);

    this.labelRoot.style.gap = `${gap}px`;
    this.labelRoot.style.zIndex = "10";
    this.nameRowEl.style.gap = `${Math.max(2, gap)}px`;
    this.nameEl.style.fontSize = `${nameSize}px`;
    this.actionIconEl.style.fontSize = `${iconSize}px`;

    if (this.actionPillEl) {
      const actionPillSize = Phaser.Math.Clamp(this.displayMetrics.labelNameWorldSize * zoom * 0.75, 9, 18);
      this.actionPillEl.style.fontSize = `${actionPillSize}px`;
      this.actionPillEl.style.padding = `${Math.max(2, actionPillSize * 0.3)}px ${Math.max(6, actionPillSize * 0.8)}px`;
    }

    this.updateDialogueBubbleStyle();
  }

  private updateDomLabelVisibility(): void {
    if (!this.labelRoot) return;
    this.labelRoot.style.visibility = "visible";
  }

  private updateDialogueBubbleStyle(): void {
    if (
      !this.dialogueBubbleCard ||
      !this.dialogueBubbleTail ||
      !this.dialogueBubbleMainEl ||
      !this.dialogueBubbleTranslationEl ||
      !this.dialogueBubbleInnerWrapEl ||
      !this.dialogueBubbleInnerEl
    ) {
      return;
    }

    const zoom = Math.max(this.overlayZoom, 0.01);
    const fontSize = Phaser.Math.Clamp(this.displayMetrics.bubbleFontSize * zoom * 0.93, 11, 26);
    const innerFontSize = Phaser.Math.Clamp(fontSize * 0.75, 9, 20);
    const wrapWidth = Math.max(
      210,
      this.displayMetrics.bubbleWrapWidth * zoom * 1.28
    );
    const padX = Phaser.Math.Clamp(this.displayMetrics.bubblePadding * zoom * 1.1, 10, 24);
    const padY = Phaser.Math.Clamp(this.displayMetrics.bubblePadding * zoom * 0.95, 8, 18);
    const radius = Phaser.Math.Clamp(this.displayMetrics.bubbleCornerRadius * zoom, 8, 20);
    const tail = Phaser.Math.Clamp(this.displayMetrics.bubbleTailHeight * zoom * 1.4, 6, 16);

    this.dialogueBubbleCard.style.display = "flex";
    this.dialogueBubbleCard.style.flexDirection = "column";
    this.dialogueBubbleCard.style.alignItems = "stretch";
    this.dialogueBubbleCard.style.maxWidth = `${wrapWidth}px`;
    this.dialogueBubbleCard.style.padding = `${padY}px ${padX}px`;
    this.dialogueBubbleCard.style.borderRadius = `${radius}px`;
    this.dialogueBubbleCard.style.background = "rgba(255,255,255,0.98)";
    this.dialogueBubbleCard.style.border = "1px solid rgba(33,40,62,0.08)";
    this.dialogueBubbleCard.style.boxShadow = "0 10px 28px rgba(8,14,32,0.18), 0 2px 8px rgba(8,14,32,0.08)";

    this.dialogueBubbleMainEl.style.color = "#1e2433";
    this.dialogueBubbleMainEl.style.fontFamily = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
    this.dialogueBubbleMainEl.style.fontWeight = "700";
    this.dialogueBubbleMainEl.style.fontSize = `${fontSize}px`;
    this.dialogueBubbleMainEl.style.lineHeight = "1.33";
    this.dialogueBubbleMainEl.style.whiteSpace = "pre-wrap";
    this.dialogueBubbleMainEl.style.wordBreak = "break-word";
    this.dialogueBubbleMainEl.style.overflowWrap = "anywhere";

    this.dialogueBubbleTranslationEl.style.color = "#5a6a8a";
    this.dialogueBubbleTranslationEl.style.fontFamily = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
    this.dialogueBubbleTranslationEl.style.fontWeight = "600";
    this.dialogueBubbleTranslationEl.style.fontSize = `${innerFontSize}px`;
    this.dialogueBubbleTranslationEl.style.lineHeight = "1.38";
    this.dialogueBubbleTranslationEl.style.whiteSpace = "pre-wrap";
    this.dialogueBubbleTranslationEl.style.wordBreak = "break-word";
    this.dialogueBubbleTranslationEl.style.overflowWrap = "anywhere";
    this.dialogueBubbleTranslationEl.style.marginTop = `${Math.max(4, padY * 0.4)}px`;
    this.dialogueBubbleTranslationEl.style.paddingTop = `${Math.max(4, padY * 0.4)}px`;
    this.dialogueBubbleTranslationEl.style.borderTop = "1px dashed rgba(110,123,255,0.25)";

    const isMonologueOnly = this.dialogueBubbleMainEl.style.display === "none";
    this.dialogueBubbleInnerWrapEl.style.flexDirection = "column";
    this.dialogueBubbleInnerWrapEl.style.gap = `${Math.max(4, padY * 0.35)}px`;
    this.dialogueBubbleInnerWrapEl.style.marginTop = isMonologueOnly ? "0" : `${Math.max(8, padY * 0.8)}px`;
    this.dialogueBubbleInnerWrapEl.style.padding = `${Math.max(7, padY * 0.6)}px ${Math.max(9, padX * 0.7)}px`;
    this.dialogueBubbleInnerWrapEl.style.borderRadius = `${Math.max(8, radius * 0.75)}px`;
    this.dialogueBubbleInnerWrapEl.style.background = "linear-gradient(180deg, rgba(110,123,255,0.08), rgba(110,123,255,0.03))";
    this.dialogueBubbleInnerWrapEl.style.borderTop = isMonologueOnly ? "none" : "1px solid rgba(110,123,255,0.14)";

    this.dialogueBubbleInnerEl.style.color = "#586079";
    this.dialogueBubbleInnerEl.style.fontFamily = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";
    this.dialogueBubbleInnerEl.style.fontSize = `${innerFontSize}px`;
    this.dialogueBubbleInnerEl.style.fontStyle = "italic";
    this.dialogueBubbleInnerEl.style.lineHeight = "1.42";
    this.dialogueBubbleInnerEl.style.whiteSpace = "pre-wrap";
    this.dialogueBubbleInnerEl.style.wordBreak = "break-word";
    this.dialogueBubbleInnerEl.style.overflowWrap = "anywhere";

    this.dialogueBubbleTail.style.width = "0";
    this.dialogueBubbleTail.style.height = "0";
    this.dialogueBubbleTail.style.marginTop = "-1px";
    this.dialogueBubbleTail.style.borderLeft = `${tail}px solid transparent`;
    this.dialogueBubbleTail.style.borderRight = `${tail}px solid transparent`;
    this.dialogueBubbleTail.style.borderTop = `${tail + 2}px solid rgba(255,255,255,0.98)`;
    this.dialogueBubbleTail.style.filter = "drop-shadow(0 3px 4px rgba(8,14,32,0.08))";
  }

  private applyBubbleTextStyle(overrides: Phaser.Types.GameObjects.Text.TextStyle): void {
    this.bubbleText.setStyle({
      fontSize: `${this.displayMetrics.bubbleFontSize}px`,
      color: "#222222",
      fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
      fontStyle: "bold",
      wordWrap: { width: this.displayMetrics.bubbleWrapWidth, useAdvancedWrap: true },
      resolution: 2,
      ...overrides,
    });
  }

  private getBubbleAnchorOffsetY(): number {
    return this.hasSprite ? this.displayMetrics.bubbleOffsetY * this.spriteScale : -this.displayMetrics.circleRadius * 4.2 * this.spriteScale;
  }

  private updateOsBubblePosition(): void {
    const baseY = this.getBubbleAnchorOffsetY();
    const stackedGap = Math.max(10, this.displayMetrics.bubblePadding * 0.75);
    const nextY = this.bubbleContainer.visible
      ? baseY - this.currentBubbleVerticalSpan - stackedGap
      : baseY;
    this.osBubbleContainer.setY(nextY);
  }

  private updateDomLabelPosition(): void {
    if (!this.labelRoot) return;

    const camera = this.scene.cameras.main;
    const worldView = camera.worldView;
    const screenX = (this.x - worldView.x) * camera.zoom + camera.x;
    const screenY = (this.y - worldView.y) * camera.zoom + camera.y;
    const visible =
      this.active &&
      this.visible &&
      screenX >= -120 &&
      screenX <= camera.width + 120 &&
      screenY >= -120 &&
      screenY <= camera.height + 120;

    this.labelRoot.style.display = visible ? "flex" : "none";
    if (this.dialogueBubbleRoot) {
      this.dialogueBubbleRoot.style.display =
        visible && this.dialogueBubbleVisible ? "flex" : "none";
    }
    this.updateDomLabelVisibility();
    if (!visible) return;

    // screenY is the container origin = roughly the character's feet.
    // Compute where the head actually is on screen by using the real
    // sprite geometry, so the label tracks perfectly at any zoom level.
    const headScreenY = screenY - this.getHeadWorldOffset() * camera.zoom;
    this.labelRoot.style.left = `${Math.round(screenX)}px`;
    this.labelRoot.style.top = `${Math.round(headScreenY)}px`;

    if (this.dialogueBubbleRoot && this.dialogueBubbleVisible) {
      const bubbleScreenY =
        (this.y + this.getBubbleAnchorOffsetY() - worldView.y) * camera.zoom + camera.y;
      this.dialogueBubbleRoot.style.left = `${Math.round(screenX)}px`;
      this.dialogueBubbleRoot.style.top = `${Math.round(bubbleScreenY)}px`;
    }
  }

  /** World-unit distance from the container origin (feet) up to the head top. */
  private getHeadWorldOffset(): number {
    if (this.hasSprite) {
      const h =
        this.bodySprite?.displayHeight ??
        this.displayMetrics.spriteWidth * (SPRITE_FRAME_HEIGHT / SPRITE_FRAME_WIDTH);
      const originY = this.bodySprite?.originY ?? 0.85;
      // originY portion is above the anchor; shave ~15% for transparent padding
      return h * originY * 0.85;
    }
    return (this.bodyCircle?.radius ?? this.displayMetrics.circleRadius) + this.displayMetrics.circleRadius * 0.1;
  }

  private getWalkSpeed(): number {
    return Math.max(48, this.getWorldBodyHeight() * WALK_SPEED_BODY_HEIGHT_RATIO);
  }

  private startWalkingAnimation(): void {
    if (this.hasSprite) return;
    if (this.walkTween) return;
    this.idleTween?.pause();
    this.walkTween = this.scene.tweens.add({
      targets: this.bodyContainer,
      y: 8,
      scaleX: 1.1,
      scaleY: 0.9,
      duration: 160,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private stopWalkingAnimation(): void {
    if (this.hasSprite) {
      this.setIdleFrame(this.facing);
      return;
    }
    if (this.walkTween) {
      this.walkTween.stop();
      this.walkTween = null;
    }
    this.bodyContainer.setY(0);
    this.bodyContainer.setScale(1, 1);
    this.idleTween?.resume();
  }

  enableClick(callback: (charId: string) => void): void {
    this.on("pointerdown", () => callback(this.characterId));
    this.on("pointerover", () => {
      if (this.bodyCircle) {
        this.bodyCircle.setStrokeStyle(this.displayMetrics.circleStrokeWidth, 0xffff00);
      } else if (this.bodySprite) {
        this.bodySprite.setTint(0xddddff);
      }
    });
    this.on("pointerout", () => {
      if (this.bodyCircle) {
        this.bodyCircle.setStrokeStyle(this.displayMetrics.circleStrokeWidth, 0xffffff, 1);
      } else if (this.bodySprite) {
        this.bodySprite.clearTint();
      }
    });
  }

  override destroy(fromScene?: boolean): void {
    this.bubbleHideTimer?.remove(false);
    this.bubbleHideTimer = null;
    this.osBubbleHideTimer?.remove(false);
    this.osBubbleHideTimer = null;
    this.labelRoot?.remove();
    this.dialogueBubbleRoot?.remove();
    this.labelRoot = null;
    this.dialogueBubbleRoot = null;
    this.dialogueBubbleCard = null;
    this.dialogueBubbleTail = null;
    this.dialogueBubbleMainEl = null;
    this.dialogueBubbleInnerWrapEl = null;
    this.dialogueBubbleInnerEl = null;
    this.nameRowEl = null;
    this.nameEl = null;
    this.actionIconEl = null;
    this.actionPillEl = null;
    super.destroy(fromScene);
  }
}
