import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../services/api-client";
import type { TimelineWithWorld, TimelineMeta } from "../../types/api";

export function TimelineManagerModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<TimelineWithWorld[]>([]);
  const [currentTimelineId, setCurrentTimelineId] = useState<string | null>(null);
  const [expandedWorldId, setExpandedWorldId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    apiClient.getAllTimelinesGrouped()
      .then((response) => {
        setGroups(response.groups);
        setCurrentTimelineId(response.currentTimelineId);
        if (response.groups.length > 0 && expandedWorldId === null) {
          const current = response.groups.find((g) => g.isCurrent);
          if (current) setExpandedWorldId(current.worldId);
        }
      })
      .catch((err) => {
        console.warn("[TimelineManager] Failed to load data:", err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const handleDeleteTimeline = async (worldId: string, timeline: TimelineMeta) => {
    if (timeline.id === currentTimelineId) {
      window.alert(t("manager.cannotDeleteActiveTimeline"));
      return;
    }
    const confirmed = window.confirm(
      t("manager.confirmDeleteTimeline", { id: timeline.id }),
    );
    if (!confirmed) return;

    setDeletingId(timeline.id);
    try {
      await apiClient.deleteTimelineFromWorld(worldId, timeline.id);
      loadData();
    } catch (err) {
      window.alert(t("manager.deleteFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteWorld = async (worldId: string, worldName: string) => {
    const group = groups.find((g) => g.worldId === worldId);
    if (group?.isCurrent) {
      window.alert(t("manager.cannotDeleteActiveWorld"));
      return;
    }
    const confirmed = window.confirm(
      t("manager.confirmDeleteWorld", { name: worldName }),
    );
    if (!confirmed) return;

    setDeletingId(worldId);
    try {
      await apiClient.deleteWorld(worldId);
      loadData();
    } catch (err) {
      window.alert(t("manager.deleteFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div style={backdropStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{t("manager.title")}</span>
          <button onClick={onClose} style={closeBtnStyle} aria-label={t("manager.close")}>
            ✕
          </button>
        </div>

        <div className="custom-scrollbar" style={bodyStyle}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>{t("manager.loading")}</div>
          ) : groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, opacity: 0.6 }}>{t("manager.noWorlds")}</div>
          ) : (
            groups.map((group) => {
              const isExpanded = expandedWorldId === group.worldId;
              const isActiveWorld = group.isCurrent;

              return (
                <div key={group.worldId} style={worldGroupStyle}>
                  <div
                    style={worldRowStyle}
                    onClick={() => setExpandedWorldId(isExpanded ? null : group.worldId)}
                  >
                    <span style={{ fontSize: 12, opacity: 0.5, marginRight: 4 }}>
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e8ecff", lineHeight: 1.3 }}>
                        {group.worldName}
                      </div>
                      <div style={{ fontSize: 11, color: "#7c87ad", lineHeight: 1.3 }}>
                        {group.worldId} · {t("manager.timelineCount", { count: group.timelines.length })}
                      </div>
                    </div>
                    {group.source === "library" && (
                      <span style={libraryBadgeStyle}>{t("manager.sampleWorld")}</span>
                    )}
                    {isActiveWorld && (
                      <span style={activeBadgeStyle}>{t("manager.active")}</span>
                    )}
                    {!isActiveWorld && group.source !== "library" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteWorld(group.worldId, group.worldName);
                        }}
                        disabled={deletingId === group.worldId}
                        style={deleteBtnStyle(deletingId === group.worldId)}
                      >
                        {deletingId === group.worldId ? "..." : t("manager.delete")}
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div style={timelinesContainerStyle}>
                      {group.timelines.length === 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.5, padding: "6px 12px" }}>
                          {t("manager.noTimelines")}
                        </div>
                      ) : (
                        group.timelines.map((tl) => {
                          const isActiveTl = tl.id === currentTimelineId;
                          return (
                            <div key={tl.id} style={timelineRowStyle}>
                              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                                <div style={{ fontSize: 12, fontWeight: 500, color: "#d0d6ef", lineHeight: 1.3 }}>
                                  {tl.id}
                                </div>
                                <div style={{ fontSize: 11, color: "#7c87ad", display: "flex", gap: 8, lineHeight: 1.3 }}>
                                  <span>{formatDate(tl.createdAt)}</span>
                                  <span>{t("manager.dayTicks", { day: tl.lastGameTime.day, ticks: tl.tickCount })}</span>
                                  <span style={{
                                    color: tl.status === "recording" ? "#00b894" : "#95a5a6",
                                  }}>
                                    {tl.status}
                                  </span>
                                </div>
                              </div>
                              {isActiveTl ? (
                                <span style={activeBadgeStyle}>{t("manager.active")}</span>
                              ) : (
                                <button
                                  onClick={() => handleDeleteTimeline(group.worldId, tl)}
                                  disabled={deletingId === tl.id}
                                  style={deleteBtnStyle(deletingId === tl.id)}
                                >
                                  {deletingId === tl.id ? "..." : t("manager.delete")}
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
};

const panelStyle: CSSProperties = {
  width: 480,
  maxWidth: "90vw",
  maxHeight: "80vh",
  background: "rgba(14, 18, 36, 0.98)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  color: "#e0e0e0",
};

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#a8b3d4",
  fontSize: 16,
  cursor: "pointer",
  padding: "4px 8px",
  lineHeight: 1,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: "12px 12px 16px",
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(255,255,255,0.22) transparent",
  scrollbarGutter: "stable",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  color: "#e0e0e0",
};

const worldGroupStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.06)",
  overflow: "hidden",
  flexShrink: 0,
};

const worldRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  cursor: "pointer",
  background: "rgba(255,255,255,0.04)",
  transition: "background 0.15s",
};

const timelinesContainerStyle: CSSProperties = {
  borderTop: "1px solid rgba(255,255,255,0.06)",
  display: "flex",
  flexDirection: "column",
};

const timelineRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px 8px 28px",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
};

const activeBadgeStyle: CSSProperties = {
  fontSize: 11,
  color: "#a3f7bf",
  background: "rgba(76,209,148,0.14)",
  border: "1px solid rgba(76,209,148,0.4)",
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const libraryBadgeStyle: CSSProperties = {
  fontSize: 11,
  color: "#a3c2ff",
  background: "rgba(116,185,255,0.12)",
  border: "1px solid rgba(116,185,255,0.3)",
  borderRadius: 999,
  padding: "3px 10px",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function deleteBtnStyle(busy: boolean): CSSProperties {
  return {
    background: "rgba(231,76,60,0.14)",
    border: "1px solid rgba(231,76,60,0.45)",
    color: "#ffd2cf",
    borderRadius: 999,
    padding: "4px 12px",
    fontSize: 11,
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.7 : 1,
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}
