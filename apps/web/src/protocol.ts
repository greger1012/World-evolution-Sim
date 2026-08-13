import type {
  HistorySample,
  ReadonlySimulationView,
  SavedWorld,
  SpeciesRecord,
} from "@evo-world-sim/core";

/** Main thread -> worker. */
export type MainToWorker =
  | { type: "init"; seed: number; saved: SavedWorld | null }
  | { type: "setSpeed"; value: number }
  | { type: "setPaused"; value: boolean }
  | { type: "setActiveRegion"; value: number | null }
  | { type: "save"; reason: "manual" | "auto" }
  | { type: "newWorld"; seed: number };

/** Worker -> main thread. */
export type WorkerToMain =
  | { type: "frame"; view: ReadonlySimulationView }
  | { type: "meta"; species: SpeciesRecord[]; history: HistorySample[] }
  | { type: "saved"; data: SavedWorld; reason: "manual" | "auto" }
  | { type: "loadFailed" };
