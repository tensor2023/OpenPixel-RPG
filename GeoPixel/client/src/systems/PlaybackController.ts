import Phaser from "phaser";
import { apiClient } from "../ui/services/api-client";
import type {
  GameTime,
  SimulationEvent,
  SceneConfigInfo,
  WorldTimeInfo,
  TimelineFrame,
  TimelineTickFrame,
} from "../types/api";

type TickResponse = {
  ok: boolean;
  gameTime: WorldTimeInfo;
  eventCount: number;
  events: SimulationEvent[];
  activeSimulationTicks?: number;
  canSwitchContext?: boolean;
};

export type PlaybackMode = "live" | "replay";

type LiveSimulationContext = {
  worldId: string;
  timelineId: string;
};

export class PlaybackController extends Phaser.Events.EventEmitter {
  private currentTime: WorldTimeInfo = {
    day: 1,
    tick: 0,
    timeString: "08:00",
    period: "上午",
  };
  private autoPlay = false;
  private tickIntervalMs = 0;
  private nextTickDueAt = 0;
  private tickStartedAt = 0;
  private playbackInProgress = false;
  private requestInFlight = false;
  private prefetchedTick: TickResponse | null = null;
  private liveContext: LiveSimulationContext | null = null;
  private sceneConfig: SceneConfigInfo | null = null;
  private cycleTicks = 48;
  private curtainDropped = false;

  private mode: PlaybackMode = "live";
  private replayFrames: TimelineFrame[] = [];
  private replayIndex = 0;
  private replayAutoPlay = false;
  private replayNextDueAt = 0;
  private replayTickStartedAt = 0;

  constructor(private globalEventBus: Phaser.Events.EventEmitter) {
    super();
  }

  async initialize(): Promise<void> {
    const [worldTime, worldInfo] = await Promise.all([
      apiClient.getWorldTime(),
      apiClient.getWorldInfo(),
    ]);
    this.currentTime = worldTime;
    this.sceneConfig = worldInfo.sceneConfig;
    if (worldInfo.currentWorldId && worldInfo.currentTimelineId) {
      this.liveContext = {
        worldId: worldInfo.currentWorldId,
        timelineId: worldInfo.currentTimelineId,
      };
    }
    this.globalEventBus.emit("time_update", { ...this.currentTime });
    this.globalEventBus.emit("simulation_status", { status: "idle" });
    this.emitPlaybackState();
  }

  getCurrentTime(): WorldTimeInfo {
    return { ...this.currentTime };
  }

  getMode(): PlaybackMode {
    return this.mode;
  }

  setCycleTicks(n: number): void {
    this.cycleTicks = n;
  }

  // --- Replay mode ---

  async startReplay(timelineId: string): Promise<void> {
    if (this.mode === "replay") return;

    this.autoPlay = false;
    this.prefetchedTick = null;

    try {
      const { frames } = await apiClient.getTimelineEvents(timelineId);
      if (frames.length === 0) {
        console.warn("[PlaybackController] No events to replay");
        return;
      }

      this.mode = "replay";
      this.replayFrames = frames;
      this.replayIndex = 0;
      this.replayAutoPlay = false;

      const initFrame = frames[0];
      if (initFrame.type === "init") {
        this.currentTime = this.buildWorldTimeInfo(initFrame.gameTime);
        this.globalEventBus.emit("replay_init", initFrame);
        this.globalEventBus.emit("time_update", { ...this.currentTime });
        this.replayIndex = 1;
      }

      const totalTicks = frames.filter((f) => f.type === "tick").length;
      this.globalEventBus.emit("set_replay_mode", { active: true });
      this.globalEventBus.emit("replay_progress", {
        current: 0,
        total: totalTicks,
      });
      this.emitPlaybackState();
    } catch (err) {
      console.error("[PlaybackController] Failed to start replay:", err);
      this.globalEventBus.emit("simulation_status", {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  stopReplay(): void {
    if (this.mode !== "replay") return;

    this.mode = "live";
    this.replayFrames = [];
    this.replayIndex = 0;
    this.replayAutoPlay = false;
    this.playbackInProgress = false;

    this.globalEventBus.emit("set_replay_mode", { active: false });
    this.globalEventBus.emit("replay_ended");
    this.globalEventBus.emit("simulation_status", { status: "idle" });
    this.emitPlaybackState();
  }

  setReplayAutoPlay(enabled: boolean): void {
    this.replayAutoPlay = enabled;
    this.replayNextDueAt = enabled ? performance.now() : 0;
    this.emitPlaybackState();
  }

  // --- Main update loop ---

  update(_delta: number): void {
    if (this.mode === "replay") {
      this.updateReplay();
      return;
    }

    if (!this.autoPlay || this.playbackInProgress) return;
    if (performance.now() < this.nextTickDueAt) return;
    if (this.requestInFlight && !this.prefetchedTick) return;
    void this.devAdvanceTick();
  }

  private updateReplay(): void {
    if (!this.replayAutoPlay || this.playbackInProgress) return;
    if (performance.now() < this.replayNextDueAt) return;
    void this.advanceReplayTick();
  }

  private async advanceReplayTick(): Promise<void> {
    if (this.replayIndex >= this.replayFrames.length) {
      this.replayAutoPlay = false;
      this.globalEventBus.emit("replay_finished");
      this.emitPlaybackState();
      return;
    }

    this.playbackInProgress = true;
    this.replayTickStartedAt = performance.now();

    const frame = this.replayFrames[this.replayIndex];
    this.replayIndex++;

    if (frame.type !== "tick") {
      this.playbackInProgress = false;
      return;
    }

    const tickFrame = frame as TimelineTickFrame;
    const events = tickFrame.events ?? [];

    this.currentTime = this.buildWorldTimeInfo(tickFrame.gameTime);

    this.globalEventBus.emit("tick_playback_started", {
      gameTime: tickFrame.gameTime,
      eventCount: events.length,
    });

    for (const event of events) {
      this.emit("event", event);
    }

    this.globalEventBus.emit("time_update", { ...this.currentTime });
    this.globalEventBus.emit("tick_playback_events_flushed", {
      gameTime: tickFrame.gameTime,
      eventCount: events.length,
    });

    const ticksPlayed = this.replayFrames
      .slice(0, this.replayIndex)
      .filter((f) => f.type === "tick").length;
    const totalTicks = this.replayFrames.filter((f) => f.type === "tick").length;
    this.globalEventBus.emit("replay_progress", {
      current: ticksPlayed,
      total: totalTicks,
    });

    try {
      await this.waitForTickPlaybackCompletion(events.length);
    } catch {
      // continue
    }

    this.playbackInProgress = false;

    if (this.replayAutoPlay) {
      this.replayNextDueAt = this.replayTickStartedAt + this.tickIntervalMs;
    }

    if (this.replayIndex >= this.replayFrames.length) {
      this.replayAutoPlay = false;
      this.globalEventBus.emit("replay_finished");
      this.emitPlaybackState();
    }
  }

  // --- Live mode ---

  async seekTo(time: GameTime): Promise<void> {
    this.currentTime = {
      ...this.currentTime,
      ...time,
    };
    this.globalEventBus.emit("time_update", { ...this.currentTime });
  }

  pause(): void {
    if (this.mode === "replay") {
      this.setReplayAutoPlay(false);
      return;
    }
    this.setAutoPlay(false);
    this.globalEventBus.emit("simulation_status", { status: "paused" });
  }

  resume(): void {
    if (this.mode === "replay") {
      this.setReplayAutoPlay(true);
      return;
    }
    this.setAutoPlay(true);
    this.globalEventBus.emit("simulation_status", { status: "idle" });
  }

  setAutoPlay(enabled: boolean): void {
    if (this.mode === "replay") return;
    this.autoPlay = enabled;
    this.nextTickDueAt = enabled ? performance.now() : 0;
    this.emitPlaybackState();
    if (!enabled) {
      this.globalEventBus.emit("simulation_status", {
        status: this.requestInFlight || this.playbackInProgress ? "pausing" : "paused",
        autoPlay: this.autoPlay,
        tickIntervalMs: this.tickIntervalMs,
      });
    }
  }

  setTickIntervalMs(value: number): void {
    this.tickIntervalMs = value;
    if (this.mode === "replay") {
      this.emitPlaybackState();
      return;
    }
    if (!this.autoPlay) {
      this.nextTickDueAt = 0;
    } else if (this.tickStartedAt > 0) {
      this.nextTickDueAt = this.tickStartedAt + this.tickIntervalMs;
    } else {
      this.nextTickDueAt = performance.now();
    }
    this.emitPlaybackState();
  }

  async devAdvanceTick(): Promise<void> {
    if (this.mode === "replay") return;
    if (this.playbackInProgress) return;

    const isTransitioning = this.currentTime.tick === this.cycleTicks - 1;
    if (isTransitioning && !this.curtainDropped) {
      this.curtainDropped = true;
      this.playbackInProgress = true;
      await new Promise<void>((resolve) => {
        this.globalEventBus.emit("scene_ending", { day: this.currentTime.day });
        this.globalEventBus.once("scene_covered", () => resolve());
        setTimeout(resolve, 2000); // safety fallback
      });
      this.playbackInProgress = false;
    }

    if (this.requestInFlight && !this.prefetchedTick) return;

    this.playbackInProgress = true;
    this.curtainDropped = false;
    this.tickStartedAt = performance.now();
    this.globalEventBus.emit("simulation_status", {
      status: "running",
      autoPlay: this.autoPlay,
      tickIntervalMs: this.tickIntervalMs,
    });

    try {
      const result = this.prefetchedTick ?? await this.fetchTick();
      this.prefetchedTick = null;
      this.currentTime = result.gameTime;

      this.globalEventBus.emit("tick_playback_started", {
        gameTime: result.gameTime,
        eventCount: result.events?.length ?? 0,
      });
      for (const event of result.events || []) {
        this.emit("event", event);
      }
      this.globalEventBus.emit("time_update", { ...this.currentTime });
      this.globalEventBus.emit("tick_playback_events_flushed", {
        gameTime: result.gameTime,
        eventCount: result.events?.length ?? 0,
      });

      if (this.autoPlay) {
        this.ensurePrefetch();
      }

      await this.waitForTickPlaybackCompletion(result.events?.length ?? 0);
      this.globalEventBus.emit("simulation_status", {
        status: this.autoPlay ? "running" : this.requestInFlight ? "pausing" : "paused",
        eventCount: result.eventCount,
        autoPlay: this.autoPlay,
        tickIntervalMs: this.tickIntervalMs,
      });
    } catch (e) {
      this.autoPlay = false;
      this.emitPlaybackState();
      console.warn("[PlaybackController] Failed to simulate tick:", e);
      this.globalEventBus.emit("simulation_status", {
        status: "error",
        message: e instanceof Error ? e.message : String(e),
        autoPlay: this.autoPlay,
        tickIntervalMs: this.tickIntervalMs,
      });
    } finally {
      this.playbackInProgress = false;
      if (this.autoPlay) {
        this.nextTickDueAt = this.tickStartedAt + this.tickIntervalMs;
      } else {
        this.nextTickDueAt = 0;
      }
    }
  }

  private async fetchTick(): Promise<TickResponse> {
    if (!this.liveContext) {
      throw new Error("Simulation context is not ready.");
    }

    this.requestInFlight = true;
    try {
      return await apiClient.simulateTick(this.liveContext);
    } finally {
      this.requestInFlight = false;
    }
  }

  private ensurePrefetch(): void {
    if (!this.autoPlay || this.prefetchedTick || this.requestInFlight) return;
    void this.fetchTick()
      .then((result) => {
        this.prefetchedTick = result;
        if (!this.autoPlay && !this.playbackInProgress) {
          this.globalEventBus.emit("simulation_status", {
            status: "paused",
            autoPlay: this.autoPlay,
            tickIntervalMs: this.tickIntervalMs,
          });
        }
      })
      .catch((error) => {
        this.autoPlay = false;
        this.emitPlaybackState();
        console.warn("[PlaybackController] Failed to prefetch tick:", error);
        this.globalEventBus.emit("simulation_status", {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
          autoPlay: this.autoPlay,
          tickIntervalMs: this.tickIntervalMs,
        });
      });
  }

  private waitForTickPlaybackCompletion(eventCount: number): Promise<void> {
    if (eventCount <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.globalEventBus.once("tick_playback_complete", () => resolve());
    });
  }

  private emitPlaybackState(): void {
    this.globalEventBus.emit("playback_state", {
      autoPlay: this.mode === "replay" ? this.replayAutoPlay : this.autoPlay,
      tickIntervalMs: this.tickIntervalMs,
      mode: this.mode,
    });
  }

  private buildWorldTimeInfo(gameTime: GameTime): WorldTimeInfo {
    const timeString = this.formatTickTime(gameTime.tick);
    return {
      day: gameTime.day,
      tick: gameTime.tick,
      timeString,
      period: this.getTimePeriodLabel(gameTime.tick),
    };
  }

  private formatTickTime(tick: number): string {
    const config = this.sceneConfig;
    const [startH, startM] = (config?.startTime || this.currentTime.timeString || "08:00")
      .split(":")
      .map(Number);
    const tickDurationMinutes = config?.tickDurationMinutes || 15;
    const totalMinutes =
      (Number.isFinite(startH) ? startH : 8) * 60 +
      (Number.isFinite(startM) ? startM : 0) +
      tick * tickDurationMinutes;
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;

    if (config?.displayFormat === "ancient_chinese") {
      return this.formatAncientChineseTime(hours, minutes);
    }
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  private formatAncientChineseTime(hours: number, minutes: number): string {
    const periods = [
      "子", "丑", "寅", "卯", "辰", "巳",
      "午", "未", "申", "酉", "戌", "亥",
    ];
    const idx = Math.floor(((hours + 1) % 24) / 2);
    const half = hours % 2 === 0 ? "初" : "正";
    const hhmm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return `${periods[idx]}时${half} (${hhmm})`;
  }

  private getTimePeriodLabel(tick: number): string {
    const config = this.sceneConfig;
    const [startH, startM] = (config?.startTime || this.currentTime.timeString || "08:00")
      .split(":")
      .map(Number);
    const tickDurationMinutes = config?.tickDurationMinutes || 15;
    const totalMinutes =
      (Number.isFinite(startH) ? startH : 8) * 60 +
      (Number.isFinite(startM) ? startM : 0) +
      tick * tickDurationMinutes;
    const hours = Math.floor(totalMinutes / 60) % 24;

    if (hours >= 5 && hours < 9) return "清晨";
    if (hours >= 9 && hours < 12) return "上午";
    if (hours >= 12 && hours < 14) return "中午";
    if (hours >= 14 && hours < 17) return "下午";
    if (hours >= 17 && hours < 19) return "傍晚";
    if (hours >= 19 && hours < 22) return "晚上";
    return "深夜";
  }
}
