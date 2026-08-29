import type { SimulationConfig } from "./types.js";

export const defaultSimulationConfig: SimulationConfig = {
  regionCount: 24,
  patchSize: 60,
  baseSimRate: 6,
  maxSubStep: 0.2,
  maxSubStepsPerFrame: 24,
  initialCreatures: 16,
  worldLayout: "chunked",
};

/** Experimental: one continuous arena aligned 1:1 with map tiles (128×80). */
export const fusedSimulationConfig: SimulationConfig = {
  ...defaultSimulationConfig,
  worldLayout: "fused",
};

/** UI-oriented speed presets; core accepts any positive multiplier. */
export const speedPresets = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048] as const;
