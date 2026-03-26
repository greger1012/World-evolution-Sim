/** Planet-wide aggregates (stratum above regions). */
export type GlobeSummary = {
  tick: number;
  totalBiomass: number;
  meanDiversity: number;
};

export type RegionState = {
  id: number;
  biomass: number;
  /** 0–1 abstract trait dispersion */
  diversity: number;
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
  patchSize: number;
  /**
   * Simulated seconds advanced per one real second when multiplier is 1.
   */
  baseSimRate: number;
  /** Maximum integration sub-step for stability under fast-forward. */
  maxSubStep: number;
};

export type ReadonlySimulationView = {
  summary: GlobeSummary;
  regions: readonly RegionState[];
  time: TimeControls;
  activeRegionId: number | null;
  /** Row-major biomass field for the active region; null if globe stratum only. */
  activePatchBiomass: Float32Array | null;
  patchWidth: number;
  patchHeight: number;
};
