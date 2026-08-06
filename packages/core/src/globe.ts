import type { SimulationConfig } from "./types.js";

/**
 * Per-region environmental richness in [0.25, 1]. Varies smoothly around the
 * globe so regions have different carrying capacities and therefore different
 * evolutionary pressures.
 */
export function regionRichness(index: number, regionCount: number): number {
  const phase = (index / regionCount) * Math.PI * 2;
  const band = 0.5 + 0.5 * Math.sin(phase * 1.7);
  const detail = 0.5 + 0.5 * Math.cos(phase * 0.9 + 1.3);
  const r = 0.25 + 0.75 * (0.65 * band + 0.35 * detail);
  return Math.min(1, Math.max(0.25, r));
}

/** Deterministic per-region seed derived from a base seed. */
export function regionSeed(baseSeed: number, index: number): number {
  return (baseSeed ^ ((index + 1) * 0x9e3779b1)) >>> 0;
}

export function richnessForAll(config: SimulationConfig): number[] {
  const out: number[] = [];
  for (let i = 0; i < config.regionCount; i++) {
    out.push(regionRichness(i, config.regionCount));
  }
  return out;
}
