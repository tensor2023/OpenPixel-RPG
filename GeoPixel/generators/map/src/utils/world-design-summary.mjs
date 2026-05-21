export function formatWorldActionSummary(worldDesign) {
  const worldActions = worldDesign?.worldActions || [];
  if (worldActions.length === 0) {
    return "必须补充至少一个有世界语义的全局功能；不要只用发呆或移动来代替。";
  }

  return worldActions
    .map((action, index) =>
      `${index + 1}. ${action.name}(${action.id})：${action.description || "全场景可执行动作"}`,
    )
    .join("\n");
}

export function formatRegionSummary(worldDesign) {
  const regions = worldDesign?.regions || [];
  if (regions.length === 0) {
    return "本地图不要求单独的功能区标注，重点表现整个场景的统一功能与风貌。";
  }

  return regions
    .map((region, index) => {
      const modeLabel =
        region.type === "building"
          ? region.enterable
            ? "可进入建筑"
            : "景观建筑"
          : "户外区域";
      return `${index + 1}. ${region.name}（${modeLabel}）｜位置：${region.placementHint || "未指定"}｜外观：${region.visualDescription || region.description || "未指定"}`;
    })
    .join("\n");
}

export function formatElementSummary(worldDesign) {
  const elements = worldDesign?.interactiveElements || [];
  if (elements.length === 0) {
    return "本地图没有独立的可交互元素。";
  }

  return elements
    .map((el, index) =>
      `${index + 1}. ${el.name}｜位置：${el.placementHint || "未指定"}｜外观：${el.visualDescription || el.description || "未指定"}`,
    )
    .join("\n");
}

export function formatMapPlanSummary(worldDesign) {
  const mapPlan = worldDesign?.mapPlan || {};
  return [
    `- buildingMode: ${mapPlan.buildingMode || "mostly_enterable"}`,
    `- compositionNotes: ${mapPlan.compositionNotes || "无"}`,
    `- worldFunctionSummary: ${mapPlan.worldFunctionSummary || "无"}`,
    `- regionDesignNotes: ${mapPlan.regionDesignNotes || "无"}`,
  ].join("\n");
}
