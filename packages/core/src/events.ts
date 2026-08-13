import { makeRng, type Rng } from "./creatures.js";
import type { RegionEventState } from "./types.js";

export type EventKind = "drought" | "disease" | "storm";

/** Live world event targeting one region. */
export type ActiveWorldEvent = {
  kind: EventKind;
  regionId: number;
  startedAt: number;
  duration: number;
  severity: number;
};

/** Per-region multipliers applied during RegionEcosystem.step. */
export type RegionModifiers = {
  foodCapacityMul: number;
  foodRegrowMul: number;
  climateStressMul: number;
  diseaseActive: boolean;
  diseaseSeverity: number;
};

export const DEFAULT_REGION_MODIFIERS: RegionModifiers = {
  foodCapacityMul: 1,
  foodRegrowMul: 1,
  climateStressMul: 1,
  diseaseActive: false,
  diseaseSeverity: 0,
};

export type EventSchedulerState = {
  rng: number;
  active: ActiveWorldEvent[];
  lastCheckTime: number;
};

type RegionEcosystemHooks = {
  applyStormStart(severity: number): void;
  seedDiseaseOutbreak(severity: number): void;
  applyDroughtStart(severity: number): void;
};

const CHECK_INTERVAL = 9; // sim-seconds between spawn rolls
const MAX_ACTIVE = 7;
const SPAWN_CHANCE = 0.38;

/** Deterministic regional disasters — drought, disease, storms. */
export class EventScheduler {
  private readonly rng: Rng;
  private active: ActiveWorldEvent[] = [];
  private lastCheckTime = 0;

  constructor(seed: number, state?: EventSchedulerState) {
    this.rng = makeRng(seed ^ 0x9e3779b9);
    if (state) {
      this.rng.setState(state.rng);
      this.active = state.active.map((e) => ({ ...e }));
      this.lastCheckTime = state.lastCheckTime;
    }
  }

  serializeState(): EventSchedulerState {
    return {
      rng: this.rng.getState(),
      active: this.active.map((e) => ({ ...e })),
      lastCheckTime: this.lastCheckTime,
    };
  }

  /** Advance timers and maybe spawn new events (instant effects on spawn). */
  advance(
    simTime: number,
    dt: number,
    regionCount: number,
    regions: readonly RegionEcosystemHooks[],
  ): void {
    this.active = this.active.filter((e) => simTime - e.startedAt < e.duration);

    if (simTime - this.lastCheckTime < CHECK_INTERVAL) return;
    this.lastCheckTime = simTime;

    if (this.active.length >= MAX_ACTIVE) return;
    if (this.rng() > SPAWN_CHANCE) return;

    const regionId = Math.floor(this.rng() * regionCount);
    const kinds: EventKind[] = ["drought", "disease", "storm"];
    const kind = kinds[Math.floor(this.rng() * kinds.length)]!;
    if (this.active.some((e) => e.regionId === regionId && e.kind === kind)) return;

    const severity = 0.42 + this.rng() * 0.52;
    const duration =
      kind === "storm"
        ? 9 + this.rng() * 14
        : kind === "drought"
          ? 26 + this.rng() * 24
          : 30 + this.rng() * 26;

    this.active.push({
      kind,
      regionId,
      startedAt: simTime,
      duration,
      severity,
    });

    const eco = regions[regionId];
    if (!eco) return;
    switch (kind) {
      case "storm":
        eco.applyStormStart(severity);
        break;
      case "disease":
        eco.seedDiseaseOutbreak(severity);
        break;
      case "drought":
        eco.applyDroughtStart(severity);
        break;
    }
  }

  modifiersFor(regionId: number, simTime: number): RegionModifiers {
    const mods: RegionModifiers = { ...DEFAULT_REGION_MODIFIERS };
    for (const e of this.active) {
      if (e.regionId !== regionId) continue;
      const elapsed = simTime - e.startedAt;
      if (elapsed < 0 || elapsed >= e.duration) continue;
      switch (e.kind) {
        case "drought":
          mods.foodCapacityMul *= 1 - 0.72 * e.severity;
          mods.foodRegrowMul *= 1 - 0.9 * e.severity;
          break;
        case "disease":
          mods.diseaseActive = true;
          mods.diseaseSeverity = Math.max(mods.diseaseSeverity, e.severity);
          break;
        case "storm":
          mods.climateStressMul *= 1 + 1.6 * e.severity;
          break;
      }
    }
    return mods;
  }

  regionEvents(regionId: number, simTime: number): RegionEventState[] {
    const out: RegionEventState[] = [];
    for (const e of this.active) {
      if (e.regionId !== regionId) continue;
      const elapsed = simTime - e.startedAt;
      if (elapsed < 0 || elapsed >= e.duration) continue;
      out.push({
        kind: e.kind,
        severity: e.severity,
        remaining: e.duration - elapsed,
      });
    }
    return out;
  }

  activeCount(simTime: number): number {
    let n = 0;
    for (const e of this.active) {
      if (simTime - e.startedAt < e.duration) n++;
    }
    return n;
  }
}
