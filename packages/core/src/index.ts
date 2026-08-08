export { defaultSimulationConfig, speedPresets } from "./config.js";
export { EvolutionSimulation } from "./simulation.js";
export { RegionEcosystem, isPredator, makeRng } from "./creatures.js";
export { SpeciesRegistry } from "./species.js";
export {
  biomeName,
  climateFoodFactor,
  regionRichness,
  regionSeed,
  regionTemperature,
  richnessForAll,
} from "./globe.js";
export type {
  ArenaStats,
  CreatureView,
  FoodView,
  Genome,
  GlobeSummary,
  HistorySample,
  ReadonlySimulationView,
  RegionState,
  SimulationConfig,
  SpeciesRecord,
  TimeControls,
} from "./types.js";
