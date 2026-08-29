import { RegionEcosystem } from "./creatures.js";
import type { Creature, EcosystemState } from "./creatures.js";
import { ChunkTerrain, WorldTerrain, chunkNeighbors } from "./chunkterrain.js";
import { DramaLog } from "./drama.js";
import { DEFAULT_REGION_MODIFIERS, EventScheduler } from "./events.js";
import type { EventSchedulerState } from "./events.js";
import { SpeciesRegistry } from "./species.js";
import type { SpeciesRegistryState } from "./species.js";
import { chunkAtMapPosition, generateWorldMap, summarizeChunk } from "./worldmap.js";
import type { WorldMapData } from "./worldmap.js";
import type {
  CreatureView,
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

    if (config.worldLayout === "fused") {
      const terrain = new WorldTerrain(this.worldMap);
      this.ecosystems.push(
        new RegionEcosystem({
          size: this.worldMap.width,
          sizeY: this.worldMap.height,
          fusedWorld: true,
          worldMap: this.worldMap,
          richness: terrain.meanRichness(),
          temperature: terrain.meanTemperature(),
          seed: baseSeed,
          initialCreatures: config.initialCreatures * config.regionCount,
          chunkId: 0,
          terrain,
          dramaLog: this.drama,
          idAlloc,
        }),
      );
    } else {
      const terrains: ChunkTerrain[] = [];
      for (let i = 0; i < config.regionCount; i++) {
        terrains.push(new ChunkTerrain(this.worldMap, i));
      }
      for (let i = 0; i < config.regionCount; i++) {
        const terrain = terrains[i]!;
        this.ecosystems.push(
          new RegionEcosystem({
            size: config.patchSize,
            richness: terrain.meanRichness(),
            temperature: terrain.meanTemperature(),
            seed: (baseSeed ^ ((i + 1) * 0x9e3779b1)) >>> 0,
            initialCreatures: config.initialCreatures,
            chunkId: i,
            terrain,
            allTerrains: terrains,
            dramaLog: this.drama,
            idAlloc,
          }),
        );
      }
      this.linkPredationNeighbors();
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
    if (this.config.worldLayout === "fused") {
      const eco = this.ecosystems[0];
      if (!eco) return null;
      const counts = new Map<number, number>();
      for (const c of eco.creaturesRef()) {
        if (c.dead || c.migrated || c.speciesId !== speciesId) continue;
        const chunk = chunkAtMapPosition(this.worldMap, c.x, c.y);
        counts.set(chunk, (counts.get(chunk) ?? 0) + 1);
      }
      let bestId: number | null = null;
      let best = 0;
      for (const [chunk, n] of counts) {
        if (n > best) {
          best = n;
          bestId = chunk;
        }
      }
      return best > 0 ? bestId : null;
    }
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
    if (this.config.worldLayout === "fused") {
      const eco = this.ecosystems[0];
      if (!eco) return null;
      for (const c of eco.creaturesRef()) {
        if (c.dead || c.migrated || c.id !== creatureId) continue;
        return chunkAtMapPosition(this.worldMap, c.x, c.y);
      }
      return null;
    }
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
    const { maxCreatures: _legacyCap, ...config } = saved.config as SimulationConfig & {
      maxCreatures?: number;
    };
    const sim = new EvolutionSimulation(config, saved.seed);
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

  private linkPredationNeighbors(): void {
    for (let i = 0; i < this.ecosystems.length; i++) {
      const n = chunkNeighbors(i);
      this.ecosystems[i]!.linkPredationNeighbors({
        west: n.west !== null ? this.ecosystems[n.west]! : null,
        east: n.east !== null ? this.ecosystems[n.east]! : null,
        north: n.north !== null ? this.ecosystems[n.north]! : null,
        south: n.south !== null ? this.ecosystems[n.south]! : null,
      });
    }
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
    const layout = this.config.worldLayout === "fused" ? "fused" : "chunked";
    const regions: RegionState[] = new Array(this.config.regionCount);
    const worldLayers: RegionLayer[] = new Array(this.config.regionCount);
    let total = 0;
    let divSum = 0;
    let pop = 0;

    if (layout === "fused") {
      const eco = this.ecosystems[0]!;
      const creatures = eco.creatureViews();
      const food = eco.foodViews();
      const layerCreatures: CreatureView[][] = Array.from({ length: this.config.regionCount }, () => []);
      const layerFood: { x: number; y: number }[][] = Array.from(
        { length: this.config.regionCount },
        () => [],
      );

      for (const c of creatures) {
        const chunk = chunkAtMapPosition(this.worldMap, c.x, c.y);
        layerCreatures[chunk]!.push(c);
      }
      for (const f of food) {
        const chunk = chunkAtMapPosition(this.worldMap, f.x, f.y);
        layerFood[chunk]!.push(f);
      }

      for (let i = 0; i < this.config.regionCount; i++) {
        const cs = layerCreatures[i]!;
        const population = cs.length;
        let carnivores = 0;
        for (const c of cs) if (c.diet >= 0.5) carnivores++;
        let diversity = 0;
        if (cs.length >= 2) {
          let mean = 0;
          for (const c of cs) mean += c.radius;
          mean /= cs.length;
          if (mean > 0) {
            let v = 0;
            for (const c of cs) {
              const d = c.radius - mean;
              v += d * d;
            }
            diversity = Math.min(1, (Math.sqrt(v / cs.length) / mean) * 2.2);
          }
        }
        const refPop = Math.max(8, eco.biomass() > 0 ? population / Math.max(0.05, eco.biomass()) : 50);
        const biomass = Math.min(1, population / refPop);
        regions[i] = {
          id: i,
          biomass,
          diversity,
          population,
          carnivores,
          temperature: eco.temperature,
          biome: summarizeChunk(this.worldMap, i).dominant,
          events: this.events.regionEvents(i, this.simTime),
        };
        worldLayers[i] = { creatures: cs, food: layerFood[i]! };
        total += biomass;
        divSum += diversity;
        pop += population;
      }
    } else {
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
        worldLayers[i] = {
          creatures: eco.creatureViews(),
          food: eco.foodViews(),
        };
        total += biomass;
        divSum += diversity;
        pop += population;
      }
    }

    const summary = {
      tick: this.tick,
      simTime: this.simTime,
      totalBiomass: total,
      meanDiversity: this.config.regionCount ? divSum / this.config.regionCount : 0,
      totalPopulation: pop,
      livingSpecies: this.registry.livingCount(),
    };

    const activeLayer =
      this.activeRegionId !== null ? worldLayers[this.activeRegionId]! : null;
    const activeEco = this.ecosystems[0] ?? null;
    const activeChunkTerrain =
      layout === "fused" && this.activeRegionId !== null
        ? new ChunkTerrain(this.worldMap, this.activeRegionId)
        : null;

    return {
      summary,
      regions,
      time: { ...this.time },
      activeRegionId: this.activeRegionId,
      worldLayers,
      activeCreatures: activeLayer?.creatures ?? null,
      activeFood: activeLayer?.food ?? null,
      activeStats: activeEco ? activeEco.stats() : null,
      arenaSize: layout === "fused" ? this.worldMap.width : this.config.patchSize,
      arenaHeight: layout === "fused" ? this.worldMap.height : this.config.patchSize,
      worldLayout: layout,
      activeTerrain: activeChunkTerrain
        ? activeChunkTerrain.renderCells()
        : activeEco
          ? activeEco.terrainViews()
          : null,
      activeTerrainCols: activeChunkTerrain
        ? activeChunkTerrain.cols
        : activeEco
          ? activeEco.terrainCols()
          : 0,
      activeTerrainRows: activeChunkTerrain
        ? activeChunkTerrain.rows
        : activeEco
          ? activeEco.terrainRows()
          : 0,
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
    const fused = this.config.worldLayout === "fused";
    for (let s = 0; s < steps; s++) {
      const t = this.simTime + s * h;
      if (fused) {
        const eco = this.ecosystems[0]!;
        const hooks = Array.from({ length: this.config.regionCount }, (_, i) => ({
          applyStormStart: (severity: number) => eco.applyStormInChunk(i, severity, this.worldMap),
          seedDiseaseOutbreak: (severity: number) =>
            eco.seedDiseaseInChunk(i, severity, this.worldMap),
          applyDroughtStart: (severity: number) =>
            eco.applyDroughtInChunk(i, severity, this.worldMap),
        }));
        this.events.advance(t, h, this.config.regionCount, hooks, this.drama);
        eco.setModifierLookup((chunkId) => this.events.modifiersFor(chunkId, t));
        eco.step(h, DEFAULT_REGION_MODIFIERS, t);
      } else {
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
              edge: e.edge,
            });
          }
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
