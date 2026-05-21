import type { SimulationEvent } from "../types/api";

export class EventQueue {
  private buffer: SimulationEvent[] = [];
  private emittedIds = new Set<string>();

  addEvents(events: SimulationEvent[]): void {
    for (const e of events) {
      if (!this.emittedIds.has(e.id)) {
        this.buffer.push(e);
      }
    }
    this.buffer.sort((a, b) =>
      a.gameDay !== b.gameDay ? a.gameDay - b.gameDay : a.gameTick - b.gameTick
    );
  }

  releaseUpTo(day: number, tick: number): SimulationEvent[] {
    const toRelease: SimulationEvent[] = [];
    const remaining: SimulationEvent[] = [];

    for (const e of this.buffer) {
      if (e.gameDay < day || (e.gameDay === day && e.gameTick <= tick)) {
        toRelease.push(e);
        this.emittedIds.add(e.id);
      } else {
        remaining.push(e);
      }
    }

    this.buffer = remaining;
    return toRelease;
  }

  get length(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.emittedIds.clear();
  }
}
