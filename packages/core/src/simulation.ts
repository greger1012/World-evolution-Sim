import { RegionEcosystem } from "./creatures.js";
import { regionRichness, regionSeed } from "./globe.js";
import type {
  ReadonlySimulationView,
  RegionState,
  SimulationConfig,
  TimeControls,
} from "./types.js";

export class EvolutionSimulation {
  private readonly config: SimulationConfig;
  private readonly ecosystems: RegionEcosystem[];
  private tick = 0;
  private activeRegionId: number | null = null;
  private time: TimeControls = { paused: false, speedMultiplier: 1 };

  constructor(config: SimulationConfig, baseSeed = 1337) {
    this.config = config;
    this.ecosystems = [];
    for (let i = 0; i < config.regionCount; i++) {
      this.ecosystems.push(
        new RegionEcosystem({
          size: config.patchSize,
          richness: regionRichness(i, config.regionCount),
          seed: regionSeed(baseSeed, i),
          initialCreatures: config.initialCreatures,
          maxCreatures: config.maxCreatures,
        }),
      );
    }
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
    const regions: RegionState[] = new Array(this.config.regionCount);
    let total = 0;
    let divSum = 0;
    let pop = 0;
    for (let i = 0; i < this.config.regionCount; i++) {
      const eco = this.ecosystems[i]!;
      const biomass = eco.biomass();
      const diversity = eco.diversity();
      const population = eco.population;
      regions[i] = { id: i, biomass, diversity, population, carnivores: eco.carnivoreCount };
      total += biomass;
      divSum += diversity;
      pop += population;
    }

    const summary = {
      tick: this.tick,
      totalBiomass: total,
      meanDiversity: this.config.regionCount ? divSum / this.config.regionCount : 0,
      totalPopulation: pop,
    };

    const activeEco =
      this.activeRegionId !== null ? this.ecosystems[this.activeRegionId]! : null;

    return {
      summary,
      regions,
      time: { ...this.time },
      activeRegionId: this.activeRegionId,
      activeCreatures: activeEco ? activeEco.creatureViews() : null,
      activeFood: activeEco ? activeEco.foodViews() : null,
      activeStats: activeEco ? activeEco.stats() : null,
      arenaSize: this.config.patchSize,
    };
  }

  /**
   * @param realDeltaMs elapsed wall time since last tick
   */
  advance(realDeltaMs: number): void {
    if (this.time.paused) return;
    let simSeconds =
      (realDeltaMs / 1000) * this.config.baseSimRate * this.time.speedMultiplier;
    if (simSeconds <= 0) return;

    // Keep the integration step no larger than maxSubStep so agent behaviour
    // (chasing, catching, foraging) stays valid at high speed multipliers.
    // Past a point this caps the *effective* fast-forward rather than growing
    // the step, trading raw speed for a stable, correct simulation.
    const maxPerFrame = this.config.maxSubStepsPerFrame * this.config.maxSubStep;
    if (simSeconds > maxPerFrame) simSeconds = maxPerFrame;
    let steps = Math.ceil(simSeconds / this.config.maxSubStep);
    if (steps < 1) steps = 1;
    const h = simSeconds / steps;

    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.ecosystems.length; i++) this.ecosystems[i]!.step(h);
    }
    this.tick += 1;
  }
}
