import { createPatchBuffers, createRegions, patchMean } from "./globe.js";
import type {
  ReadonlySimulationView,
  SimulationConfig,
  TimeControls,
} from "./types.js";

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

export class EvolutionSimulation {
  private readonly config: SimulationConfig;
  private readonly regions: ReturnType<typeof createRegions>;
  private readonly patches: Float32Array[];
  private tick = 0;
  private activeRegionId: number | null = null;
  private time: TimeControls = { paused: false, speedMultiplier: 1 };

  constructor(config: SimulationConfig) {
    this.config = config;
    this.regions = createRegions(config);
    this.patches = createPatchBuffers(config);
    this.syncRegionsFromPatches();
  }

  getConfig(): Readonly<SimulationConfig> {
    return this.config;
  }

  setPaused(paused: boolean): void {
    this.time = { ...this.time, paused };
  }

  setSpeedMultiplier(speedMultiplier: number): void {
    const m = Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1;
    this.time = { ...this.time, speedMultiplier: m };
  }

  setActiveRegion(regionId: number | null): void {
    if (regionId === null) {
      this.activeRegionId = null;
      return;
    }
    if (regionId >= 0 && regionId < this.config.regionCount) this.activeRegionId = regionId;
  }

  getView(): ReadonlySimulationView {
    const { regionCount, patchSize } = this.config;
    const regions = this.regions.map((r) => ({ ...r }));
    let total = 0;
    let divSum = 0;
    for (const r of regions) {
      total += r.biomass;
      divSum += r.diversity;
    }
    const summary = {
      tick: this.tick,
      totalBiomass: total,
      meanDiversity: regionCount ? divSum / regionCount : 0,
    };
    const active =
      this.activeRegionId !== null ? this.patches[this.activeRegionId]!.slice() : null;
    return {
      summary,
      regions,
      time: { ...this.time },
      activeRegionId: this.activeRegionId,
      activePatchBiomass: active,
      patchWidth: patchSize,
      patchHeight: patchSize,
    };
  }

  /**
   * @param realDeltaMs elapsed wall time since last tick
   */
  advance(realDeltaMs: number): void {
    if (this.time.paused) return;
    const simSeconds =
      (realDeltaMs / 1000) * this.config.baseSimRate * this.time.speedMultiplier;
    if (simSeconds <= 0) return;

    const maxH = this.config.maxSubStep;
    let remaining = simSeconds;
    while (remaining > 0) {
      const h = Math.min(remaining, maxH);
      this.subStep(h);
      remaining -= h;
    }
    this.tick += 1;
  }

  private subStep(h: number): void {
    this.stepPatches(h);
    this.syncRegionsFromPatches();

    const n = this.config.regionCount;
    const bioMix = 0.28 * h;
    const nextBio = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = this.regions[i]!;
      const neighbors = (this.regions[wrap(i - 1, n)]!.biomass + this.regions[wrap(i + 1, n)]!.biomass) / 2;
      nextBio[i] = clamp01(r.biomass + bioMix * (neighbors - r.biomass));
    }
    for (let i = 0; i < n; i++) this.regions[i]!.biomass = nextBio[i]!;

    const carry = 0.08 * h;
    const divMix = 0.22 * h;
    const noise = 0.05 * h;
    const nextDiv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const r = this.regions[i]!;
      const neighborDiv =
        (this.regions[wrap(i - 1, n)]!.diversity + this.regions[wrap(i + 1, n)]!.diversity) / 2;
      const divDrift = (Math.random() - 0.5) * noise;
      nextDiv[i] = clamp01(
        r.diversity + divMix * (neighborDiv - r.diversity) + divDrift + carry * (r.biomass - 0.5) * 0.03,
      );
    }
    for (let i = 0; i < n; i++) this.regions[i]!.diversity = nextDiv[i]!;
  }

  private stepPatches(h: number): void {
    const w = this.config.patchSize;
    const D = 2.8 * h;
    const localK = 1.05;
    const localR = 0.55 * h;

    for (let ri = 0; ri < this.config.regionCount; ri++) {
      const buf = this.patches[ri]!;
      const next = new Float32Array(buf.length);
      const regionTarget = this.regions[ri]!.biomass;

      for (let py = 0; py < w; py++) {
        for (let px = 0; px < w; px++) {
          const idx = py * w + px;
          const c = buf[idx]!;
          const xm = buf[py * w + wrap(px - 1, w)]!;
          const xp = buf[py * w + wrap(px + 1, w)]!;
          const ym = buf[wrap(py - 1, w) * w + px]!;
          const yp = buf[wrap(py + 1, w) * w + px]!;
          const lap = xm + xp + ym + yp - 4 * c;
          const logistic = localR * c * (1 - c / localK);
          const pull = 0.12 * h * (regionTarget - c);
          let v = c + D * lap + logistic + pull;
          v = clamp01(v);
          next[idx] = v;
        }
      }
      this.patches[ri] = next;
    }
  }

  private syncRegionsFromPatches(): void {
    for (let i = 0; i < this.config.regionCount; i++) {
      this.regions[i]!.biomass = clamp01(patchMean(this.patches[i]!));
    }
  }
}
