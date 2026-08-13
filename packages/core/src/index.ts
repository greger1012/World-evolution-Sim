export {
  ChunkTerrain,
  TERRAIN_MOVE_COST,
  chunkNeighbors,
  edgeOpposite,
  tileSample,
} from "./chunkterrain.js";
export type { BorderEdge, TerrainSample } from "./chunkterrain.js";
export type { EventKind, EventSchedulerState, RegionModifiers } from "./events.js";
export { EventScheduler } from "./events.js";
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
export {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAP_CHUNK_COLS,
  MAP_CHUNK_COUNT,
  MAP_CHUNK_ROWS,
  chunkTileBounds,
  generateWorldMap,
  getMapTile,
  mapMatchesSimulation,
  summarizeChunk,
} from "./worldmap.js";
export type { MapTile, TerrainId, WorldMapData } from "./worldmap.js";
export type {
  ArenaStats,
  ArenaTerrainCell,
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
