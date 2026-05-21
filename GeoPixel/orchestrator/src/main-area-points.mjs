const DEFAULT_POINT_RATIO = parseFloat(process.env.MAIN_AREA_POINT_RATIO || "0.1");
const MIN_POINT_SPACING_TILES = parseInt(process.env.MAIN_AREA_POINT_MIN_TILES || "6", 10);
const MAX_POINT_SPACING_TILES = parseInt(process.env.MAIN_AREA_POINT_MAX_TILES || "14", 10);
const SNAP_SEARCH_RADIUS_TILES = parseInt(process.env.MAIN_AREA_POINT_SNAP_TILES || "3", 10);
const MAX_MAIN_AREA_POINTS = parseInt(process.env.MAIN_AREA_POINT_MAX_COUNT || "24", 10);
const ADJACENCY_DISTANCE_MULTIPLIER = parseFloat(
  process.env.MAIN_AREA_POINT_ADJACENCY_MULTIPLIER || "3",
);
const PATH_DETOUR_MULTIPLIER = parseFloat(
  process.env.MAIN_AREA_POINT_PATH_DETOUR_MULTIPLIER || "2.5",
);

export function buildMainAreaPoints({ tmj, collisionLayer, regions = [], elementObjects = [] }) {
  const tileSize = tmj?.tilewidth || 32;
  const gridWidth = tmj?.width || 0;
  const gridHeight = tmj?.height || 0;
  const collisionData = Array.isArray(collisionLayer?.data) ? collisionLayer.data : [];
  if (!gridWidth || !gridHeight || collisionData.length !== gridWidth * gridHeight) {
    return [];
  }

  const worldWidth = gridWidth * tileSize;
  const worldHeight = gridHeight * tileSize;
  const averageDimension = (worldWidth + worldHeight) / 2;
  const baseSpacingPx = clamp(
    averageDimension * DEFAULT_POINT_RATIO,
    MIN_POINT_SPACING_TILES * tileSize,
    MAX_POINT_SPACING_TILES * tileSize,
  );

  const passes = [
    { spacingPx: baseSpacingPx, blockedClearanceTiles: 3, regionMarginPx: tileSize * 2 },
    { spacingPx: Math.max(tileSize * 5, baseSpacingPx * 0.82), blockedClearanceTiles: 2, regionMarginPx: tileSize },
  ];

  for (const pass of passes) {
    const rawPoints = generateCandidates({
      collisionData,
      gridWidth,
      gridHeight,
      tileSize,
      worldWidth,
      worldHeight,
      regions,
      spacingPx: pass.spacingPx,
      blockedClearanceTiles: pass.blockedClearanceTiles,
      regionMarginPx: pass.regionMarginPx,
    });
    if (rawPoints.length > 0) {
      const points = relabelPoints(
        prunePoints(rawPoints, {
          maxPoints: MAX_MAIN_AREA_POINTS,
          worldWidth,
          worldHeight,
        }),
      );
      const withAdjacency = attachAdjacency(points, collisionData, gridWidth, gridHeight, tileSize, pass.spacingPx);
      const elementPoints = buildElementApproachPoints(elementObjects, collisionData, gridWidth, gridHeight, tileSize);
      if (elementPoints.length > 0) {
        return attachAdjacency(
          [...withAdjacency, ...elementPoints],
          collisionData, gridWidth, gridHeight, tileSize, pass.spacingPx,
        );
      }
      return withAdjacency;
    }
  }

  // Even with no grid-based points, generate element approach points
  const elementPoints = buildElementApproachPoints(elementObjects, collisionData, gridWidth, gridHeight, tileSize);
  if (elementPoints.length > 0) {
    return attachAdjacency(elementPoints, collisionData, gridWidth, gridHeight, tileSize, baseSpacingPx);
  }

  return [];
}

function buildElementApproachPoints(elementObjects, collisionData, gridWidth, gridHeight, tileSize) {
  const points = [];
  for (const obj of elementObjects) {
    if (!obj.x || !obj.y || !obj.width || !obj.height) continue;
    const snapped = findBestElementApproachPoint(
      obj,
      collisionData,
      gridWidth,
      gridHeight,
      tileSize,
    );
    if (!snapped) continue;
    const objProps = {};
    (obj.properties || []).forEach((p) => { objProps[p.name] = p.value; });
    const elementId = objProps.objectId || obj.name?.toLowerCase().replace(/\s+/g, "_") || `element_${obj.id}`;
    points.push({
      id: `element_${elementId}`,
      name: `${obj.name || elementId}附近`,
      x: snapped.x,
      y: snapped.y,
      adjacentPointIds: [],
    });
  }
  return points;
}

function findBestElementApproachPoint(box, collisionData, gridWidth, gridHeight, tileSize) {
  const candidates = [
    { x: box.x + box.width / 2, y: box.y + box.height + tileSize },
    { x: box.x + box.width / 2, y: box.y - tileSize },
    { x: box.x - tileSize, y: box.y + box.height / 2 },
    { x: box.x + box.width + tileSize, y: box.y + box.height / 2 },
  ];

  let best = null;
  for (const candidate of candidates) {
    const snapped = snapToWalkableOutsideBox(
      candidate.x,
      candidate.y,
      box,
      collisionData,
      gridWidth,
      gridHeight,
      tileSize,
    );
    if (!snapped) continue;
    if (!best || snapped.score < best.score) {
      best = snapped;
    }
  }

  return best;
}

function snapToWalkableOutsideBox(x, y, box, collisionData, gridWidth, gridHeight, tileSize) {
  const center = {
    gx: clampInt(Math.floor(x / tileSize), 0, gridWidth - 1),
    gy: clampInt(Math.floor(y / tileSize), 0, gridHeight - 1),
  };
  const margin = tileSize * 0.5;
  const boxLeft = box.x - margin;
  const boxTop = box.y - margin;
  const boxRight = box.x + box.width + margin;
  const boxBottom = box.y + box.height + margin;

  const maxRadius = SNAP_SEARCH_RADIUS_TILES + 3;
  let best = null;

  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = center.gx + dx;
        const gy = center.gy + dy;
        if (!isWalkableTile(gx, gy, collisionData, gridWidth, gridHeight)) continue;
        const px = gx * tileSize + tileSize / 2;
        const py = gy * tileSize + tileSize / 2;
        if (px >= boxLeft && px <= boxRight && py >= boxTop && py <= boxBottom) continue;
        const score = Math.hypot(px - x, py - y);
        if (!best || score < best.score) {
          best = { gx, gy, x: px, y: py, score };
        }
      }
    }
    if (best) return best;
  }

  return null;
}

function generateCandidates(params) {
  const {
    collisionData,
    gridWidth,
    gridHeight,
    tileSize,
    worldWidth,
    worldHeight,
    regions,
    spacingPx,
    blockedClearanceTiles,
    regionMarginPx,
  } = params;

  const accepted = [];
  const startX = spacingPx / 2;
  const startY = spacingPx / 2;
  const minPointDistance = spacingPx * 0.72;

  for (let y = startY; y < worldHeight; y += spacingPx) {
    for (let x = startX; x < worldWidth; x += spacingPx) {
      const snapped = snapCandidateToWalkable(
        x,
        y,
        collisionData,
        gridWidth,
        gridHeight,
        tileSize,
      );
      if (!snapped) continue;
      if (!hasWalkableClearance(snapped.gx, snapped.gy, collisionData, gridWidth, gridHeight, blockedClearanceTiles)) {
        continue;
      }
      if (isInsideExpandedRegion(snapped.x, snapped.y, regions, regionMarginPx)) {
        continue;
      }
      if (accepted.some((point) => distance(point, snapped) < minPointDistance)) {
        continue;
      }
      accepted.push({
        x: snapped.x,
        y: snapped.y,
      });
    }
  }

  return accepted;
}

function attachAdjacency(points, collisionData, gridWidth, gridHeight, tileSize, spacingPx) {
  const adjacencyDistance = Math.max(
    tileSize * MIN_POINT_SPACING_TILES,
    spacingPx * ADJACENCY_DISTANCE_MULTIPLIER,
  );
  const pointMap = new Map(points.map((point) => [point.id, point]));

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (distance(a, b) > adjacencyDistance) continue;
      if (!hasWalkablePath(a, b, collisionData, gridWidth, gridHeight, tileSize)) continue;
      pointMap.get(a.id)?.adjacentPointIds.push(b.id);
      pointMap.get(b.id)?.adjacentPointIds.push(a.id);
    }
  }

  for (const point of points) {
    const current = pointMap.get(point.id);
    if (!current || current.adjacentPointIds.length > 0) continue;

    const nearest = points
      .filter((candidate) => candidate.id !== point.id)
      .filter((candidate) =>
        distance(point, candidate) <= adjacencyDistance &&
        hasWalkablePath(point, candidate, collisionData, gridWidth, gridHeight, tileSize)
      )
      .sort((a, b) => distance(point, a) - distance(point, b))
      .find(Boolean);
    if (!nearest) continue;
    current.adjacentPointIds.push(nearest.id);
    pointMap.get(nearest.id)?.adjacentPointIds.push(point.id);
  }

  return points.map((point) => ({
    ...point,
    adjacentPointIds: Array.from(new Set(point.adjacentPointIds)).sort(),
  }));
}

function prunePoints(points, { maxPoints, worldWidth, worldHeight }) {
  if (points.length <= maxPoints) return points;

  const center = { x: worldWidth / 2, y: worldHeight / 2 };
  const remaining = [...points];
  const selected = [];

  remaining.sort((a, b) => distance(a, center) - distance(b, center));
  selected.push(remaining.shift());

  while (selected.length < maxPoints && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const point = remaining[i];
      const score = selected.reduce(
        (minDistance, chosen) => Math.min(minDistance, distance(point, chosen)),
        Number.POSITIVE_INFINITY,
      );
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function relabelPoints(points) {
  return points.map((point, index) => ({
    id: `main_area_point_${index + 1}`,
    name: `主区域点位${index + 1}`,
    x: point.x,
    y: point.y,
    adjacentPointIds: [],
  }));
}

function snapCandidateToWalkable(x, y, collisionData, gridWidth, gridHeight, tileSize) {
  const center = {
    gx: clampInt(Math.floor(x / tileSize), 0, gridWidth - 1),
    gy: clampInt(Math.floor(y / tileSize), 0, gridHeight - 1),
  };
  let best = null;

  for (let radius = 0; radius <= SNAP_SEARCH_RADIUS_TILES; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = center.gx + dx;
        const gy = center.gy + dy;
        if (!isWalkableTile(gx, gy, collisionData, gridWidth, gridHeight)) continue;
        const snapped = {
          gx,
          gy,
          x: gx * tileSize + tileSize / 2,
          y: gy * tileSize + tileSize / 2,
        };
        const score = Math.hypot(snapped.x - x, snapped.y - y);
        if (!best || score < best.score) {
          best = { ...snapped, score };
        }
      }
    }
    if (best) return best;
  }

  return null;
}

function hasWalkableClearance(gx, gy, collisionData, gridWidth, gridHeight, clearanceTiles) {
  for (let dy = -clearanceTiles; dy <= clearanceTiles; dy++) {
    for (let dx = -clearanceTiles; dx <= clearanceTiles; dx++) {
      if (Math.hypot(dx, dy) > clearanceTiles + 0.25) continue;
      if (!isWalkableTile(gx + dx, gy + dy, collisionData, gridWidth, gridHeight)) {
        return false;
      }
    }
  }
  return true;
}

function isInsideExpandedRegion(x, y, regions, marginPx) {
  return regions.some((region) => {
    const left = region.x - marginPx;
    const top = region.y - marginPx;
    const right = region.x + region.width + marginPx;
    const bottom = region.y + region.height + marginPx;
    return x >= left && x <= right && y >= top && y <= bottom;
  });
}

function hasWalkablePath(a, b, collisionData, gridWidth, gridHeight, tileSize) {
  const start = pointToTile(a, tileSize, gridWidth, gridHeight);
  const goal = pointToTile(b, tileSize, gridWidth, gridHeight);
  if (
    !isWalkableTile(start.x, start.y, collisionData, gridWidth, gridHeight) ||
    !isWalkableTile(goal.x, goal.y, collisionData, gridWidth, gridHeight)
  ) {
    return false;
  }

  const directSteps = Math.max(
    1,
    Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y),
  );
  const maxSteps = Math.ceil(directSteps * PATH_DETOUR_MULTIPLIER) + 12;
  const minX = Math.max(0, Math.min(start.x, goal.x) - maxSteps);
  const maxX = Math.min(gridWidth - 1, Math.max(start.x, goal.x) + maxSteps);
  const minY = Math.max(0, Math.min(start.y, goal.y) - maxSteps);
  const maxY = Math.min(gridHeight - 1, Math.max(start.y, goal.y) + maxSteps);

  const queue = [{ x: start.x, y: start.y, steps: 0 }];
  const visited = new Set([`${start.x},${start.y}`]);

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.x === goal.x && current.y === goal.y) return true;
    if (current.steps >= maxSteps) continue;

    for (const [nx, ny] of [
      [current.x + 1, current.y],
      [current.x - 1, current.y],
      [current.x, current.y + 1],
      [current.x, current.y - 1],
    ]) {
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      if (!isWalkableTile(nx, ny, collisionData, gridWidth, gridHeight)) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny, steps: current.steps + 1 });
    }
  }

  return false;
}

function isWalkableTile(gx, gy, collisionData, gridWidth, gridHeight) {
  if (gx < 0 || gy < 0 || gx >= gridWidth || gy >= gridHeight) return false;
  return collisionData[gy * gridWidth + gx] === 0;
}

function pointToTile(point, tileSize, gridWidth, gridHeight) {
  return {
    x: clampInt(Math.floor(point.x / tileSize), 0, gridWidth - 1),
    y: clampInt(Math.floor(point.y / tileSize), 0, gridHeight - 1),
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
