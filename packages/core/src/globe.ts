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

/**
 * Per-region temperature in [0.05, 0.95] (0 = frozen, 1 = scorching).
 * Varies smoothly around the ring so the world has cold and hot zones.
 */
export function regionTemperature(index: number, regionCount: number): number {
  const phase = (index / regionCount) * Math.PI * 2;
  const t = 0.5 + 0.42 * Math.sin(phase * 1.3 + 0.7) + 0.08 * Math.sin(phase * 3.1);
  return Math.min(0.95, Math.max(0.05, t));
}

/** Human-readable biome from climate + richness. */
export function biomeName(temperature: number, richness: number): string {
  const lush = richness >= 0.6;
  if (temperature < 0.3) return lush ? "boreal forest" : "tundra";
  if (temperature <= 0.65) return lush ? "temperate forest" : "steppe";
  return lush ? "jungle" : "desert";
}

/**
 * Plant growth vs climate: heat dries the land out hard (deserts), while cold
 * only somewhat shortens the growing season. Keeping cold regions fed matters:
 * body size there is shaped by thermoregulation, not starvation.
 */
export function climateFoodFactor(temperature: number): number {
  const heat = Math.max(0, temperature - 0.5) * 2;
  const cold = Math.max(0, 0.5 - temperature) * 2;
  return 1 - 0.25 * heat - 0.15 * cold;
}

export function richnessForAll(config: SimulationConfig): number[] {
  const out: number[] = [];
  for (let i = 0; i < config.regionCount; i++) {
    out.push(regionRichness(i, config.regionCount));
  }
  return out;
}
