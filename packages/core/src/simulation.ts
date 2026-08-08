import { RegionEcosystem } from "./creatures.js";
import type { Creature } from "./creatures.js";
import { biomeName, regionRichness, regionSeed, regionTemperature } from "./globe.js";
import { SpeciesRegistry } from "./species.js";
import type {
  HistorySample,
  ReadonlySimulationView,
  RegionState,
  SimulationConfig,
  SpeciesRecord,
  TimeControls,
} from "./types.js";

const REGISTRY_REFRESH_INTERVAL = 1; // sim-seconds between species refreshes
const HISTORY_SAMPLE_INTERVAL = 2; // sim-seconds between history samples
const HISTORY_CAPACITY = 512; // samples kept; interval doubles when full

export class EvolutionSimulation {
  private readonly config: SimulationConfig;
  private readonly ecosystems: RegionEcosystem[];
  private readonly registry: SpeciesRegistry;
  private tick = 0;
  private simTime = 0;
  private lastRegistryRefresh = 0;
  private history: HistorySample[] = [];
  private historyInterval = HISTORY_SAMPLE_INTERVAL;
  private lastHistorySample = 0;
  private activeRegionId: number | null = null;
  private time: TimeControls = { paused: false, speedMultiplier: 1 };

  constructor(config: SimulationConfig, baseSeed = 1337) {
    this.config = config;
    this.ecosystems = [];
    let idCounter = 1;
    const idAlloc = () => idCounter++;
    for (let i = 0; i < config.regionCount; i++) {
      this.ecosystems.push(
        new RegionEcosystem({
          size: config.patchSize,
          richness: regionRichness(i, config.regionCount),
          temperature: regionTemperature(i, config.regionCount),
          seed: regionSeed(baseSeed, i),
          initialCreatures: config.initialCreatures,
          maxCreatures: config.maxCreatures,
          idAlloc,
        }),
      );
    }
    this.registry = new SpeciesRegistry(baseSeed);
    this.registry.refresh(this.allCreatures(), 0);
    this.sampleHistory();
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

  /** Every species ever recorded (living and extinct), for the phylogeny. */
  getSpecies(): readonly SpeciesRecord[] {
    return this.registry.all();
  }

  getSpeciesById(id: number): SpeciesRecord | undefined {
    return this.registry.get(id);
  }

  /** Recorded world history, oldest first. */
  getHistory(): readonly HistorySample[] {
    return this.history;
  }

  private allCreatures(): Creature[] {
    const out: Creature[] = [];
    for (const eco of this.ecosystems) {
      for (const c of eco.creaturesRef()) out.push(c);
    }
    return out;
  }

  private sampleHistory(): void {
    const populations = new Map<number, number>();
    let total = 0;
    for (const eco of this.ecosystems) {
      for (const c of eco.creaturesRef()) {
        total++;
        populations.set(c.speciesId, (populations.get(c.speciesId) ?? 0) + 1);
      }
    }
    this.history.push({
      t: this.simTime,
      totalPopulation: total,
      populations: [...populations.entries()],
    });
    if (this.history.length > HISTORY_CAPACITY) {
      // Keep the whole timeline: halve resolution instead of forgetting the past.
      this.history = this.history.filter((_, i) => i % 2 === 0);
      this.historyInterval *= 2;
    }
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
      regions[i] = {
        id: i,
        biomass,
        diversity,
        population,
        carnivores: eco.carnivoreCount,
        temperature: eco.temperature,
        biome: biomeName(eco.temperature, eco.richness),
      };
      total += biomass;
      divSum += diversity;
      pop += population;
    }

    const summary = {
      tick: this.tick,
      simTime: this.simTime,
      totalBiomass: total,
      meanDiversity: this.config.regionCount ? divSum / this.config.regionCount : 0,
      totalPopulation: pop,
      livingSpecies: this.registry.livingCount(),
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

    const n = this.ecosystems.length;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) this.ecosystems[i]!.step(h);
      // Route border-crossers to the neighbouring region (ring topology).
      for (let i = 0; i < n; i++) {
        const out = this.ecosystems[i]!.takeEmigrants();
        for (const e of out) {
          const dest = (i + e.direction + n) % n;
          this.ecosystems[dest]!.receiveMigrant(e);
        }
      }
    }
    this.simTime += simSeconds;
    this.tick += 1;

    if (this.simTime - this.lastRegistryRefresh >= REGISTRY_REFRESH_INTERVAL) {
      this.registry.refresh(this.allCreatures(), this.simTime);
      this.lastRegistryRefresh = this.simTime;
    }
    if (this.simTime - this.lastHistorySample >= this.historyInterval) {
      this.sampleHistory();
      this.lastHistorySample = this.simTime;
    }
  }
}
