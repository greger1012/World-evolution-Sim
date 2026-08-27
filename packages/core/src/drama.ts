import type { BorderEdge } from "./chunkterrain.js";

/** A noteworthy moment surfaced to the UI (natural-history feed + visual FX). */
export type DramaKind =
  | "kill"
  | "birth"
  | "death"
  | "migration"
  | "speciation"
  | "extinction"
  | "drought"
  | "disease"
  | "storm";

export type DramaEvent = {
  id: number;
  kind: DramaKind;
  simTime: number;
  /** Region index; -1 for world-wide/species events. */
  regionId: number;
  message: string;
  speciesId?: number;
  hue?: number;
  severity?: number;
  /** Arena coordinates when the moment happened in a region. */
  ax?: number;
  ay?: number;
  /** Migration: border crossed on the source chunk. */
  migrationEdge?: BorderEdge;
  /** Migration: neighbouring chunk the creature entered. */
  destRegionId?: number;
};

type DramaInput = Omit<DramaEvent, "id">;

/** Ring buffer of recent simulation drama for the event feed and FX triggers. */
export class DramaLog {
  private events: DramaEvent[] = [];
  private nextId = 1;

  constructor(private readonly capacity = 48) {}

  push(input: DramaInput): void {
    this.events.unshift({ ...input, id: this.nextId++ });
    if (this.events.length > this.capacity) this.events.length = this.capacity;
  }

  snapshot(): readonly DramaEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
    this.nextId = 1;
  }
}
