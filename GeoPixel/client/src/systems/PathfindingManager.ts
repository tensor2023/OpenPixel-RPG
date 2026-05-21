import EasyStar from "easystarjs";
import { MapManager } from "./MapManager";

type GridPoint = { gx: number; gy: number };
type StepAxis = "h" | "v";

const STAIRCASE_BATCH_SIZE = 2;
const MIN_STAIRCASE_STEPS = 4;

export class PathfindingManager {
  private easystar: EasyStar.js;
  private mapManager: MapManager;

  constructor(mapManager: MapManager) {
    this.mapManager = mapManager;
    this.easystar = new EasyStar.js();
    this.easystar.setGrid(mapManager.collisionGrid);
    this.easystar.setAcceptableTiles([0]);
    this.applyEdgeCosts(mapManager);
  }

  private applyEdgeCosts(map: MapManager): void {
    const EDGE_COST = 3;
    for (let gy = 0; gy < map.gridHeight; gy++) {
      for (let gx = 0; gx < map.gridWidth; gx++) {
        if (!map.isWalkable(gx, gy)) continue;
        if (
          !map.isWalkable(gx - 1, gy) ||
          !map.isWalkable(gx + 1, gy) ||
          !map.isWalkable(gx, gy - 1) ||
          !map.isWalkable(gx, gy + 1)
        ) {
          this.easystar.setAdditionalPointCost(gx, gy, EDGE_COST);
        }
      }
    }
  }

  async findPath(
    fromX: number, fromY: number,
    toX: number, toY: number
  ): Promise<{ x: number; y: number }[] | null> {
    const from = this.mapManager.pixelToGrid(fromX, fromY);
    const to = this.mapManager.pixelToGrid(toX, toY);

    const adjustedTo = this.mapManager.isWalkable(to.gx, to.gy)
      ? to
      : this.findNearestWalkable(to.gx, to.gy);

    if (!adjustedTo) return null;

    return new Promise((resolve) => {
      this.easystar.findPath(
        from.gx, from.gy,
        adjustedTo.gx, adjustedTo.gy,
        (path) => {
          if (!path) { resolve(null); return; }
          const rawPath = path.map((p) => ({ gx: p.x, gy: p.y }));
          const rebalancedPath = this.rebalanceStaircases(rawPath);
          const simplifiedPath = this.simplifyOrthogonalShortcuts(rebalancedPath);
          resolve(simplifiedPath.map((p) => this.mapManager.gridToPixel(p.gx, p.gy)));
        }
      );
      this.easystar.calculate();
    });
  }

  async findPathToLocation(
    fromX: number, fromY: number, locationId: string
  ): Promise<{ x: number; y: number }[] | null> {
    const target = this.mapManager.getRandomWalkablePointInLocation(locationId);
    if (!target) return null;
    return this.findPath(fromX, fromY, target.x, target.y);
  }

  async findPathToObject(
    fromX: number, fromY: number, objectId: string
  ): Promise<{ x: number; y: number }[] | null> {
    const pos = this.mapManager.getObjectInteractionPosition(objectId);
    if (!pos) return null;
    return this.findPath(fromX, fromY, pos.x, pos.y);
  }

  private findNearestWalkable(gx: number, gy: number): { gx: number; gy: number } | null {
    for (let radius = 1; radius <= 10; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (this.mapManager.isWalkable(gx + dx, gy + dy)) {
            return { gx: gx + dx, gy: gy + dy };
          }
        }
      }
    }
    return null;
  }

  private rebalanceStaircases(path: GridPoint[]): GridPoint[] {
    if (path.length <= 2) return path;

    const rebalanced: GridPoint[] = [path[0]];
    let index = 0;

    while (index < path.length - 1) {
      const runEnd = this.findStaircaseRunEnd(path, index);
      if (runEnd != null) {
        const reshaped = this.reshapeStaircaseRun(path.slice(index, runEnd + 1));
        if (reshaped) {
          rebalanced.push(...reshaped.slice(1));
          index = runEnd;
          continue;
        }
      }

      rebalanced.push(path[index + 1]);
      index++;
    }

    return rebalanced;
  }

  private simplifyOrthogonalShortcuts(path: GridPoint[]): GridPoint[] {
    if (path.length <= 2) return this.collapsePath(path);

    const simplified: GridPoint[] = [path[0]];
    let index = 0;

    while (index < path.length - 1) {
      const preferredAxis = this.getStep(path[index], path[index + 1])?.axis ?? null;
      let shortcut:
        | {
            targetIndex: number;
            points: GridPoint[];
          }
        | null = null;

      for (let targetIndex = path.length - 1; targetIndex > index + 1; targetIndex--) {
        const candidate = this.buildOrthogonalShortcut(
          path[index],
          path[targetIndex],
          preferredAxis,
        );
        if (candidate) {
          shortcut = { targetIndex, points: candidate };
          break;
        }
      }

      if (shortcut) {
        simplified.push(...shortcut.points.slice(1));
        index = shortcut.targetIndex;
        continue;
      }

      simplified.push(path[index + 1]);
      index++;
    }

    return this.collapsePath(simplified);
  }

  private buildOrthogonalShortcut(
    from: GridPoint,
    to: GridPoint,
    preferredAxis: StepAxis | null,
  ): GridPoint[] | null {
    if (this.samePoint(from, to)) return [from];

    if (this.isAxisAligned(from, to) && this.isAxisAlignedCorridorClear(from, to)) {
      return [from, to];
    }

    const candidates = [
      this.createLShapeCandidate(from, to, { gx: to.gx, gy: from.gy }, "h"),
      this.createLShapeCandidate(from, to, { gx: from.gx, gy: to.gy }, "v"),
    ].filter((candidate): candidate is { points: GridPoint[]; firstLeg: number; startAxis: StepAxis } => !!candidate);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      if (b.firstLeg !== a.firstLeg) return b.firstLeg - a.firstLeg;
      if (preferredAxis && a.startAxis !== b.startAxis) {
        if (a.startAxis === preferredAxis) return -1;
        if (b.startAxis === preferredAxis) return 1;
      }
      return 0;
    });

    return candidates[0].points;
  }

  private createLShapeCandidate(
    from: GridPoint,
    to: GridPoint,
    corner: GridPoint,
    startAxis: StepAxis,
  ): { points: GridPoint[]; firstLeg: number; startAxis: StepAxis } | null {
    if (this.samePoint(from, corner) || this.samePoint(corner, to)) {
      return null;
    }
    if (!this.isAxisAlignedCorridorClear(from, corner)) return null;
    if (!this.isAxisAlignedCorridorClear(corner, to)) return null;

    return {
      points: [from, corner, to],
      firstLeg: this.manhattanDistance(from, corner),
      startAxis,
    };
  }

  private isAxisAlignedCorridorClear(from: GridPoint, to: GridPoint): boolean {
    if (!this.isAxisAligned(from, to)) return false;

    const stepX = Math.sign(to.gx - from.gx);
    const stepY = Math.sign(to.gy - from.gy);
    const steps = Math.max(Math.abs(to.gx - from.gx), Math.abs(to.gy - from.gy));

    for (let i = 0; i <= steps; i++) {
      const gx = from.gx + stepX * i;
      const gy = from.gy + stepY * i;
      if (!this.mapManager.isWalkable(gx, gy)) {
        return false;
      }
    }

    return true;
  }

  private collapsePath(path: GridPoint[]): GridPoint[] {
    if (path.length <= 2) return path;

    const collapsed: GridPoint[] = [];
    for (const point of path) {
      if (collapsed.length === 0 || !this.samePoint(collapsed[collapsed.length - 1], point)) {
        collapsed.push(point);
      }
    }

    if (collapsed.length <= 2) return collapsed;

    const reduced: GridPoint[] = [collapsed[0]];
    for (let i = 1; i < collapsed.length - 1; i++) {
      const prev = reduced[reduced.length - 1];
      const current = collapsed[i];
      const next = collapsed[i + 1];
      const prevStep = this.getNormalizedDirection(prev, current);
      const nextStep = this.getNormalizedDirection(current, next);
      if (prevStep && nextStep && prevStep.gx === nextStep.gx && prevStep.gy === nextStep.gy) {
        continue;
      }
      reduced.push(current);
    }
    reduced.push(collapsed[collapsed.length - 1]);

    return reduced;
  }

  private findStaircaseRunEnd(path: GridPoint[], startIndex: number): number | null {
    if (startIndex >= path.length - MIN_STAIRCASE_STEPS) return null;

    let previousAxis: StepAxis | null = null;
    let horizontalSign = 0;
    let verticalSign = 0;
    let stepCount = 0;
    let endIndex = startIndex;

    for (let i = startIndex; i < path.length - 1; i++) {
      const step = this.getStep(path[i], path[i + 1]);
      if (!step) break;

      if (previousAxis && step.axis === previousAxis) break;
      if (step.axis === "h") {
        if (horizontalSign !== 0 && step.sign !== horizontalSign) break;
        horizontalSign = step.sign;
      } else {
        if (verticalSign !== 0 && step.sign !== verticalSign) break;
        verticalSign = step.sign;
      }

      previousAxis = step.axis;
      stepCount++;
      endIndex = i + 1;
    }

    return stepCount >= MIN_STAIRCASE_STEPS ? endIndex : null;
  }

  private reshapeStaircaseRun(run: GridPoint[]): GridPoint[] | null {
    if (run.length <= 2) return null;

    const firstStep = this.getStep(run[0], run[1]);
    if (!firstStep) return null;

    const start = run[0];
    const end = run[run.length - 1];
    const horizontalSign = Math.sign(end.gx - start.gx);
    const verticalSign = Math.sign(end.gy - start.gy);
    let remainingHorizontal = Math.abs(end.gx - start.gx);
    let remainingVertical = Math.abs(end.gy - start.gy);
    let axis: StepAxis = firstStep.axis;
    let current = { ...start };
    const reshaped: GridPoint[] = [{ ...start }];

    while (remainingHorizontal > 0 || remainingVertical > 0) {
      if (axis === "h" && remainingHorizontal === 0) {
        axis = "v";
      } else if (axis === "v" && remainingVertical === 0) {
        axis = "h";
      }

      const remaining = axis === "h" ? remainingHorizontal : remainingVertical;
      if (remaining === 0) {
        break;
      }

      const direction = axis === "h" ? horizontalSign : verticalSign;
      let batchSize = Math.min(STAIRCASE_BATCH_SIZE, remaining);
      let advanced = false;

      while (batchSize >= 1 && !advanced) {
        const tentative: GridPoint[] = [];
        let next = { ...current };

        for (let i = 0; i < batchSize; i++) {
          next = axis === "h"
            ? { gx: next.gx + direction, gy: next.gy }
            : { gx: next.gx, gy: next.gy + direction };
          if (!this.mapManager.isWalkable(next.gx, next.gy)) {
            tentative.length = 0;
            break;
          }
          tentative.push(next);
        }

        if (tentative.length === batchSize) {
          reshaped.push(...tentative);
          current = tentative[tentative.length - 1];
          if (axis === "h") {
            remainingHorizontal -= batchSize;
          } else {
            remainingVertical -= batchSize;
          }
          advanced = true;
        } else {
          batchSize--;
        }
      }

      if (!advanced) {
        return null;
      }

      axis = axis === "h" ? "v" : "h";
    }

    const reducedTurns = this.countTurns(reshaped) < this.countTurns(run);
    const reachedSameEnd = current.gx === end.gx && current.gy === end.gy;
    return reducedTurns && reachedSameEnd ? reshaped : null;
  }

  private countTurns(path: GridPoint[]): number {
    let turns = 0;
    let previousAxis: StepAxis | null = null;

    for (let i = 0; i < path.length - 1; i++) {
      const step = this.getStep(path[i], path[i + 1]);
      if (!step) continue;
      if (previousAxis && step.axis !== previousAxis) {
        turns++;
      }
      previousAxis = step.axis;
    }

    return turns;
  }

  private getNormalizedDirection(from: GridPoint, to: GridPoint): GridPoint | null {
    const dx = to.gx - from.gx;
    const dy = to.gy - from.gy;
    if (dx === 0 && dy === 0) return null;
    if (dx !== 0 && dy !== 0) return null;
    return {
      gx: Math.sign(dx),
      gy: Math.sign(dy),
    };
  }

  private manhattanDistance(a: GridPoint, b: GridPoint): number {
    return Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy);
  }

  private isAxisAligned(a: GridPoint, b: GridPoint): boolean {
    return a.gx === b.gx || a.gy === b.gy;
  }

  private samePoint(a: GridPoint, b: GridPoint): boolean {
    return a.gx === b.gx && a.gy === b.gy;
  }

  private getStep(from: GridPoint, to: GridPoint): { axis: StepAxis; sign: number } | null {
    const dx = to.gx - from.gx;
    const dy = to.gy - from.gy;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
    if (dx !== 0) {
      return { axis: "h", sign: Math.sign(dx) };
    }
    return { axis: "v", sign: Math.sign(dy) };
  }

  update(): void {
    this.easystar.calculate();
  }
}
