/** Planet-wide aggregates (stratum above regions). */
export type GlobeSummary = {
  tick: number;
  /** Simulated seconds elapsed since the world began. */
  simTime: number;
  totalBiomass: number;
  meanDiversity: number;
  totalPopulation: number;
  /** Number of species with living members. */
  livingSpecies: number;
};

/** A species: a named breeding lineage tracked from founding to extinction. */
export type SpeciesRecord = {
  id: number;
  name: string;
  /** Species this one split from; null for founder species. */
  parentId: number | null;
  /** Representative lineage colour (circular mean of members). */
  hue: number;
  trophic: "herbivore" | "carnivore";
  /** Sim-time when the species appeared. */
  foundedAt: number;
  /** Sim-time when the last member died; null while extant. */
  extinctAt: number | null;
  population: number;
  peakPopulation: number;
};

/** One point of recorded world history. */
export type HistorySample = {
  /** Sim-time of the sample. */
  t: number;
  totalPopulation: number;
  /** [speciesId, population] pairs for species alive at the time. */
  populations: [number, number][];
};

/** Snapshot of an active regional world event for the globe UI. */
export type RegionEventState = {
  kind: "drought" | "disease" | "storm";
  /** 0–1 intensity. */
  severity: number;
  /** Sim-seconds until the event ends. */
  remaining: number;
};

export type RegionState = {
  id: number;
  /** 0–1 normalized ecosystem health (population relative to carrying capacity). */
  biomass: number;
  /** 0–1 genome-trait dispersion within the region. */
  diversity: number;
  /** Live creature count in the region. */
  population: number;
  /** Live predator count (diet >= 0.5) in the region. */
  carnivores: number;
  /** Climate: 0 = frozen, 1 = scorching. */
  temperature: number;
  /** Human-readable biome (from temperature + richness). */
  biome: string;
  /** Ongoing droughts, outbreaks, or storms in this region. */
  events: readonly RegionEventState[];
};

export type TimeControls = {
  paused: boolean;
  /**
   * Effective sim rate vs wall clock at 1x baseline.
   * 1 = default real-time pacing; higher values fast-forward.
   */
  speedMultiplier: number;
};

export type SimulationConfig = {
  regionCount: number;
  /** Arena edge length in world units (also the render grid resolution hint). */
  patchSize: number;
  /**
   * Simulated seconds advanced per one real second when multiplier is 1.
   */
  baseSimRate: number;
  /** Maximum integration sub-step for stability under fast-forward. */
  maxSubStep: number;
  /** Upper bound on sub-steps per frame, so extreme fast-forward stays responsive. */
  maxSubStepsPerFrame: number;
  /** Creatures seeded into each region at start. */
  initialCreatures: number;
  /** Hard cap on creatures per region. */
  maxCreatures: number;
};

/** Heritable traits. Colors/behaviour derive from these. */
export type Genome = {
  /** Body radius in world units — drives energy cost, reach, and collision. */
  size: number;
  /** Movement speed factor. */
  speed: number;
  /** Perception radius in world units for locating food/threats. */
  sense: number;
  /** Trophic tendency: 0 = pure herbivore (plants), 1 = pure carnivore (prey). */
  diet: number;
  /** 0–1 plating: blocks and punishes attacks, but is heavy and costly. */
  armor: number;
  /** 0–1 group instinct: herbivores herd for safety, carnivores hunt in packs. */
  social: number;
  /** 0–1 r/K strategy: bigger litters of weaker young vs few sturdy young. */
  fecundity: number;
  /** Lineage colour in degrees (0–360); mutates slowly to visualise descent. */
  hue: number;
};

import type { DramaEvent } from "./drama.js";

/** Per-creature snapshot for rendering + inspecting the active arena. */
export type CreatureView = {
  /** Stable identity, so the UI can track a selected creature across frames. */
  id: number;
  /** Species this creature belongs to (see SpeciesRecord). */
  speciesId: number;
  x: number;
  y: number;
  /** Facing angle in radians (movement / intent direction). */
  heading: number;
  radius: number;
  hue: number;
  /** 0–1 normalized energy (food reserve) for brightness. */
  energy: number;
  /** 0–1 body condition; drops when starving, regenerates when well fed. */
  health: number;
  /** Speed gene value. */
  speed: number;
  /** Actual pace after the size trade-off (speed / sqrt(size)). */
  effSpeed: number;
  sense: number;
  /** 0–1 trophic tendency (see Genome.diet). */
  diet: number;
  /** 0–1 plating (see Genome.armor). */
  armor: number;
  /** 0–1 group instinct (see Genome.social). */
  social: number;
  /** 0–1 r/K strategy (see Genome.fecundity). */
  fecundity: number;
  /** Age in simulated seconds. */
  age: number;
  generation: number;
  /** Old enough to breed. */
  mature: boolean;
  /** Mature, well fed, healthy, and off cooldown. */
  readyToMate: boolean;
  /** 0–1 infection load; visible when diseased. */
  infection: number;
};

export type FoodView = {
  x: number;
  y: number;
};

/** Aggregate genome/population stats for the active arena. */
export type ArenaStats = {
  population: number;
  /** Distinct species present in the region. */
  speciesCount: number;
  generation: number;
  meanSize: number;
  meanSpeed: number;
  meanSense: number;
  meanHealth: number;
  meanArmor: number;
  meanSocial: number;
  meanFecundity: number;
  /** Fraction of the population that behaves as predators (diet >= 0.5). */
  carnivoreFraction: number;
  births: number;
  deaths: number;
};

import type { TerrainId } from "./worldmap.js";

export type ArenaTerrainCell = {
  terrain: TerrainId;
  richness: number;
};

export type ReadonlySimulationView = {
  summary: GlobeSummary;
  regions: readonly RegionState[];
  time: TimeControls;
  activeRegionId: number | null;
  /** Creatures in the active region; null when viewing the map overview. */
  activeCreatures: readonly CreatureView[] | null;
  /** Food points in the active region; null when viewing the map overview. */
  activeFood: readonly FoodView[] | null;
  /** Aggregate stats for the active region; null when viewing the map overview. */
  activeStats: ArenaStats | null;
  /** Arena edge length in world units (square). */
  arenaSize: number;
  /** Terrain grid for the active chunk (matches map); null on overview. */
  activeTerrain: readonly ArenaTerrainCell[] | null;
  activeTerrainCols: number;
  activeTerrainRows: number;
  /** Recent noteworthy moments for the natural-history feed and FX. */
  recentDrama: readonly DramaEvent[];
};
