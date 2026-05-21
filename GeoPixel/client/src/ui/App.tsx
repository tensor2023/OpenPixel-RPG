import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useState, useEffect, useCallback, useRef, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createPortal } from "react-dom";
import Phaser from "phaser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopBar } from "./panels/TopBar";
import { SidePanel } from "./panels/SidePanel";
import { MapControls } from "./panels/MapControls";
import { DialoguePanel } from "./panels/DialoguePanel";
import { SceneTransition } from "./panels/SceneTransition";
import { WorldIntroBanner } from "./panels/WorldIntroBanner";
import { Timeline } from "./pages/Timeline";
import { CreateWorldPage } from "./pages/CreateWorldPage";
import { CreateWorldBackground } from "./pages/CreateWorldBackground";
import type { SimulationEvent, DialogueEventData, WorldTimeInfo } from "../types/api";
import { apiClient } from "./services/api-client";
import type { GeneratedWorldSummary, WorldInfo } from "./services/api-client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

const DEFAULT_TOP_BAR_HEIGHT = 52;

class OverlayErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[OverlayErrorBoundary]", error, info);
    this.props.onError();
  }
  render() { return this.state.hasError ? null : this.props.children; }
}

export function App({ eventBus }: { eventBus: Phaser.Events.EventEmitter }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppContent eventBus={eventBus} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AppContent({ eventBus }: { eventBus: Phaser.Events.EventEmitter }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const backgroundRoot =
    typeof document === "undefined" ? null : document.getElementById("background-root");
  const isDevMode = new URLSearchParams(location.search).get("dev") === "1";
  const isCreateRoute = location.pathname === "/create";
  const [worldsList, setWorldsList] = useState<GeneratedWorldSummary[] | null>(null);
  const [hasUserWorlds, setHasUserWorlds] = useState(false);
  const [gameTime, setGameTime] = useState<WorldTimeInfo>({
    day: 1,
    tick: 0,
    timeString: "08:00",
    period: "上午",
  });
  const [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [followedCharId, setFollowedCharId] = useState<string | null>(null);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const [simStatus, setSimStatus] = useState<"idle" | "running" | "pausing" | "paused" | "error">("idle");
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState<{ current: number; total: number } | null>(null);
  const [dialogueEvents, setDialogueEvents] = useState<SimulationEvent[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const lastTimelineKeyRef = useRef<string | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<"hidden" | "ending" | "starting" | "fade-out">("hidden");
  const [lastKnownDay, setLastKnownDay] = useState(0);
  const [topBarHeight, setTopBarHeight] = useState(DEFAULT_TOP_BAR_HEIGHT);
  const [showWalkableOverlay, setShowWalkableOverlay] = useState(false);
  const [showRegionBoundsOverlay, setShowRegionBoundsOverlay] = useState(false);
  const [showMainAreaPointsOverlay, setShowMainAreaPointsOverlay] = useState(false);
  const [showInteractiveObjectsOverlay, setShowInteractiveObjectsOverlay] = useState(false);
  const isOverlayRoute =
    location.pathname === "/timeline";
  const hideMainChrome = isOverlayRoute || isCreateRoute;
  const ticksPerScene = worldInfo?.sceneRuntime.cycleTicks ?? 48;
  const showDayTransition = worldInfo?.sceneRuntime.transitionEnabled ?? false;
  const endTransitionTitle =
    worldInfo?.sceneConfig.multiDay.endOfDayText || t("app.defaultEndTransition");
  const startTransitionTitle =
    worldInfo?.sceneConfig.multiDay.newDayText ||
    (worldInfo?.sceneConfig.sceneType === "open" ? t("app.defaultStartTransitionOpen") : t("app.defaultStartTransitionClosed"));

  useEffect(() => {
    eventBus.emit("set_cycle_ticks", ticksPerScene);
  }, [ticksPerScene, eventBus]);

  useEffect(() => {
    const timelineId = worldInfo?.currentTimelineId;
    if (!timelineId) return;

    const timelineKey = `${worldInfo?.currentWorldId ?? ""}:${timelineId}`;
    if (lastTimelineKeyRef.current === null) {
      lastTimelineKeyRef.current = timelineKey;
      return;
    }
    if (lastTimelineKeyRef.current === timelineKey) return;

    lastTimelineKeyRef.current = timelineKey;
    setEvents([]);
    setDialogueEvents([]);
    setDismissedIds(new Set());
    setReplayProgress(null);
  }, [worldInfo?.currentWorldId, worldInfo?.currentTimelineId]);

  useEffect(() => {
    const topOffset = hideMainChrome ? 0 : Math.max(topBarHeight, DEFAULT_TOP_BAR_HEIGHT);
    document.documentElement.style.setProperty("--top-ui-offset", `${topOffset}px`);

    const rafId = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [hideMainChrome, topBarHeight]);

  // Hide Phaser canvas / labels on routes that fully take over the screen
  // (e.g. the create-world page). Phaser keeps running but is visually muted.
  useEffect(() => {
    const gameRoot = document.getElementById("game-root");
    const labelRoot = document.getElementById("label-root");
    const hidden = isCreateRoute;
    // Keep layout dimensions intact while hiding the roots. Phaser's RESIZE mode
    // can emit framebuffer errors if we force a resize while the parent is display:none.
    if (gameRoot) {
      gameRoot.style.visibility = hidden ? "hidden" : "";
      gameRoot.style.opacity = hidden ? "0" : "";
    }
    if (labelRoot) {
      labelRoot.style.visibility = hidden ? "hidden" : "";
      labelRoot.style.opacity = hidden ? "0" : "";
    }
    return () => {
      if (gameRoot) {
        gameRoot.style.visibility = "";
        gameRoot.style.opacity = "";
      }
      if (labelRoot) {
        labelRoot.style.visibility = "";
        labelRoot.style.opacity = "";
      }
    };
  }, [isCreateRoute]);

  // Load the list of generated worlds once so we can auto-redirect to /create
  // when the install is empty.
  useEffect(() => {
    let cancelled = false;
    apiClient.getGeneratedWorlds()
      .then((response) => {
        if (cancelled) return;
        const all = [...response.worlds, ...(response.libraryWorlds ?? [])];
        setWorldsList(all);
        setHasUserWorlds(response.worlds.length > 0);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[App] Failed to load generated worlds list:", error);
        setWorldsList([]);
        setHasUserWorlds(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (worldsList === null) return;
    if (worldsList.length === 0 && !isCreateRoute) {
      navigate("/create", { replace: true });
    }
  }, [worldsList, isCreateRoute, navigate]);

  useEffect(() => {
    if (isDevMode) return;
    setShowWalkableOverlay(false);
    setShowRegionBoundsOverlay(false);
    setShowMainAreaPointsOverlay(false);
    setShowInteractiveObjectsOverlay(false);
  }, [isDevMode]);

  useEffect(() => {
    eventBus.emit("toggle_debug_walkable_overlay", isDevMode && showWalkableOverlay);
  }, [eventBus, isDevMode, showWalkableOverlay]);

  useEffect(() => {
    eventBus.emit("toggle_debug_region_bounds_overlay", isDevMode && showRegionBoundsOverlay);
  }, [eventBus, isDevMode, showRegionBoundsOverlay]);

  useEffect(() => {
    eventBus.emit("toggle_debug_main_area_points_overlay", isDevMode && showMainAreaPointsOverlay);
  }, [eventBus, isDevMode, showMainAreaPointsOverlay]);

  useEffect(() => {
    eventBus.emit("toggle_debug_interactive_objects_overlay", isDevMode && showInteractiveObjectsOverlay);
  }, [eventBus, isDevMode, showInteractiveObjectsOverlay]);

  useEffect(() => {
    if (lastKnownDay === 0) {
      if (gameTime.day > 0) setLastKnownDay(gameTime.day);
      return;
    }

    if (!showDayTransition) {
      if (transitionPhase !== "hidden") setTransitionPhase("hidden");
      if (lastKnownDay !== gameTime.day) {
        setLastKnownDay(gameTime.day);
        eventBus.emit("scene_sync_characters");
      }
      return;
    }

    if (gameTime.day > lastKnownDay) {
      setLastKnownDay(gameTime.day);
      setTransitionPhase("starting");
      eventBus.emit("scene_sync_characters");
      
      setTimeout(() => {
        setTransitionPhase("fade-out");
        setTimeout(() => setTransitionPhase("hidden"), 1500);
      }, 3000);
    } else if (gameTime.day < lastKnownDay) {
      setLastKnownDay(gameTime.day);
    }
  }, [gameTime.day, lastKnownDay, showDayTransition, transitionPhase, eventBus]);

  useEffect(() => {
    const onSceneEnding = () => {
      setTransitionPhase("ending");
    };
    eventBus.on("scene_ending", onSceneEnding);
    return () => {
      eventBus.off("scene_ending", onSceneEnding);
    };
  }, [eventBus]);

  useEffect(() => {
    let cancelled = false;
    apiClient.getWorldInfo()
      .then((info) => {
        if (!cancelled) {
          setWorldInfo(info);
        }
      })
      .catch((error) => {
        console.warn("[App] Failed to load world info:", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-enter replay mode when ?mode=replay is in the URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("mode") !== "replay") return;
    const timelineId = worldInfo?.currentTimelineId;
    if (!timelineId) return;
    const timer = setTimeout(() => {
      eventBus.emit("start_replay", timelineId);
    }, 600);
    return () => clearTimeout(timer);
  }, [worldInfo?.currentTimelineId, location.search, eventBus]);

  useEffect(() => {
    const onTimeUpdate = (time: WorldTimeInfo) => setGameTime(time);
    const onCharClick = (id: string) => setSelectedCharId(id);
    const onSimEvent = (event: SimulationEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 50));
    };
    const onSimStatus = (payload: { status?: "idle" | "running" | "pausing" | "paused" | "error" }) => {
      if (payload.status) setSimStatus(payload.status);
    };
    const onDialogue = (event: SimulationEvent) => {
      const dialogue = event.data as DialogueEventData | undefined;
      if (dialogue?.conversationId) {
        setDismissedIds((prev) => {
          if (!prev.has(dialogue.conversationId)) return prev;
          const next = new Set(prev);
          next.delete(dialogue.conversationId);
          return next;
        });
      }
      setDialogueEvents((prev) => [...prev, event]);
    };
    const onPlaybackState = (payload: { autoPlay?: boolean }) => {
      if (payload.autoPlay != null) setAutoPlayEnabled(payload.autoPlay);
    };
    const onReplayMode = (payload: { active: boolean }) => {
      setIsReplaying(payload.active);
      if (payload.active) {
        setEvents([]);
        setDialogueEvents([]);
        setDismissedIds(new Set());
      }
      if (!payload.active) setReplayProgress(null);
    };
    const onReplayProgress = (payload: { current: number; total: number }) => {
      setReplayProgress(payload);
    };
    const onReplayFinished = () => {
      setIsReplaying(false);
    };

    eventBus.on("time_update", onTimeUpdate);
    eventBus.on("character_clicked", onCharClick);
    eventBus.on("sim_event", onSimEvent);
    eventBus.on("simulation_status", onSimStatus);
    eventBus.on("dialogue", onDialogue);
    eventBus.on("playback_state", onPlaybackState);
    eventBus.on("set_replay_mode", onReplayMode);
    eventBus.on("replay_progress", onReplayProgress);
    eventBus.on("replay_finished", onReplayFinished);

    return () => {
      eventBus.off("time_update", onTimeUpdate);
      eventBus.off("character_clicked", onCharClick);
      eventBus.off("sim_event", onSimEvent);
      eventBus.off("simulation_status", onSimStatus);
      eventBus.off("dialogue", onDialogue);
      eventBus.off("playback_state", onPlaybackState);
      eventBus.off("set_replay_mode", onReplayMode);
      eventBus.off("replay_progress", onReplayProgress);
      eventBus.off("replay_finished", onReplayFinished);
    };
  }, [eventBus]);


  const handleToggleDevMode = useCallback(() => {
    const params = new URLSearchParams(location.search);
    if (isDevMode) {
      params.delete("dev");
    } else {
      params.set("dev", "1");
    }
    const newSearch = params.toString();
    navigate(`${location.pathname}${newSearch ? `?${newSearch}` : ""}`, { replace: true });
  }, [isDevMode, location.pathname, location.search, navigate]);

  const handleToggleAutoPlay = useCallback(() => {
    eventBus.emit("set_auto_play", !autoPlayEnabled);
  }, [autoPlayEnabled, eventBus]);

  const handleNewTimeline = useCallback(async () => {
    const confirmed = window.confirm(t("app.confirmNewTimeline"));
    if (!confirmed) return;

    setIsResetting(true);
    try {
      await apiClient.createNewTimeline();
      window.location.reload();
    } catch (error) {
      console.warn("[App] Failed to create new timeline:", error);
      window.alert(t("app.failedPrefix", { error: error instanceof Error ? error.message : String(error) }));
      setIsResetting(false);
    }
  }, [t]);

  const handleToggleFollowChar = useCallback(
    (id: string) => {
      if (followedCharId === id) {
        eventBus.emit("unfollow_character");
        setFollowedCharId(null);
        return;
      }

      eventBus.emit("follow_character", id);
      setFollowedCharId(id);
    },
    [eventBus, followedCharId]
  );

  const handleOverlayError = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const overlayContent =
    location.pathname === "/timeline" ? (
      <Timeline />
    ) : null;

  const overlay = overlayContent ? (
    <OverlayErrorBoundary key={location.pathname} onError={handleOverlayError}>
      {overlayContent}
    </OverlayErrorBoundary>
  ) : null;

  if (isCreateRoute) {
    return (
      <div style={{ width: "100%", height: "100%", pointerEvents: "auto" }}>
        {backgroundRoot &&
          createPortal(<CreateWorldBackground intensity="calm" />, backgroundRoot)}
        <CreateWorldPage hasExistingWorlds={hasUserWorlds} />
      </div>
    );
  }

  return (
    <>
      {backgroundRoot &&
        createPortal(<CreateWorldBackground intensity="calm" />, backgroundRoot)}
      <div style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
        {!hideMainChrome && (
          <MapControls eventBus={eventBus} />
        )}
        {overlay}
      </div>
    </>
  );
}
