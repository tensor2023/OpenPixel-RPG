function clampDuration(value, fallback = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.round(parsed));
}

function normalizeEffects(effects = [], fallbackNeed = "curiosity", fallbackDelta = 5) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [
      {
        type: "character_need",
        target: fallbackNeed,
        value: fallbackDelta,
      },
    ];
  }

  return effects.map((effect) => ({
    type: effect?.type || "character_need",
    target:
      effect?.target ||
      effect?.need ||
      effect?.key ||
      fallbackNeed,
    value:
      effect?.value !== undefined
        ? effect.value
        : effect?.delta !== undefined
          ? effect.delta
          : fallbackDelta,
  }));
}

function normalizeInteraction(interaction, fallbackId, fallbackName) {
  const id = interaction?.id || fallbackId;
  const result = {
    id,
    name: interaction?.name || fallbackName || id,
    description: interaction?.description || "",
    availableWhenState:
      Array.isArray(interaction?.availableWhenState) && interaction.availableWhenState.length > 0
        ? interaction.availableWhenState
        : ["available"],
    duration: clampDuration(interaction?.duration, 2),
    effects: normalizeEffects(interaction?.effects),
    repeatable: interaction?.repeatable ?? true,
  };
  if (interaction?.requiresAnchor === true) {
    result.requiresAnchor = true;
  }
  return result;
}

function inferRegionType(region) {
  if (region?.type === "building" || region?.type === "outdoor") {
    return region.type;
  }

  const haystack = `${region?.id || ""} ${region?.name || ""} ${region?.description || ""}`.toLowerCase();
  const outdoorKeywords = [
    "garden",
    "farm",
    "field",
    "plaza",
    "street",
    "market",
    "bridge",
    "pier",
    "dock",
    "yard",
    "river",
    "path",
    "road",
    "square",
    "广场",
    "街",
    "桥",
    "码头",
    "农田",
    "花园",
    "庭院",
    "摊",
  ];
  return outdoorKeywords.some((keyword) => haystack.includes(keyword))
    ? "outdoor"
    : "building";
}

function normalizeRegion(region, index) {
  const type = inferRegionType(region);
  const id = region?.id || `region_${index + 1}`;
  const name = region?.name || id;
  const enterable = region?.enterable ?? type === "building";
  const interactions = Array.isArray(region?.interactions)
    ? region.interactions.map((interaction, interactionIndex) =>
        normalizeInteraction(interaction, `${id}_action_${interactionIndex + 1}`, interaction?.name || `${name}行动`),
      )
    : [];

  return {
    id,
    name,
    description: region?.description || "",
    type,
    enterable,
    shapeConstraint:
      region?.shapeConstraint ||
      (enterable ? "rectangular" : "flexible"),
    placementHint: region?.placementHint || "",
    visualDescription: region?.visualDescription || "",
    expectedObjects: Array.isArray(region?.expectedObjects) ? region.expectedObjects : [],
    interactions,
  };
}

function normalizeWorldAction(action, index) {
  const fallbackId = action?.id || `world_action_${index + 1}`;
  return {
    ...normalizeInteraction(action, fallbackId, action?.name || fallbackId),
    description: action?.description || "",
  };
}

function deriveLocationsFromRegions(regions) {
  return regions.map((region) => ({
    id: region.id,
    name: region.name,
    description: region.description,
    expectedObjects: region.expectedObjects || [],
    interactions: region.interactions || [],
  }));
}

function deriveMapPlan(mapPlan, regions) {
  const enterableCount = regions.filter((region) => region.enterable).length;
  const scenicCount = regions.filter((region) => !region.enterable && region.type === "building").length;

  let buildingMode = mapPlan?.buildingMode;
  if (!buildingMode) {
    if (regions.length === 0 || scenicCount > enterableCount) {
      buildingMode = "mostly_scenic";
    } else if (enterableCount > 0) {
      buildingMode = "mostly_enterable";
    } else {
      buildingMode = "mostly_scenic";
    }
  }

  return {
    buildingMode,
    compositionNotes: mapPlan?.compositionNotes || "",
    worldFunctionSummary: mapPlan?.worldFunctionSummary || "",
    regionDesignNotes: mapPlan?.regionDesignNotes || "",
  };
}

function normalizeInteractiveElement(element, index) {
  const id = element?.id || `element_${index + 1}`;
  const name = element?.name || id;
  const interactions = Array.isArray(element?.interactions)
    ? element.interactions.map((interaction, interactionIndex) =>
        normalizeInteraction(interaction, `${id}_action_${interactionIndex + 1}`, interaction?.name || `${name}互动`),
      )
    : [];

  return {
    id,
    name,
    description: element?.description || "",
    visualDescription: element?.visualDescription || "",
    placementHint: element?.placementHint || "",
    interactions,
  };
}

function normalizeWorldSocialContext(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeCharacterAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return undefined;
  const type = anchor.type;
  const targetId = anchor.targetId;
  if ((type === "region" || type === "element") && typeof targetId === "string" && targetId.length > 0) {
    return { type, targetId };
  }
  return undefined;
}

function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== "string") return 0;
  const [h, m] = timeStr.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function normalizeTimeConfig(rawTimeConfig, sceneType) {
  const tc = rawTimeConfig && typeof rawTimeConfig === "object" ? rawTimeConfig : {};
  const startTime = typeof tc.startTime === "string" && tc.startTime ? tc.startTime : "08:00";
  const displayFormat =
    tc.displayFormat === "ancient_chinese" || tc.displayFormat === "fantasy"
      ? tc.displayFormat
      : "modern";

  const TICK_DURATION = 15;
  let maxTicks = null;

  if (sceneType === "open") {
    if (typeof tc.endTime === "string" && tc.endTime) {
      const startMin = parseTimeToMinutes(startTime);
      const endMin = parseTimeToMinutes(tc.endTime);
      const diff = (endMin - startMin + 24 * 60) % (24 * 60);
      const windowMinutes = diff === 0 ? 24 * 60 : diff;
      maxTicks = Math.max(1, Math.round(windowMinutes / TICK_DURATION));
    } else if (typeof tc.maxTicks === "number" && Number.isFinite(tc.maxTicks)) {
      maxTicks = Math.max(1, Math.floor(tc.maxTicks));
    } else {
      maxTicks = Math.round((12 * 60) / TICK_DURATION);
    }
  }

  return { startTime, tickDurationMinutes: TICK_DURATION, maxTicks, displayFormat };
}

function normalizeMultiDayConfig(rawInput, sceneType, startTime) {
  const md = rawInput && typeof rawInput === "object" ? rawInput : {};
  const enabled = sceneType === "open";
  const endOfDayText = typeof md.endOfDayText === "string" ? md.endOfDayText : "";
  const newDayText = typeof md.newDayText === "string" ? md.newDayText : (typeof md.dayTransitionText === "string" ? md.dayTransitionText : "");
  const nextDayStartTime = sceneType === "open" ? startTime : "00:00";

  return { enabled, endOfDayText, newDayText, nextDayStartTime };
}

export function normalizeWorldDesign(rawDesign) {
  const rawRegions = Array.isArray(rawDesign?.regions)
    ? rawDesign.regions
    : Array.isArray(rawDesign?.locations)
      ? rawDesign.locations
      : [];
  const regions = rawRegions.map((region, index) => normalizeRegion(region, index));
  const worldActions = Array.isArray(rawDesign?.worldActions)
    ? rawDesign.worldActions.map((action, index) => normalizeWorldAction(action, index))
    : [];
  const interactiveElements = Array.isArray(rawDesign?.interactiveElements)
    ? rawDesign.interactiveElements.map((el, index) => normalizeInteractiveElement(el, index))
    : [];

  const characters = Array.isArray(rawDesign?.characters)
    ? rawDesign.characters.map((char) => ({
        ...char,
        anchor: normalizeCharacterAnchor(char?.anchor),
      }))
    : [];

  const locations = Array.isArray(rawDesign?.locations) && rawDesign.locations.length > 0
    ? rawDesign.locations.map((loc, index) => ({
        id: loc?.id || `location_${index + 1}`,
        name: loc?.name || loc?.id || `location_${index + 1}`,
        description: loc?.description || "",
        expectedObjects: Array.isArray(loc?.expectedObjects) ? loc.expectedObjects : [],
        interactions: Array.isArray(loc?.interactions)
          ? loc.interactions.map((interaction, interactionIndex) =>
              normalizeInteraction(
                interaction,
                `${loc?.id || `location_${index + 1}`}_action_${interactionIndex + 1}`,
                interaction?.name || "互动",
              ),
            )
          : [],
      }))
    : deriveLocationsFromRegions(regions);

  const sceneType = rawDesign?.sceneType === "open" ? "open" : "closed";
  const timeConfig = normalizeTimeConfig(rawDesign?.timeConfig, sceneType);
  const multiDay = normalizeMultiDayConfig(
    rawDesign?.sceneTransitionText || rawDesign?.multiDay,
    sceneType,
    timeConfig.startTime,
  );

  return {
    ...rawDesign,
    sceneType,
    timeConfig,
    multiDay,
    worldSocialContext: normalizeWorldSocialContext(
      rawDesign?.worldSocialContext,
      typeof rawDesign?.worldDescription === "string" ? rawDesign.worldDescription.trim() : "",
    ),
    regions,
    interactiveElements,
    characters,
    locations,
    worldActions,
    mapPlan: deriveMapPlan(rawDesign?.mapPlan, regions),
  };
}
