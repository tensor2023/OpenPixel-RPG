import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { MapManager } from "../systems/MapManager";
import { PathfindingManager } from "../systems/PathfindingManager";
import { CharacterMovement } from "../systems/CharacterMovement";
import { PlaybackController } from "../systems/PlaybackController";
import { CameraController } from "../systems/CameraController";
import { PlayerController } from "../systems/PlayerController";
import { CharacterSprite } from "../objects/CharacterSprite";
import { getCharacterColor, actionToEmoji, createCharacterDisplayMetrics } from "../config/game-config";
import { apiClient } from "../ui/services/api-client";
import { translationStore } from "../ui/services/translation-store";
import type { CharacterInfo, DialogueEventData, SimulationEvent } from "../types/api";

type DialoguePlaybackTurn = {
  speaker: string;
  content: string;
  innerMonologue?: string;
  participants?: string[];
  translatedContent?: string;
};

type DialoguePlaybackLane = {
  queue: DialoguePlaybackTurn[];
  timer: Phaser.Time.TimerEvent | null;
};

// Frontend-only dialogue playback tuning. Search these names to adjust pacing.
const FRONTEND_DIALOGUE_BUBBLE_MS = 5000;
const FRONTEND_DIALOGUE_INNER_MONOLOGUE_TAIL_MS = 1500;

export class WorldScene extends Phaser.Scene {
  private mapManager!: MapManager;
  private pathfinder!: PathfindingManager;
  private characterMovement!: CharacterMovement;
  private characterSprites: Map<string, CharacterSprite> = new Map();
  private playbackController!: PlaybackController;
  private cameraController!: CameraController;
  private playerController!: PlayerController;
  private eventBus!: Phaser.Events.EventEmitter;
  private entityLayer!: Phaser.GameObjects.Container;
  private dialoguePlaybackLanes: Map<string, DialoguePlaybackLane> = new Map();
  private dialogueEventChain: Promise<void> = Promise.resolve();
  private mapPixelWidth = 8192;
  private mapPixelHeight = 4608;
  private walkableOverlay: Phaser.GameObjects.Graphics | null = null;
  private regionBoundsOverlay: Phaser.GameObjects.Container | null = null;
  private mainAreaPointsOverlay: Phaser.GameObjects.Graphics | null = null;
  private interactiveObjectsOverlay: Phaser.GameObjects.Container | null = null;
  private interactiveHoverGraphics: Phaser.GameObjects.Graphics | null = null;
  private interactiveHoverLabelContainer: Phaser.GameObjects.Container | null = null;
  private interactiveHoverLabelText: Phaser.GameObjects.Text | null = null;
  private interactiveHoverLabelBg: Phaser.GameObjects.Graphics | null = null;
  private lastObservedDay: number | null = null;
  private isReplaying = false;
  private tickPlaybackActive = false;
  private tickPlaybackEventsFlushed = false;
  private pendingPlaybackAsyncOps = 0;
  private pendingDialogueCleanupTimers = 0;
  private playbackCompletionCheckTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super("WorldScene");
  }

  create() {
    console.log("[WorldScene] create() called");
    this.eventBus = EventBus.instance;

    let tiledJSON: any = null;

    try {
      tiledJSON = this.cache.json.get("world-map");
      this.mapManager = new MapManager();
      this.mapManager.loadFromTiledJSON(tiledJSON);
      console.log("[WorldScene] Map parsed:", this.mapManager.getAllLocationIds());
    } catch (e) {
      console.error("[WorldScene] Failed to parse map:", e);
      this.mapManager = new MapManager();
    }

    const hasBg = this.textures.exists("world-base");
    let bgWidth = 8192;
    let bgHeight = 4608;
    if (hasBg) {
      const bg = this.add.image(0, 0, "world-base").setOrigin(0, 0);
      bgWidth = bg.width;
      bgHeight = bg.height;
      console.log(`[WorldScene] Background loaded: ${bgWidth}x${bgHeight}`);
    } else {
      console.warn("[WorldScene] Background texture not found, using fallback");
      this.add.rectangle(bgWidth / 2, bgHeight / 2, bgWidth, bgHeight, 0x2d4a3e);
    }

    this.entityLayer = this.add.container(0, 0);
    this.entityLayer.setDepth(10);
    this.mapPixelWidth = bgWidth;
    this.mapPixelHeight = bgHeight;
    this.setupInteractiveObjectHover();

    this.pathfinder = new PathfindingManager(this.mapManager);

    const initialCenter = { x: bgWidth / 2, y: bgHeight / 2 };
    this.cameraController = new CameraController(this, bgWidth, bgHeight, initialCenter);
    console.log("[WorldScene] Camera centered on:", initialCenter);

    this.characterMovement = new CharacterMovement(
      this.mapManager,
      this.pathfinder,
      this.characterSprites
    );

    const savedMode = (() => {
      try { return localStorage.getItem("control-mode") ?? "player"; } catch { return "player"; }
    })();
    const startInPlayerMode = savedMode !== "camera";
    this.playerController = new PlayerController(
      this,
      this.mapManager,
      this.characterSprites,
      this.cameraController,
      startInPlayerMode,
    );
    this.cameraController.setPlayerControlMode(startInPlayerMode);

    this.playbackController = new PlaybackController(this.eventBus);
    this.playbackController.on("event", this.handleSimEvent, this);

    this.eventBus.on("set_control_mode", (mode: "player" | "camera") => {
      const isPlayer = mode === "player";
      this.cameraController.setPlayerControlMode(isPlayer);
      this.playerController.setEnabled(isPlayer);
    });

    this.eventBus.on("follow_character", (charId: string) => {
      const sprite = this.characterSprites.get(charId);
      if (sprite) this.cameraController.followCharacter(sprite);
    });
    this.eventBus.on("unfollow_character", () => {
      this.cameraController.stopFollowing();
    });
    this.eventBus.on("player_talk_to_npc", (charId: string) => {
      void this.handlePlayerTalkToNpc(charId);
    });
    this.eventBus.on("dev_advance_tick", () => {
      this.playbackController.devAdvanceTick();
    });
    this.eventBus.on("set_auto_play", (enabled: boolean) => {
      if (this.playbackController.getMode() === "replay") {
        this.playbackController.setReplayAutoPlay(enabled);
      } else {
        this.playbackController.setAutoPlay(enabled);
      }
    });
    this.eventBus.on("set_tick_interval", (intervalMs: number) => {
      this.playbackController.setTickIntervalMs(intervalMs);
    });
    this.eventBus.on("set_cycle_ticks", (cycleTicks: number) => {
      this.playbackController.setCycleTicks(cycleTicks);
    });
    this.eventBus.on("start_replay", (timelineId: string) => {
      void this.playbackController.startReplay(timelineId);
    });
    this.eventBus.on("stop_replay", () => {
      this.playbackController.stopReplay();
    });
    this.eventBus.on("replay_ended", () => {
      void this.syncCharactersFromServer();
    });
    this.eventBus.on("set_replay_mode", (payload: { active: boolean }) => {
      this.isReplaying = payload.active;
    });
    this.eventBus.on("replay_init", (initFrame: any) => {
      this.handleReplayInit(initFrame);
    });
    const onTimeUpdate = (time: { day: number }) => {
      this.lastObservedDay = time.day;
    };
    const onSceneSyncCharacters = () => {
      void this.trackPlaybackAsync(this.handleSceneDayChange());
    };
    const onTickPlaybackStarted = () => {
      this.tickPlaybackActive = true;
      this.tickPlaybackEventsFlushed = false;
      if (this.playbackCompletionCheckTimer) {
        this.playbackCompletionCheckTimer.remove(false);
        this.playbackCompletionCheckTimer = null;
      }
    };
    const onTickPlaybackEventsFlushed = () => {
      this.tickPlaybackEventsFlushed = true;
      this.scheduleTickPlaybackCompletionCheck();
    };
    const onToggleWalkableOverlay = (visible: boolean) => {
      this.setWalkableOverlayVisible(visible);
    };
    const onToggleRegionBoundsOverlay = (visible: boolean) => {
      this.setRegionBoundsOverlayVisible(visible);
    };
    const onToggleMainAreaPointsOverlay = (visible: boolean) => {
      this.setMainAreaPointsOverlayVisible(visible);
    };
    const onToggleInteractiveObjectsOverlay = (visible: boolean) => {
      this.setInteractiveObjectsOverlayVisible(visible);
    };
    this.eventBus.on("toggle_debug_walkable_overlay", onToggleWalkableOverlay);
    this.eventBus.on("toggle_debug_region_bounds_overlay", onToggleRegionBoundsOverlay);
    this.eventBus.on("toggle_debug_main_area_points_overlay", onToggleMainAreaPointsOverlay);
    this.eventBus.on("toggle_debug_interactive_objects_overlay", onToggleInteractiveObjectsOverlay);
    this.eventBus.on("time_update", onTimeUpdate);
    this.eventBus.on("scene_sync_characters", onSceneSyncCharacters);
    this.eventBus.on("tick_playback_started", onTickPlaybackStarted);
    this.eventBus.on("tick_playback_events_flushed", onTickPlaybackEventsFlushed);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.eventBus.off("toggle_debug_walkable_overlay", onToggleWalkableOverlay);
      this.eventBus.off("toggle_debug_region_bounds_overlay", onToggleRegionBoundsOverlay);
      this.eventBus.off("toggle_debug_main_area_points_overlay", onToggleMainAreaPointsOverlay);
      this.eventBus.off("toggle_debug_interactive_objects_overlay", onToggleInteractiveObjectsOverlay);
      this.eventBus.off("time_update", onTimeUpdate);
      this.eventBus.off("scene_sync_characters", onSceneSyncCharacters);
      this.eventBus.off("tick_playback_started", onTickPlaybackStarted);
      this.eventBus.off("tick_playback_events_flushed", onTickPlaybackEventsFlushed);
    });

    this.initAsync();
  }

  private async initAsync() {
    try {
      const worldInfo = await apiClient.getWorldInfo();
      this.mapManager.setMainAreaPoints(worldInfo.mainAreaPoints || []);
      if (this.regionBoundsOverlay || this.mainAreaPointsOverlay || this.interactiveObjectsOverlay) {
        this.refreshDebugOverlays();
      }
    } catch (e) {
      console.warn("[WorldScene] Failed to load world navigation:", e);
    }

    try {
      await this.initCharacters();
      this.playerController.onSpritesReady();
    } catch (e) {
      console.warn("[WorldScene] Failed to load characters:", e);
    }

    try {
      await this.playbackController.initialize();
    } catch (e) {
      console.warn("[WorldScene] Failed to initialize playback:", e);
    }

    console.log("[WorldScene] Async init complete, sprites:", this.characterSprites.size);
  }

  private async initCharacters() {
    await this.syncCharactersFromServer();
  }

  private handleReplayInit(initFrame: { characters: { id: string; name: string; location: string; mainAreaPointId: string | null }[] }) {
    const displayMetrics = createCharacterDisplayMetrics(this.mapPixelWidth, this.mapPixelHeight);
    const zoom = this.cameras.main.zoom;
    const mainAreaOccupants = new Map<string, string[]>();

    for (const char of initFrame.characters) {
      if (char.location !== "main_area" || !char.mainAreaPointId) continue;
      const occupants = mainAreaOccupants.get(char.mainAreaPointId) ?? [];
      occupants.push(char.id);
      mainAreaOccupants.set(char.mainAreaPointId, occupants);
    }

    for (const [index, char] of initFrame.characters.entries()) {
      const charInfo: CharacterInfo = {
        id: char.id,
        name: char.name,
        role: "",
        nickname: "",
        location: char.location,
        mainAreaPointId: char.mainAreaPointId,
        emotion: "neutral",
        currentAction: null,
      };
      const pos = this.getCharacterPlacement(charInfo, mainAreaOccupants);
      let sprite = this.characterSprites.get(char.id);

      if (!sprite) {
        const color = getCharacterColor(index);
        sprite = new CharacterSprite(this, pos.x, pos.y, {
          characterId: char.id,
          name: char.name,
          color,
          displayMetrics,
        });
        sprite.enableClick((id) => this.eventBus.emit("character_clicked", id));
        this.entityLayer.add(sprite);
        this.characterSprites.set(char.id, sprite);
      }

      this.applyCharacterSnapshotToSprite(sprite, charInfo, pos, zoom);
    }
  }

  private async syncCharactersFromServer(): Promise<void> {
    const characters = await apiClient.getCharacters();
    console.log("[WorldScene] Got characters:", characters.length);
    const zoom = this.cameras.main.zoom;
    const displayMetrics = createCharacterDisplayMetrics(this.mapPixelWidth, this.mapPixelHeight);
    const mainAreaOccupants = new Map<string, string[]>();
    const seenCharacterIds = new Set<string>();

    for (const char of characters) {
      if (char.location !== "main_area" || !char.mainAreaPointId) continue;
      const occupants = mainAreaOccupants.get(char.mainAreaPointId) ?? [];
      occupants.push(char.id);
      mainAreaOccupants.set(char.mainAreaPointId, occupants);
    }

    for (const [index, char] of characters.entries()) {
      seenCharacterIds.add(char.id);
      const pos = this.getCharacterPlacement(char, mainAreaOccupants);
      let sprite = this.characterSprites.get(char.id);

      if (!sprite) {
        const color = getCharacterColor(index);
        sprite = new CharacterSprite(this, pos.x, pos.y, {
          characterId: char.id,
          name: char.name,
          color,
          appearanceId: char.appearanceId,
          displayMetrics,
          spriteScale: char.appearanceId ? 2 : 1,
        });
        sprite.enableClick((id) => this.eventBus.emit("character_clicked", id));
        this.entityLayer.add(sprite);
        this.characterSprites.set(char.id, sprite);
      }

      this.applyCharacterSnapshotToSprite(sprite, char, pos, zoom);
    }

    for (const [charId, sprite] of Array.from(this.characterSprites.entries())) {
      if (seenCharacterIds.has(charId)) continue;
      sprite.destroy();
      this.characterSprites.delete(charId);
    }
  }

  private getCharacterPlacement(
    char: CharacterInfo,
    mainAreaOccupants: Map<string, string[]>,
  ): { x: number; y: number } {
    return (
      (char.location === "main_area" && char.mainAreaPointId
        ? this.mapManager.getMainAreaPlacement(char.mainAreaPointId, char.id, {
            occupantIds: mainAreaOccupants.get(char.mainAreaPointId) ?? [char.id],
          })
        : null) ||
      this.mapManager.getRandomWalkablePointInLocation(char.location, {
        preferInset: this.mapManager.isPinnedLocation(char.location),
      }) ||
      { x: 400, y: 300 }
    );
  }

  private applyCharacterSnapshotToSprite(
    sprite: CharacterSprite,
    char: CharacterInfo,
    pos: { x: number; y: number },
    zoom: number,
  ): void {
    sprite.stopMoving();
    sprite.clearTransientUi();
    sprite.setPosition(pos.x, pos.y);
    sprite.currentLocationId = char.location;
    sprite.mainAreaPointId = char.mainAreaPointId ?? null;
    sprite.profileAnchor = char.anchor || null;
    sprite.setCurrentAction(char.currentAction);
    sprite.setActionIcon(actionToEmoji(char.currentAction));
    sprite.setActionLabel(null);
    sprite.setMovementAnchor({
      x: pos.x,
      y: pos.y,
      pinned: this.mapManager.isPinnedLocation(char.location) || !!char.anchor,
    });
    sprite.syncOverlayZoom(zoom);
  }

  private async handlePlayerTalkToNpc(charId: string): Promise<void> {
    console.log("[WorldScene] handlePlayerTalkToNpc:", charId);
    const npcSprite = this.characterSprites.get(charId);
    if (!npcSprite) {
      console.warn("[WorldScene] NPC sprite not found:", charId);
      return;
    }

    try {
      console.log("[WorldScene] Starting sandbox chat...");
      const startResp = await apiClient.sandboxChatStart({
        characterId: charId,
        userIdentity: "User（玩家）",
      });
      console.log("[WorldScene] Chat started:", startResp);
      if (!startResp.ok) return;

      const sendResp = await apiClient.sandboxChatSend({
        sessionId: startResp.sessionId,
        message: "（User走近你，和你打招呼）",
      });
      console.log("[WorldScene] Chat reply:", sendResp.reply);
      if (sendResp.ok && sendResp.reply) {
        let translatedText: string | undefined;
        if (translationStore.enabled) {
          translatedText = (await translationStore.translate(sendResp.reply)) ?? undefined;
        }
        npcSprite.showBubble(sendResp.reply, 6000, {}, undefined, translatedText);
      }

      apiClient.sandboxChatClose(startResp.sessionId).catch(() => {});
    } catch (e) {
      console.warn("[WorldScene] NPC chat failed:", e);
    }
  }

  private async handleSceneDayChange(): Promise<void> {
    this.clearDialoguePlayback();
    try {
      await this.syncCharactersFromServer();
    } catch (error) {
      console.warn("[WorldScene] Failed to sync characters after scene change:", error);
    }
  }

  private clearDialoguePlayback(): void {
    for (const lane of this.dialoguePlaybackLanes.values()) {
      lane.queue = [];
      lane.timer?.remove(false);
      lane.timer = null;
    }
    this.dialoguePlaybackLanes.clear();
    for (const sprite of this.characterSprites.values()) {
      sprite.stopMoving();
      sprite.clearTransientUi();
    }
    this.scheduleTickPlaybackCompletionCheck();
  }

  private handleSimEvent(event: SimulationEvent) {
    switch (event.type) {
      case "movement": {
        const destination = event.data?.to ?? event.data?.toLocation ?? event.location;
        if (event.actorId && destination) {
          const sprite = this.characterSprites.get(event.actorId);
          sprite?.setCurrentAction(null);
          sprite?.setActionIcon("");
          sprite?.setActionLabel(null);
          const pointId =
            typeof event.data?.toPointId === "string" ? event.data.toPointId : null;
          void this.trackPlaybackAsync(
            this.characterMovement.moveToLocation(event.actorId, destination, {
              force: true,
              mainAreaPointId: pointId,
            }),
          );
          this.maybeShowActionMonologue(event);
        }
        break;
      }

      case "action_start": {
        const sprite = this.characterSprites.get(event.actorId!);
        const actionId = event.data?.action ?? event.data?.interactionId ?? event.data?.actionType ?? null;
        if (sprite) {
          sprite.setCurrentAction(actionId);
          sprite.setActionIcon(actionToEmoji(actionId));
          const actionType = event.data?.actionType;
          if (actionType === "interact_object") {
            sprite.setActionLabel(event.data?.interactionName || actionToEmoji(actionId) || null);
          } else {
            sprite.setActionLabel(null);
          }
        }
        const objectId = event.data?.objectId ?? event.targetId;
        if (objectId && event.actorId && event.data?.actionType === "interact_object") {
          void this.trackPlaybackAsync(
            this.characterMovement.moveToObject(event.actorId, objectId),
          );
        }
        this.maybeShowActionMonologue(event);
        break;
      }

      case "action_end": {
        const sprite = this.characterSprites.get(event.actorId!);
        if (sprite) {
          sprite.setCurrentAction(null);
          sprite.setActionIcon("");
          sprite.setActionLabel(null);
        }
        break;
      }

      case "dialogue":
        this.dialogueEventChain = this.trackPlaybackAsync(
          this.dialogueEventChain
            .then(() => this.handleDialogue(event))
            .catch((error) => {
              console.warn("[WorldScene] Failed to handle dialogue event:", error);
            }),
        );
        break;

      case "event_triggered":
        this.eventBus.emit("global_event", event);
        break;
    }

    this.eventBus.emit("sim_event", event);
  }

  private async handleDialogue(event: SimulationEvent) {
    const dialogue = event.data as DialogueEventData;
    if (!dialogue) return;

    if (dialogue.participants?.length === 2) {
      const [idA, idB] = dialogue.participants;
      const spriteA = this.characterSprites.get(idA);
      const spriteB = this.characterSprites.get(idB);
      if (dialogue.phase === "complete") {
        this.setDialogueActionState(dialogue.participants, "post_dialogue");
      } else {
        this.setDialogueActionState(dialogue.participants, "in_conversation");
      }
      if (spriteA && spriteB) {
        if (dialogue.phase === "turn" && dialogue.turnIndexStart === 0) {
          await this.reconcileDialogueParticipantLocations(
            dialogue.participants,
            event.location,
          );
          const runtimePatch = await this.characterMovement.approachForDialogue(idA, idB);
          if (runtimePatch?.mainAreaPointId && !this.isReplaying) {
            void apiClient.patchCharacterRuntimeState(idA, runtimePatch).catch((error) => {
              console.warn("[WorldScene] Failed to persist dialogue landing point:", error);
            });
          }
        } else {
          spriteA.faceTowards(spriteB.x, spriteB.y);
          spriteB.faceTowards(spriteA.x, spriteA.y);
        }
      }
    }

    this.eventBus.emit("dialogue", event);

    if (dialogue.phase === "turn" && dialogue.turns?.length) {
      const laneKey = this.getDialogueLaneKey(dialogue);
      const lane = this.getOrCreateDialoguePlaybackLane(laneKey);
      dialogue.turns.forEach((turn) => {
        const turnData: DialoguePlaybackTurn = {
          speaker: turn.speaker,
          content: turn.content,
          innerMonologue: turn.innerMonologue,
          participants: dialogue.participants,
        };
        if (translationStore.enabled) {
          translationStore.translate(turn.content).then((translated) => {
            turnData.translatedContent = translated ?? undefined;
          });
        }
        lane.queue.push(turnData);
      });
      this.playNextDialogueTurn(laneKey);
    } else if (dialogue.phase === "complete" && dialogue.participants?.length) {
      this.pendingDialogueCleanupTimers += 1;
      this.time.delayedCall(1200, () => {
        for (const participantId of dialogue.participants || []) {
          const sprite = this.characterSprites.get(participantId);
          if (!sprite || sprite.currentAction !== "post_dialogue") continue;
          sprite.setCurrentAction(null);
          sprite.setActionIcon("");
        }
        this.pendingDialogueCleanupTimers = Math.max(0, this.pendingDialogueCleanupTimers - 1);
        this.scheduleTickPlaybackCompletionCheck();
      });
    }
  }

  private async reconcileDialogueParticipantLocations(
    participantIds: string[],
    locationId?: string,
  ): Promise<void> {
    if (!locationId) return;

    await Promise.all(
      participantIds.map(async (participantId) => {
        const sprite = this.characterSprites.get(participantId);
        if (!sprite || sprite.currentLocationId === locationId) return;

        await this.characterMovement.moveToLocation(participantId, locationId, {
          force: true,
        });
      }),
    );
  }

  private setDialogueActionState(participantIds: string[], action: string | null) {
    for (const participantId of participantIds) {
      const sprite = this.characterSprites.get(participantId);
      if (!sprite) continue;
      sprite.setCurrentAction(action);
      sprite.setActionIcon(actionToEmoji(action));
      sprite.setActionLabel(null);
    }
  }

  private getDialogueLaneKey(dialogue: DialogueEventData): string {
    if (dialogue.conversationId) {
      return dialogue.conversationId;
    }
    return [...(dialogue.participants ?? [])].sort().join("__");
  }

  private getOrCreateDialoguePlaybackLane(laneKey: string): DialoguePlaybackLane {
    let lane = this.dialoguePlaybackLanes.get(laneKey);
    if (!lane) {
      lane = { queue: [], timer: null };
      this.dialoguePlaybackLanes.set(laneKey, lane);
    }
    return lane;
  }

  private playNextDialogueTurn(laneKey: string) {
    const lane = this.dialoguePlaybackLanes.get(laneKey);
    if (!lane) {
      this.scheduleTickPlaybackCompletionCheck();
      return;
    }
    if (lane.timer || lane.queue.length === 0) {
      if (!lane.timer && lane.queue.length === 0) {
        this.dialoguePlaybackLanes.delete(laneKey);
        this.scheduleTickPlaybackCompletionCheck();
      }
      return;
    }

    const nextTurn = lane.queue.shift();
    if (!nextTurn) {
      this.dialoguePlaybackLanes.delete(laneKey);
      this.scheduleTickPlaybackCompletionCheck();
      return;
    }

    const bubbleDuration = FRONTEND_DIALOGUE_BUBBLE_MS;
    const playbackDuration =
      bubbleDuration + (nextTurn.innerMonologue ? FRONTEND_DIALOGUE_INNER_MONOLOGUE_TAIL_MS : 0);

    if (nextTurn.participants?.length === 2) {
      const [idA, idB] = nextTurn.participants;
      const spriteA = this.characterSprites.get(idA);
      const spriteB = this.characterSprites.get(idB);
      if (spriteA && spriteB) {
        spriteA.faceTowards(spriteB.x, spriteB.y);
        spriteB.faceTowards(spriteA.x, spriteA.y);
      }
    }

    const sprite = this.characterSprites.get(nextTurn.speaker);
    if (sprite) {
      sprite.showBubble(nextTurn.content, bubbleDuration, {}, nextTurn.innerMonologue, nextTurn.translatedContent);
    }

    lane.timer = this.time.delayedCall(
      playbackDuration,
      () => {
        lane.timer = null;
        if (lane.queue.length === 0) {
          this.dialoguePlaybackLanes.delete(laneKey);
        }
        this.playNextDialogueTurn(laneKey);
      },
    );
  }

  private maybeShowActionMonologue(event: SimulationEvent): void {
    const monologue = event.innerMonologue;
    if (!monologue || !event.actorId) return;
    const sprite = this.characterSprites.get(event.actorId);
    if (!sprite) return;
    sprite.showMonologue(monologue);
  }

  private trackPlaybackAsync<T>(promise: Promise<T>): Promise<T> {
    if (!this.tickPlaybackActive) return promise;
    this.pendingPlaybackAsyncOps += 1;
    return promise.finally(() => {
      this.pendingPlaybackAsyncOps = Math.max(0, this.pendingPlaybackAsyncOps - 1);
      this.scheduleTickPlaybackCompletionCheck();
    });
  }

  private scheduleTickPlaybackCompletionCheck(delayMs = 0): void {
    if (!this.tickPlaybackActive) return;
    if (this.playbackCompletionCheckTimer) return;
    this.playbackCompletionCheckTimer = this.time.delayedCall(delayMs, () => {
      this.playbackCompletionCheckTimer = null;
      this.maybeCompleteTickPlayback();
    });
  }

  private maybeCompleteTickPlayback(): void {
    if (!this.tickPlaybackActive || !this.tickPlaybackEventsFlushed) return;
    if (this.pendingPlaybackAsyncOps > 0) return;
    if (this.pendingDialogueCleanupTimers > 0) return;
    if (this.hasPendingDialoguePlayback()) return;

    this.tickPlaybackActive = false;
    this.tickPlaybackEventsFlushed = false;
    this.eventBus.emit("tick_playback_complete");
  }

  private hasPendingDialoguePlayback(): boolean {
    for (const lane of this.dialoguePlaybackLanes.values()) {
      if (lane.timer || lane.queue.length > 0) {
        return true;
      }
    }
    return false;
  }

  private setWalkableOverlayVisible(visible: boolean): void {
    if (visible && !this.walkableOverlay) {
      this.walkableOverlay = this.buildWalkableOverlay();
    }
    this.walkableOverlay?.setVisible(visible);
  }

  private setRegionBoundsOverlayVisible(visible: boolean): void {
    if (visible && !this.regionBoundsOverlay) {
      this.regionBoundsOverlay = this.buildRegionBoundsOverlay();
    }
    this.regionBoundsOverlay?.setVisible(visible);
  }

  private setMainAreaPointsOverlayVisible(visible: boolean): void {
    if (visible && !this.mainAreaPointsOverlay) {
      this.mainAreaPointsOverlay = this.buildMainAreaPointsOverlay();
    }
    this.mainAreaPointsOverlay?.setVisible(visible);
  }

  private setInteractiveObjectsOverlayVisible(visible: boolean): void {
    if (visible && !this.interactiveObjectsOverlay) {
      this.interactiveObjectsOverlay = this.buildInteractiveObjectsOverlay();
    }
    this.interactiveObjectsOverlay?.setVisible(visible);
  }

  private refreshDebugOverlays(): void {
    const regionBoundsVisible = this.regionBoundsOverlay?.visible ?? false;
    const mainAreaPointsVisible = this.mainAreaPointsOverlay?.visible ?? false;
    const interactiveObjectsVisible = this.interactiveObjectsOverlay?.visible ?? false;

    this.regionBoundsOverlay?.destroy(true);
    this.regionBoundsOverlay = null;
    this.mainAreaPointsOverlay?.destroy();
    this.mainAreaPointsOverlay = null;
    this.interactiveObjectsOverlay?.destroy(true);
    this.interactiveObjectsOverlay = null;

    if (regionBoundsVisible) {
      this.regionBoundsOverlay = this.buildRegionBoundsOverlay();
      this.regionBoundsOverlay.setVisible(true);
    }
    if (mainAreaPointsVisible) {
      this.mainAreaPointsOverlay = this.buildMainAreaPointsOverlay();
      this.mainAreaPointsOverlay.setVisible(true);
    }
    if (interactiveObjectsVisible) {
      this.interactiveObjectsOverlay = this.buildInteractiveObjectsOverlay();
      this.interactiveObjectsOverlay.setVisible(true);
    }
  }

  private buildWalkableOverlay(): Phaser.GameObjects.Graphics {
    const graphics = this.add.graphics();
    graphics.setDepth(4);
    graphics.fillStyle(0x4da3ff, 0.22);
    graphics.lineStyle(1, 0x7db8ff, 0.16);

    const tileSize = this.mapManager.tileSize;
    for (let gy = 0; gy < this.mapManager.gridHeight; gy++) {
      let runStart: number | null = null;
      for (let gx = 0; gx <= this.mapManager.gridWidth; gx++) {
        const walkable = gx < this.mapManager.gridWidth && this.mapManager.isWalkable(gx, gy);
        if (walkable) {
          if (runStart == null) runStart = gx;
          continue;
        }
        if (runStart == null) continue;

        const width = (gx - runStart) * tileSize;
        const x = runStart * tileSize;
        const y = gy * tileSize;
        graphics.fillRect(x, y, width, tileSize);
        graphics.strokeRect(x, y, width, tileSize);
        runStart = null;
      }
    }

    return graphics;
  }

  private buildRegionBoundsOverlay(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setDepth(16);

    const boxes = this.add.graphics();
    boxes.lineStyle(2, 0xffd166, 0.95);
    boxes.fillStyle(0xffd166, 0.08);
    container.add(boxes);

    for (const location of this.mapManager.getVisibleLocations()) {
      boxes.fillRect(location.x, location.y, location.width, location.height);
      boxes.strokeRect(location.x, location.y, location.width, location.height);

      const label = this.add.text(
        location.x + 6,
        Math.max(6, location.y - 22),
        location.name || location.id,
        {
          fontSize: "14px",
          fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
          color: "#ffe7a8",
          backgroundColor: "rgba(0, 0, 0, 0.65)",
          padding: { left: 6, right: 6, top: 3, bottom: 3 },
          stroke: "#000000",
          strokeThickness: 2,
        },
      );
      label.setDepth(17);
      container.add(label);
    }

    return container;
  }

  private buildMainAreaPointsOverlay(): Phaser.GameObjects.Graphics {
    const pointMarkers = this.add.graphics();
    pointMarkers.setDepth(16);
    pointMarkers.lineStyle(2, 0xffffff, 0.92);
    pointMarkers.fillStyle(0x4da3ff, 0.95);

    for (const point of this.mapManager.getMainAreaPoints()) {
      pointMarkers.fillCircle(point.x, point.y, 6);
      pointMarkers.strokeCircle(point.x, point.y, 6);
      pointMarkers.fillStyle(0xe8f4ff, 0.95);
      pointMarkers.fillCircle(point.x, point.y, 2);
      pointMarkers.fillStyle(0x4da3ff, 0.95);
    }

    return pointMarkers;
  }

  private setupInteractiveObjectHover() {
    this.interactiveHoverGraphics = this.add.graphics();
    this.interactiveHoverGraphics.setDepth(15);
    
    this.interactiveHoverLabelContainer = this.add.container(0, 0);
    this.interactiveHoverLabelContainer.setDepth(16);
    this.interactiveHoverLabelContainer.setVisible(false);

    this.interactiveHoverLabelBg = this.add.graphics();
    this.interactiveHoverLabelText = this.add.text(0, 0, "", {
      fontSize: "18px",
      fontFamily: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 2,
    });
    
    this.interactiveHoverLabelContainer.add([this.interactiveHoverLabelBg, this.interactiveHoverLabelText]);

    let currentHoveredObjectId: string | null = null;

    for (const object of this.mapManager.getInteractiveObjects()) {
      const zone = this.add.zone(object.x, object.y, object.width, object.height);
      zone.setOrigin(0, 0);
      zone.setInteractive();
      
      zone.on("pointerover", () => {
        if (!this.interactiveHoverGraphics || !this.interactiveHoverLabelContainer || !this.interactiveHoverLabelBg || !this.interactiveHoverLabelText) return;
        
        currentHoveredObjectId = object.objectId;

        // Draw highlight
        this.interactiveHoverGraphics.clear();
        this.interactiveHoverGraphics.lineStyle(2, 0xffffff, 0.8);
        this.interactiveHoverGraphics.fillStyle(0xffffff, 0.15);
        
        // Use a rounded rectangle for a slightly softer look
        this.interactiveHoverGraphics.fillRoundedRect(object.x, object.y, object.width, object.height, 4);
        this.interactiveHoverGraphics.strokeRoundedRect(object.x, object.y, object.width, object.height, 4);
        
        // Show label
        this.interactiveHoverLabelText.setText(object.name || object.objectId);
        
        // Measure text bounds to draw a nice rounded background
        const textWidth = this.interactiveHoverLabelText.width;
        const textHeight = this.interactiveHoverLabelText.height;
        const bgPaddingX = 12;
        const bgPaddingY = 8;
        
        this.interactiveHoverLabelBg.clear();
        this.interactiveHoverLabelBg.fillStyle(0x000000, 0.75);
        this.interactiveHoverLabelBg.fillRoundedRect(
          -bgPaddingX, 
          -bgPaddingY, 
          textWidth + bgPaddingX * 2, 
          textHeight + bgPaddingY * 2, 
          6 // border radius
        );
        
        // Position text inside container
        this.interactiveHoverLabelText.setPosition(0, 0);
        
        // Position the whole container
        const containerX = object.x + object.width / 2 - textWidth / 2;
        const containerY = Math.max(10 + bgPaddingY, object.y - textHeight - bgPaddingY - 4);
        
        this.interactiveHoverLabelContainer.setPosition(containerX, containerY);
        this.interactiveHoverLabelContainer.setVisible(true);
      });
      
      zone.on("pointerout", () => {
        if (currentHoveredObjectId === object.objectId) {
          if (!this.interactiveHoverGraphics || !this.interactiveHoverLabelContainer) return;
          this.interactiveHoverGraphics.clear();
          this.interactiveHoverLabelContainer.setVisible(false);
          currentHoveredObjectId = null;
        }
      });
    }
  }

  private buildInteractiveObjectsOverlay(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    container.setDepth(16);

    const boxes = this.add.graphics();
    boxes.lineStyle(2, 0x55efc4, 0.95);
    boxes.fillStyle(0x55efc4, 0.1);
    container.add(boxes);

    for (const object of this.mapManager.getInteractiveObjects()) {
      boxes.fillRect(object.x, object.y, object.width, object.height);
      boxes.strokeRect(object.x, object.y, object.width, object.height);

      const label = this.add.text(
        object.x + 6,
        Math.max(6, object.y - 22),
        object.name || object.objectId,
        {
          fontSize: "14px",
          fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
          color: "#c8fff0",
          backgroundColor: "rgba(0, 0, 0, 0.65)",
          padding: { left: 6, right: 6, top: 3, bottom: 3 },
          stroke: "#000000",
          strokeThickness: 2,
        },
      );
      label.setDepth(17);
      container.add(label);
    }

    return container;
  }

  update(_time: number, delta: number) {
    this.cameraController?.update();
    this.playerController?.update();
    this.pathfinder?.update();
    this.playbackController?.update(delta);
    if (!this.isReplaying) {
      this.characterMovement?.updateAmbientMovement(performance.now());
    }
    const zoom = this.cameras.main.zoom;
    for (const sprite of this.characterSprites.values()) {
      sprite.syncOverlayZoom(zoom);
    }
    if (this.entityLayer) {
      this.entityLayer.list.sort((a, b) => {
        const ay = a instanceof CharacterSprite ? a.getSortFootY() : (a as Phaser.GameObjects.Sprite).y || 0;
        const by = b instanceof CharacterSprite ? b.getSortFootY() : (b as Phaser.GameObjects.Sprite).y || 0;
        return ay - by;
      });
    }
  }
}
