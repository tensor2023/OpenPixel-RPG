import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { normalizeWorldDesign } from "./world-design-utils.mjs";
import { buildMainAreaPoints } from "./main-area-points.mjs";

export function generateConfigs(worldDesign, worldDir, options = {}) {
  const normalizedDesign = normalizeWorldDesign(worldDesign);
  const originalPrompt =
    typeof options.originalPrompt === "string" && options.originalPrompt.trim()
      ? options.originalPrompt.trim()
      : undefined;
  const mapDir = join(worldDir, "map");
  const configDir = join(worldDir, "config");
  mkdirSync(configDir, { recursive: true });

  const tmjPath = join(mapDir, "06-final.tmj");
  const tmj = JSON.parse(readFileSync(tmjPath, "utf-8"));

  const regionsLayer = tmj.layers.find((l) => l.name === "regions");
  const objectsLayer = tmj.layers.find((l) => l.name === "interactive_objects");
  const collisionLayer = tmj.layers.find((l) => l.name === "collision");

  const tmjRegions = regionsLayer?.objects || [];
  const tmjObjects = objectsLayer?.objects || [];
  const primaryPublicHubRegion = findPrimaryPublicHubRegion(
    tmjRegions,
    normalizedDesign,
    tmj,
  );
  const mainAreaPointRegions = primaryPublicHubRegion
    ? tmjRegions.filter((region) => region !== primaryPublicHubRegion)
    : tmjRegions;
  const mainAreaPoints = buildMainAreaPoints({
    tmj,
    collisionLayer,
    regions: mainAreaPointRegions,
    elementObjects: tmjObjects,
  });

  const locations = buildLocations(tmjRegions, tmjObjects, normalizedDesign, tmj, {
    primaryPublicHubRegion,
  });
  const worldActions = buildWorldActions(normalizedDesign);
  const sceneConfig = {
    sceneType: normalizedDesign.sceneType,
    startTime: normalizedDesign.timeConfig.startTime,
    tickDurationMinutes: normalizedDesign.timeConfig.tickDurationMinutes,
    maxTicks: normalizedDesign.timeConfig.maxTicks,
    displayFormat: normalizedDesign.timeConfig.displayFormat,
    description: normalizedDesign.worldDescription,
    multiDay: normalizedDesign.multiDay,
    worldName: normalizedDesign.worldName,
    worldDescription: normalizedDesign.worldDescription,
    characterCount: normalizedDesign.characters.length,
  };
  const worldSize = {
    width: tmj.width * tmj.tilewidth,
    height: tmj.height * tmj.tileheight,
    tileSize: tmj.tilewidth,
    gridWidth: tmj.width,
    gridHeight: tmj.height,
  };

  const worldConfig = {
    worldName: normalizedDesign.worldName,
    worldDescription: normalizedDesign.worldDescription,
    worldSocialContext: normalizedDesign.worldSocialContext || normalizedDesign.worldDescription,
    contentLanguage: normalizedDesign.contentLanguage || undefined,
    originalPrompt,
    scene: {
      sceneType: normalizedDesign.sceneType,
      startTime: normalizedDesign.timeConfig.startTime,
      tickDurationMinutes: normalizedDesign.timeConfig.tickDurationMinutes,
      maxTicks: normalizedDesign.timeConfig.maxTicks,
      displayFormat: normalizedDesign.timeConfig.displayFormat,
      description: normalizedDesign.worldDescription,
      multiDay: normalizedDesign.multiDay,
    },
    worldActions,
    locations,
    mainAreaPoints,
    worldSize,
    metadata: {
      worldName: normalizedDesign.worldName,
      worldDescription: normalizedDesign.worldDescription,
      worldSocialContext: normalizedDesign.worldSocialContext || normalizedDesign.worldDescription,
      originalPrompt,
      sceneType: normalizedDesign.sceneType,
      timeConfig: normalizedDesign.timeConfig,
      multiDay: normalizedDesign.multiDay,
      mapPlan: normalizedDesign.mapPlan,
    },
  };

  writeFileSync(join(configDir, "world.json"), JSON.stringify(worldConfig, null, 2));

  const charactersDir = join(configDir, "characters");
  mkdirSync(charactersDir, { recursive: true });

  const charsDir = join(worldDir, "characters");
  let generatedChars = [];
  const charsJsonPath = join(charsDir, "characters.json");
  if (existsSync(charsJsonPath)) {
    generatedChars = JSON.parse(readFileSync(charsJsonPath, "utf-8"));
  }

  const startPositions = findStartPositions(
    collisionLayer?.data || [],
    tmj.width,
    tmj.height,
    tmj.tilewidth,
    tmjRegions,
    normalizedDesign.characters.length
  );

  const characterConfigs = normalizedDesign.characters.map((charDesign, i) => {
    const genChar = generatedChars[i];
    const charId = genChar?.id || `char_${i + 1}`;

    const anchor = charDesign.anchor || undefined;
    let startPos = "main_area";
    if (anchor) {
      const anchoredPos = resolveAnchoredStartPosition(
        anchor,
        tmjRegions,
        tmjObjects,
        collisionLayer?.data || [],
        tmj.width,
        tmj.height,
        tmj.tilewidth,
        mainAreaPoints,
      );
      if (anchoredPos) startPos = anchoredPos;
    }

    const iconicCues = normalizeIconicCues(charDesign.iconicCues);
    const canonicalRefs = normalizeCanonicalRefs(charDesign.canonicalRefs);

    const backgroundMemories = (charDesign.initialMemories || []).map((content) => ({
      type: "reflection",
      content,
      importance: 6,
      tags: ["background"],
    }));

    const signatureMemories = (canonicalRefs?.signatureMoments || []).map((content) => ({
      type: "reflection",
      content,
      importance: 8,
      tags: ["background", "signature_moment"],
    }));

    const config = {
      id: charId,
      name: charDesign.name,
      role: charDesign.role,
      personality: charDesign.personality,
      appearanceHint:
        typeof charDesign.appearanceHint === "string" ? charDesign.appearanceHint : "",
      motivation: charDesign.motivation,
      socialStyle: charDesign.socialStyle,
      startPosition: startPos,
      initialMemories: [...backgroundMemories, ...signatureMemories],
    };

    if (anchor) config.anchor = anchor;
    if (iconicCues) config.iconicCues = iconicCues;
    if (canonicalRefs) config.canonicalRefs = canonicalRefs;

    writeFileSync(join(charactersDir, `${charId}.json`), JSON.stringify(config, null, 2));

    return config;
  });

  writeFileSync(join(configDir, "scene.json"), JSON.stringify(sceneConfig, null, 2));

  console.log(`[ConfigGenerator] Generated configs:`);
  console.log(`  world.json: ${locations.length} locations`);
  console.log(`  characters: ${characterConfigs.length} configs`);
  console.log(`  scene.json: ${sceneConfig.sceneType} scene`);

  return { worldConfig, characterConfigs, sceneConfig };
}

function buildLocations(tmjRegions, tmjObjects, worldDesign, tmj, options = {}) {
  const designedRegions = worldDesign.regions || worldDesign.locations || [];
  const designedElements = worldDesign.interactiveElements || [];
  const primaryPublicHubRegion = options.primaryPublicHubRegion || null;
  const primaryPublicHubId = primaryPublicHubRegion
    ? getRegionId(primaryPublicHubRegion)
    : null;

  // Build element-based objects that belong to main_area
  const elementObjects = buildElementObjects(designedElements, tmjObjects);

  if (tmjRegions.length > 0) {
    const primaryHubObjects = primaryPublicHubRegion
      ? buildObjectsForRegion("main_area", primaryPublicHubRegion, tmjObjects, designedRegions)
      : [];
    const authoredLocations = tmjRegions
      .filter((region) => getRegionId(region) !== primaryPublicHubId)
      .map((region) => {
        const props = getObjectProperties(region);
        const regionId = getRegionId(region);
        const designedLoc = findMatchingLocation(regionId, props, designedRegions);
        const regionObjects = buildObjectsForRegion(regionId, region, tmjObjects, designedRegions);

        const adjacentLocations = tmjRegions
          .filter((other) => other !== region && regionsAreAdjacent(region, other, tmj.tilewidth * 3))
          .map((other) =>
            getRegionId(other) === primaryPublicHubId ? "main_area" : getRegionId(other),
          );

        return {
          id: regionId,
          name: region.name || designedLoc?.name || regionId,
          description: props.description || designedLoc?.description || "",
          adjacentLocations,
          objects: regionObjects,
        };
      });

    const locations = finalizeLocations(
      authoredLocations,
      worldDesign.worldName || "Main Area",
      worldDesign.worldDescription || "",
    );

    // Attach public-hub and element objects to main_area
    if (primaryHubObjects.length > 0 || elementObjects.length > 0) {
      const mainArea = locations.find((l) => l.id === "main_area");
      if (mainArea) {
        mainArea.objects = [...mainArea.objects, ...primaryHubObjects, ...elementObjects];
      }
    }

    return locations;
  }

  const mainObjects = [
    ...designedRegions.flatMap((loc) =>
      (loc.interactions || []).map((inter) => ({
        id: inter.id || `${loc.id}_action`,
        name: inter.name,
        locationId: "main_area",
        defaultState: "available",
        capacity: 2,
        interactions: [
          {
            id: inter.id,
            name: inter.name,
            description: inter.description || "",
            availableWhenState: inter.availableWhenState || ["available"],
            duration: inter.duration || 2,
            effects: inter.effects || [],
            repeatable: inter.repeatable ?? true,
            ...(inter.requiresAnchor === true ? { requiresAnchor: true } : {}),
          },
        ],
      }))
    ),
    ...elementObjects,
  ];

  return finalizeLocations([
    {
      id: "main_area",
      name: worldDesign.worldName || "Main Area",
      description: worldDesign.worldDescription || "",
      adjacentLocations: [],
      objects: mainObjects,
    },
  ], worldDesign.worldName || "Main Area", worldDesign.worldDescription || "");
}

function buildObjectsForRegion(locationId, region, tmjObjects, designedRegions) {
  const props = getObjectProperties(region);
  const regionId = getRegionId(region);
  const designedLoc = findMatchingLocation(regionId, props, designedRegions);
  const regionObjects = tmjObjects
    .filter((obj) => isObjectInRegion(obj, region))
    .map((obj) => {
      const objProps = getObjectProperties(obj);

      let interactions = [];
      if (objProps.interactions) {
        try {
          interactions = JSON.parse(objProps.interactions);
        } catch {
          interactions = [];
        }
      }

      return {
        id:
          objProps.objectId ||
          obj.name?.toLowerCase().replace(/\s+/g, "_") ||
          `obj_${obj.id}`,
        name: obj.name || "Unknown Object",
        locationId,
        defaultState: "available",
        capacity: 1,
        interactions: interactions.map((inter) => ({
          id: inter.id || inter.name?.toLowerCase().replace(/\s+/g, "_"),
          name: inter.name || inter.id,
          description: inter.description || "",
          availableWhenState: inter.availableWhenState || ["available"],
          duration: inter.duration || 2,
          effects: inter.effects || [{ type: "character_need", target: "curiosity", value: 5 }],
          repeatable: inter.repeatable ?? true,
        })),
      };
    });

  if (designedLoc?.interactions && regionObjects.length === 0) {
    designedLoc.interactions.forEach((inter) => {
      regionObjects.push({
        id: inter.id || `${regionId}_action`,
        name: inter.name,
        locationId,
        defaultState: "available",
        capacity: 2,
        interactions: [
          {
            id: inter.id,
            name: inter.name,
            description: inter.description || "",
            availableWhenState: inter.availableWhenState || ["available"],
            duration: inter.duration || 2,
            effects: inter.effects || [],
            repeatable: inter.repeatable ?? true,
            ...(inter.requiresAnchor === true ? { requiresAnchor: true } : {}),
          },
        ],
      });
    });
  }

  return regionObjects;
}

function buildElementObjects(designedElements, tmjObjects) {
  return designedElements.map((element) => {
    const interactions = (element.interactions || []).map((inter) => ({
      id: inter.id || `${element.id}_action`,
      name: inter.name || inter.id,
      description: inter.description || "",
      availableWhenState: inter.availableWhenState || ["available"],
      duration: inter.duration || 2,
      effects: inter.effects || [],
      repeatable: inter.repeatable ?? true,
      ...(inter.requiresAnchor === true ? { requiresAnchor: true } : {}),
    }));

    return {
      id: element.id,
      name: element.name,
      locationId: "main_area",
      defaultState: "available",
      capacity: 2,
      interactions,
    };
  });
}

function buildWorldActions(worldDesign) {
  return (worldDesign.worldActions || []).map((action) => ({
    id: action.id,
    name: action.name,
    description: action.description || "",
    availableWhenState: action.availableWhenState || ["available"],
    duration: action.duration || 2,
    effects: action.effects || [],
    repeatable: action.repeatable ?? true,
  }));
}

const PUBLIC_HUB_KEYWORDS = [
  "common",
  "central",
  "hall",
  "lobby",
  "plaza",
  "street",
  "activity",
  "public",
  "square",
  "atrium",
  "courtyard",
  "公共",
  "中央",
  "大厅",
  "广场",
  "主街",
  "活动区",
  "公区",
  "中庭",
  "院落",
];

const PRIVATE_REGION_KEYWORDS = [
  "cell",
  "room",
  "bedroom",
  "private",
  "office",
  "storage",
  "toilet",
  "bathroom",
  "kitchen",
  "hut",
  "house",
  "囚室",
  "房间",
  "卧室",
  "牢房",
  "办公室",
  "储藏",
  "厕所",
  "卫生间",
  "厨房",
  "小屋",
];

const PUBLIC_HUB_MIN_AREA_RATIO = parseFloat(
  process.env.PRIMARY_PUBLIC_HUB_MIN_AREA_RATIO || "0.08",
);
const PUBLIC_HUB_MIN_DIMENSION_TILES = parseInt(
  process.env.PRIMARY_PUBLIC_HUB_MIN_DIMENSION_TILES || "8",
  10,
);

function findPrimaryPublicHubRegion(tmjRegions, worldDesign, tmj) {
  if (!Array.isArray(tmjRegions) || tmjRegions.length === 0 || !tmj) {
    return null;
  }

  const anchoredRegionIds = getAnchoredRegionIds(worldDesign);
  const worldArea = Math.max(1, (tmj.width || 0) * (tmj.height || 0) * (tmj.tilewidth || 32) ** 2);
  const minDimensionPx = (tmj.tilewidth || 32) * PUBLIC_HUB_MIN_DIMENSION_TILES;
  const candidates = tmjRegions.filter((region) => {
    const identifiers = getRegionIdentifiers(region);
    if (identifiers.some((id) => anchoredRegionIds.has(id))) {
      return false;
    }

    const text = getRegionSearchText(region, worldDesign);
    if (!containsKeyword(text, PUBLIC_HUB_KEYWORDS)) {
      return false;
    }
    if (containsKeyword(text, PRIVATE_REGION_KEYWORDS)) {
      return false;
    }

    const area = getRegionArea(region);
    const areaRatio = area / worldArea;
    const hasLargeArea = areaRatio >= PUBLIC_HUB_MIN_AREA_RATIO;
    const hasLargeDimensions =
      (region.width || 0) >= minDimensionPx && (region.height || 0) >= minDimensionPx;
    return hasLargeArea || hasLargeDimensions;
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => getRegionArea(b) - getRegionArea(a))[0];
}

function getAnchoredRegionIds(worldDesign) {
  const anchoredIds = new Set();
  for (const character of worldDesign.characters || []) {
    const anchor = character.anchor;
    if (anchor?.type !== "region" || typeof anchor.targetId !== "string") {
      continue;
    }
    anchoredIds.add(normalizeIdentifier(anchor.targetId));
  }
  return anchoredIds;
}

function getRegionSearchText(region, worldDesign) {
  const props = getObjectProperties(region);
  const regionId = getRegionId(region);
  const designedLoc = findMatchingLocation(
    regionId,
    props,
    worldDesign.regions || worldDesign.locations || [],
  );
  return [
    regionId,
    region.name,
    props.name,
    props.description,
    designedLoc?.id,
    designedLoc?.name,
    designedLoc?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function containsKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function getRegionIdentifiers(region) {
  const props = getObjectProperties(region);
  return [
    props.id,
    region.name,
    region.name?.toLowerCase().replace(/\s+/g, "_"),
    `region_${region.id}`,
  ]
    .filter(Boolean)
    .map(normalizeIdentifier);
}

function getRegionArea(region) {
  return Math.max(0, region.width || 0) * Math.max(0, region.height || 0);
}

function getObjectProperties(obj) {
  const props = {};
  (obj.properties || []).forEach((p) => {
    props[p.name] = p.value;
  });
  return props;
}

function getRegionId(region) {
  const props = getObjectProperties(region);
  return props.id || region.name?.toLowerCase().replace(/\s+/g, "_") || `region_${region.id}`;
}

function normalizeIdentifier(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, "_");
}

function findMatchingLocation(regionId, regionProps, designedLocations) {
  return designedLocations.find((loc) => {
    if (loc.id === regionId) return true;
    const locName = loc.name?.toLowerCase();
    const regName = regionProps.description?.toLowerCase() || regionId.toLowerCase();
    return locName && (regName.includes(locName) || locName.includes(regName));
  });
}

function isObjectInRegion(obj, region) {
  const ox = obj.x + (obj.width || 0) / 2;
  const oy = obj.y + (obj.height || 0) / 2;
  return (
    ox >= region.x &&
    ox <= region.x + region.width &&
    oy >= region.y &&
    oy <= region.y + region.height
  );
}

function regionsAreAdjacent(a, b, threshold) {
  const aCx = a.x + a.width / 2;
  const aCy = a.y + a.height / 2;
  const bCx = b.x + b.width / 2;
  const bCy = b.y + b.height / 2;
  const dist = Math.sqrt((aCx - bCx) ** 2 + (aCy - bCy) ** 2);
  const minDist = (Math.max(a.width, a.height) + Math.max(b.width, b.height)) / 2;
  return dist < minDist + threshold;
}

function finalizeLocations(locations, worldName, worldDescription) {
  const authoredLocations = Array.isArray(locations) ? locations : [];
  const authoredIds = authoredLocations
    .map((location) => location.id)
    .filter((locationId) => locationId && locationId !== "main_area");
  const hasMainArea = authoredLocations.some((location) => location.id === "main_area");
  const withMainArea = hasMainArea
    ? authoredLocations
    : [
        {
          id: "main_area",
          name: "主区域",
          description: worldDescription || `${worldName}中的公共活动区域`,
          adjacentLocations: [...authoredIds],
          objects: [],
        },
        ...authoredLocations,
      ];

  const allIds = withMainArea.map((location) => location.id);
  const hasAnyAuthoredAdjacency = withMainArea.some(
    (location) =>
      location.id !== "main_area" && Array.isArray(location.adjacentLocations) && location.adjacentLocations.length > 0,
  );

  return withMainArea.map((location) => {
    let adjacentLocations = unique(
      (location.adjacentLocations || []).filter(
        (adjacentId) => adjacentId && adjacentId !== location.id && allIds.includes(adjacentId),
      ),
    );

    if (location.id === "main_area") {
      adjacentLocations = unique([...adjacentLocations, ...authoredIds]);
    } else if (adjacentLocations.length === 0) {
      adjacentLocations = hasAnyAuthoredAdjacency
        ? ["main_area"]
        : allIds.filter((adjacentId) => adjacentId !== location.id);
    } else {
      adjacentLocations = unique(["main_area", ...adjacentLocations]);
    }

    return {
      ...location,
      adjacentLocations,
    };
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function findStartPositions(collisionData, gridWidth, gridHeight, tileSize, regions, count) {
  const walkable = [];
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (collisionData[y * gridWidth + x] === 0) {
        walkable.push({ x, y });
      }
    }
  }

  const preferredWalkable = getLargestWalkableComponent(collisionData, gridWidth, gridHeight);
  const spawnableWalkable =
    preferredWalkable.size > 0
      ? walkable.filter(({ x, y }) => preferredWalkable.has(`${x},${y}`))
      : walkable;

  if (spawnableWalkable.length === 0) {
    return Array.from({ length: count }, (_, i) => ({
      tileX: Math.floor(gridWidth / 2) + i,
      tileY: Math.floor(gridHeight / 2),
      pixelX: (Math.floor(gridWidth / 2) + i) * tileSize,
      pixelY: Math.floor(gridHeight / 2) * tileSize,
      locationId: regions[0]?.name?.toLowerCase().replace(/\s+/g, "_") || "main_area",
    }));
  }

  const step = Math.max(1, Math.floor(spawnableWalkable.length / (count + 1)));
  return Array.from({ length: count }, (_, i) => {
    const pos = spawnableWalkable[Math.min((i + 1) * step, spawnableWalkable.length - 1)];

    let locationId = "main_area";
    if (regions.length > 0) {
      const px = pos.x * tileSize;
      const py = pos.y * tileSize;
      for (const region of regions) {
        if (
          px >= region.x &&
          px <= region.x + (region.width || 0) &&
          py >= region.y &&
          py <= region.y + (region.height || 0)
        ) {
          const props = {};
          (region.properties || []).forEach((p) => {
            props[p.name] = p.value;
          });
          locationId =
            props.id || region.name?.toLowerCase().replace(/\s+/g, "_") || locationId;
          break;
        }
      }
    }

    return {
      tileX: pos.x,
      tileY: pos.y,
      pixelX: pos.x * tileSize,
      pixelY: pos.y * tileSize,
      locationId,
    };
  });
}

function getLargestWalkableComponent(collisionData, gridWidth, gridHeight) {
  const walkable = new Set();
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (collisionData[y * gridWidth + x] === 0) {
        walkable.add(`${x},${y}`);
      }
    }
  }

  if (walkable.size === 0) {
    return new Set();
  }

  const visited = new Set();
  let largest = new Set();

  for (const key of walkable) {
    if (visited.has(key)) continue;

    const component = new Set();
    const queue = [key];
    visited.add(key);

    while (queue.length > 0) {
      const currentKey = queue.shift();
      component.add(currentKey);
      const [x, y] = currentKey.split(",").map(Number);
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];

      for (const [nx, ny] of neighbors) {
        const neighborKey = `${nx},${ny}`;
        if (!walkable.has(neighborKey) || visited.has(neighborKey)) continue;
        visited.add(neighborKey);
        queue.push(neighborKey);
      }
    }

    if (component.size > largest.size) {
      largest = component;
    }
  }

  return largest;
}

function resolveAnchoredStartPosition(anchor, tmjRegions, tmjObjects, collisionData, gridWidth, gridHeight, tileSize, mainAreaPoints) {
  if (anchor.type === "region") {
    const region = tmjRegions.find((r) => {
      const props = {};
      (r.properties || []).forEach((p) => { props[p.name] = p.value; });
      return props.id === anchor.targetId || r.name?.toLowerCase().replace(/\s+/g, "_") === anchor.targetId;
    });
    if (region) {
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      const gx = Math.floor(centerX / tileSize);
      const gy = Math.floor(centerY / tileSize);
      const walkable = findNearestWalkableTile(gx, gy, collisionData, gridWidth, gridHeight, 5);
      if (walkable) {
        return {
          tileX: walkable.x,
          tileY: walkable.y,
          pixelX: walkable.x * tileSize + tileSize / 2,
          pixelY: walkable.y * tileSize + tileSize / 2,
          locationId: anchor.targetId,
        };
      }
    }
  } else if (anchor.type === "element") {
    const elementPointId = `element_${anchor.targetId}`;
    const point = mainAreaPoints.find((p) => p.id === elementPointId);
    if (point) {
      const gx = Math.floor(point.x / tileSize);
      const gy = Math.floor(point.y / tileSize);
      return {
        tileX: gx,
        tileY: gy,
        pixelX: point.x,
        pixelY: point.y,
        locationId: "main_area",
        mainAreaPointId: elementPointId,
      };
    }
    // Fallback: find element in TMJ objects, place outside its bounding box
    const obj = tmjObjects.find((o) => {
      const props = {};
      (o.properties || []).forEach((p) => { props[p.name] = p.value; });
      return props.objectId === anchor.targetId;
    });
    if (obj) {
      const approachX = obj.x + (obj.width || 0) / 2;
      const approachY = obj.y + (obj.height || 0) + tileSize;
      const startGx = Math.floor(approachX / tileSize);
      const startGy = Math.floor(approachY / tileSize);
      const walkable = findNearestWalkableTileOutsideBox(
        startGx, startGy, obj, collisionData, gridWidth, gridHeight, tileSize, 8,
      );
      if (walkable) {
        return {
          tileX: walkable.x,
          tileY: walkable.y,
          pixelX: walkable.x * tileSize + tileSize / 2,
          pixelY: walkable.y * tileSize + tileSize / 2,
          locationId: "main_area",
        };
      }
    }
  }
  return null;
}

function findNearestWalkableTile(cx, cy, collisionData, gridWidth, gridHeight, maxRadius) {
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;
        if (collisionData[y * gridWidth + x] === 0) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

function findNearestWalkableTileOutsideBox(cx, cy, box, collisionData, gridWidth, gridHeight, tileSize, maxRadius) {
  const margin = tileSize * 0.5;
  const boxLeft = (box.x || 0) - margin;
  const boxTop = (box.y || 0) - margin;
  const boxRight = (box.x || 0) + (box.width || 0) + margin;
  const boxBottom = (box.y || 0) + (box.height || 0) + margin;

  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;
        if (collisionData[y * gridWidth + x] !== 0) continue;
        const px = x * tileSize + tileSize / 2;
        const py = y * tileSize + tileSize / 2;
        if (px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom) continue;
        return { x, y };
      }
    }
  }
  return null;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
}

function normalizeIconicCues(raw) {
  if (!raw || typeof raw !== "object") return null;
  const speechQuirks = toStringArray(raw.speechQuirks);
  const catchphrases = toStringArray(raw.catchphrases).slice(0, 2);
  const behavioralTics = toStringArray(raw.behavioralTics);
  if (speechQuirks.length === 0 && catchphrases.length === 0 && behavioralTics.length === 0) {
    return null;
  }
  return { speechQuirks, catchphrases, behavioralTics };
}

function normalizeCanonicalRefs(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = typeof raw.source === "string" ? raw.source.trim() : "";
  const keyRelationships = toStringArray(raw.keyRelationships);
  const signatureMoments = toStringArray(raw.signatureMoments).slice(0, 2);
  if (!source && keyRelationships.length === 0 && signatureMoments.length === 0) {
    return null;
  }
  return {
    source: source || undefined,
    keyRelationships,
    signatureMoments,
  };
}
