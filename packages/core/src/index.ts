export { EventScheduler } from "./events.js";
export type { EventKind, EventSchedulerState, RegionModifiers } from "./events.js";
export { defaultSimulationConfig, speedPresets } from "./config.js";
export { EvolutionSimulation } from "./simulation.js";
export type { SavedWorld } from "./simulation.js";
export { RegionEcosystem, isPredator, makeRng } from "./creatures.js";
export type { Rng } from "./creatures.js";
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
  RegionEventState,
  SimulationConfig,
  SpeciesRecord,
  TimeControls,
} from "./types.js";
