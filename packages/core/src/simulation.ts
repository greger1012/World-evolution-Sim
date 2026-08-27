import { RegionEcosystem } from "./creatures.js";
import type { Creature, EcosystemState } from "./creatures.js";
import { ChunkTerrain, chunkNeighbors, edgeOpposite } from "./chunkterrain.js";
import { DramaLog } from "./drama.js";
import { EventScheduler } from "./events.js";
import type { EventSchedulerState } from "./events.js";
import { SpeciesRegistry } from "./species.js";
import type { SpeciesRegistryState } from "./species.js";
import { generateWorldMap } from "./worldmap.js";
import type { WorldMapData } from "./worldmap.js";
import type {
  HistorySample,
  ReadonlySimulationView,
  RegionLayer,
  RegionState,
  SimulationConfig,
  SpeciesRecord,
  TimeControls,
} from "./types.js";

/** JSON-safe snapshot of an entire world, for save/load. */
export type SavedWorld = {
  version: 1;
  seed: number;
  config: SimulationConfig;
  idCounter: number;
  tick: number;
  simTime: number;
  lastRegistryRefresh: number;
  historyInterval: number;
  lastHistorySample: number;
  activeRegionId: number | null;
  time: TimeControls;
  history: HistorySample[];
  ecosystems: EcosystemState[];
  species: SpeciesRegistryState;
  events?: EventSchedulerState;
};

const REGISTRY_REFRESH_INTERVAL = 1; // sim-seconds between species refreshes
const HISTORY_SAMPLE_INTERVAL = 2; // sim-seconds between history samples
const HISTORY_CAPACITY = 512; // samples kept; interval doubles when full

export class EvolutionSimulation {
  private readonly config: SimulationConfig;
  private readonly baseSeed: number;
  private readonly ecosystems: RegionEcosystem[];
  private readonly registry: SpeciesRegistry;
  private readonly worldMap: WorldMapData;
  private readonly drama: DramaLog;
  private events: EventScheduler;
  private idCounter = 1;
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
    this.baseSeed = baseSeed;
    this.worldMap = generateWorldMap(baseSeed);
    this.drama = new DramaLog();
    this.ecosystems = [];
    const idAlloc = () => this.idCounter++;
    for (let i = 0; i < config.regionCount; i++) {
      const terrain = new ChunkTerrain(this.worldMap, i);
      this.ecosystems.push(
        new RegionEcosystem({
          size: config.patchSize,
          richness: terrain.meanRichness(),
          temperature: terrain.meanTemperature(),
          seed: (baseSeed ^ ((i + 1) * 0x9e3779b1)) >>> 0,
          initialCreatures: config.initialCreatures,
          maxCreatures: config.maxCreatures,
          chunkId: i,
          terrain,
          dramaLog: this.drama,
          idAlloc,
        }),
      );
    }
    this.registry = new SpeciesRegistry(baseSeed);
    this.registry.refresh(this.allCreatures(), 0);
    this.events = new EventScheduler(baseSeed);
    this.sampleHistory();
  }

  getConfig(): Readonly<SimulationConfig> {
    return this.config;
  }

  getWorldMap(): Readonly<WorldMapData> {
    return this.worldMap;
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

  /** Chunk with the largest population of a species (for follow-camera). */
  findRegionForSpecies(speciesId: number): number | null {
    let bestId: number | null = null;
    let best = 0;
    for (let i = 0; i < this.ecosystems.length; i++) {
      const n = this.ecosystems[i]!.countSpecies(speciesId);
      if (n > best) {
        best = n;
        bestId = i;
      }
    }
    return best > 0 ? bestId : null;
  }

  /** Chunk currently holding a creature (for follow-camera across migration). */
  findRegionForCreature(creatureId: number): number | null {
    for (let i = 0; i < this.ecosystems.length; i++) {
      if (this.ecosystems[i]!.hasCreature(creatureId)) return i;
    }
    return null;
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

  /** Deep, JSON-safe snapshot of the whole world. */
  serialize(): SavedWorld {
    return {
      version: 1,
      seed: this.baseSeed,
      config: { ...this.config },
      idCounter: this.idCounter,
      tick: this.tick,
      simTime: this.simTime,
      lastRegistryRefresh: this.lastRegistryRefresh,
      historyInterval: this.historyInterval,
      lastHistorySample: this.lastHistorySample,
      activeRegionId: this.activeRegionId,
      time: { ...this.time },
      history: this.history.map((h) => ({
        t: h.t,
        totalPopulation: h.totalPopulation,
        populations: h.populations.map(([id, p]) => [id, p] as [number, number]),
      })),
      ecosystems: this.ecosystems.map((e) => e.serializeState()),
      species: this.registry.serializeState(),
      events: this.events.serializeState(),
    };
  }

  /** Rebuild a world from a serialize() snapshot with exact-resume fidelity. */
  static restore(saved: SavedWorld): EvolutionSimulation {
    if (saved.version !== 1) throw new Error(`Unsupported save version: ${saved.version}`);
    const sim = new EvolutionSimulation({ ...saved.config }, saved.seed);
    sim.idCounter = saved.idCounter;
    sim.tick = saved.tick;
    sim.simTime = saved.simTime;
    sim.lastRegistryRefresh = saved.lastRegistryRefresh;
    sim.historyInterval = saved.historyInterval;
    sim.lastHistorySample = saved.lastHistorySample;
    sim.activeRegionId = saved.activeRegionId;
    sim.time = { ...saved.time };
    sim.history = saved.history.map((h) => ({
      t: h.t,
      totalPopulation: h.totalPopulation,
      populations: h.populations.map(([id, p]) => [id, p] as [number, number]),
    }));
    for (let i = 0; i < sim.ecosystems.length; i++) {
      sim.ecosystems[i]!.restoreState(saved.ecosystems[i]!);
    }
    sim.registry.restoreState(saved.species);
    sim.events = new EventScheduler(saved.seed, saved.events);
    return sim;
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
        biome: eco.chunkLabel(),
        events: this.events.regionEvents(i, this.simTime),
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

    const worldLayers: RegionLayer[] = new Array(this.config.regionCount);
    for (let i = 0; i < this.config.regionCount; i++) {
      const eco = this.ecosystems[i]!;
      worldLayers[i] = {
        creatures: eco.creatureViews(),
        food: eco.foodViews(),
      };
    }

    const activeLayer =
      this.activeRegionId !== null ? worldLayers[this.activeRegionId]! : null;
    const activeEco =
      this.activeRegionId !== null ? this.ecosystems[this.activeRegionId]! : null;

    return {
      summary,
      regions,
      time: { ...this.time },
      activeRegionId: this.activeRegionId,
      worldLayers,
      activeCreatures: activeLayer?.creatures ?? null,
      activeFood: activeLayer?.food ?? null,
      activeStats: activeEco ? activeEco.stats() : null,
      arenaSize: this.config.patchSize,
      activeTerrain: activeEco ? activeEco.terrainViews() : null,
      activeTerrainCols: activeEco ? activeEco.terrainCols() : 0,
      activeTerrainRows: activeEco ? activeEco.terrainRows() : 0,
      recentDrama: this.drama.snapshot(),
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
      const t = this.simTime + s * h;
      this.events.advance(t, h, n, this.ecosystems, this.drama);
      for (let i = 0; i < n; i++) {
        const mods = this.events.modifiersFor(i, t);
        this.ecosystems[i]!.step(h, mods, t);
      }
      // Route border-crossers to orthogonally adjacent chunks on the map grid.
      for (let i = 0; i < n; i++) {
        const out = this.ecosystems[i]!.takeEmigrants();
        const neighbors = chunkNeighbors(i);
        for (const e of out) {
          const dest = neighbors[e.edge];
          if (dest === null || dest < 0 || dest >= n) continue;
          this.ecosystems[dest]!.receiveMigrant({
            creature: e.creature,
            edge: edgeOpposite(e.edge),
          });
        }
      }
    }
    this.simTime += simSeconds;
    this.tick += 1;

    if (this.simTime - this.lastRegistryRefresh >= REGISTRY_REFRESH_INTERVAL) {
      this.registry.refresh(this.allCreatures(), this.simTime, this.drama);
      this.lastRegistryRefresh = this.simTime;
    }
    if (this.simTime - this.lastHistorySample >= this.historyInterval) {
      this.sampleHistory();
      this.lastHistorySample = this.simTime;
    }
  }
}
