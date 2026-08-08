/** Planet-wide aggregates (stratum above regions). */
export type GlobeSummary = {
  tick: number;
  totalBiomass: number;
  meanDiversity: number;
  totalPopulation: number;
};

export type RegionState = {
  id: number;
  /** 0–1 normalized ecosystem health (population relative to carrying capacity). */
  biomass: number;
  /** 0–1 genome-trait dispersion within the region. */
  diversity: number;
  /** Live creature count in the region. */
  population: number;
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
  /** Lineage colour in degrees (0–360); mutates slowly to visualise descent. */
  hue: number;
};

/** Per-creature snapshot for rendering + inspecting the active arena. */
export type CreatureView = {
  /** Stable identity, so the UI can track a selected creature across frames. */
  id: number;
  x: number;
  y: number;
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
  /** Age in simulated seconds. */
  age: number;
  generation: number;
  /** Old enough to breed. */
  mature: boolean;
  /** Mature, well fed, healthy, and off cooldown. */
  readyToMate: boolean;
};

export type FoodView = {
  x: number;
  y: number;
};

/** Aggregate genome/population stats for the active arena. */
export type ArenaStats = {
  population: number;
  generation: number;
  meanSize: number;
  meanSpeed: number;
  meanSense: number;
  meanHealth: number;
  /** Fraction of the population that behaves as predators (diet >= 0.5). */
  carnivoreFraction: number;
  births: number;
  deaths: number;
};

export type ReadonlySimulationView = {
  summary: GlobeSummary;
  regions: readonly RegionState[];
  time: TimeControls;
  activeRegionId: number | null;
  /** Creatures in the active region; null when viewing the globe. */
  activeCreatures: readonly CreatureView[] | null;
  /** Food points in the active region; null when viewing the globe. */
  activeFood: readonly FoodView[] | null;
  /** Aggregate stats for the active region; null when viewing the globe. */
  activeStats: ArenaStats | null;
  /** Arena edge length in world units (square). */
  arenaSize: number;
};
