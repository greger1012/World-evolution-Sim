export { defaultSimulationConfig, speedPresets } from "./config.js";
export { EvolutionSimulation } from "./simulation.js";
export { RegionEcosystem, makeRng } from "./creatures.js";
export { regionRichness, regionSeed, richnessForAll } from "./globe.js";
export type {
  ArenaStats,
  CreatureView,
  FoodView,
  Genome,
  GlobeSummary,
  ReadonlySimulationView,
  RegionState,
  SimulationConfig,
  TimeControls,
} from "./types.js";
