import type { RegionState, SimulationConfig } from "./types.js";

export function createRegions(config: SimulationConfig): RegionState[] {
  const { regionCount } = config;
  const regions: RegionState[] = [];
  for (let i = 0; i < regionCount; i++) {
    const phase = (i / regionCount) * Math.PI * 2;
    regions.push({
      id: i,
      biomass: 0.4 + 0.35 * Math.sin(phase * 1.7),
      diversity: 0.2 + 0.15 * Math.cos(phase * 0.9),
    });
  }
  return regions;
}

export function createPatchBuffers(config: SimulationConfig): Float32Array[] {
  const { regionCount, patchSize } = config;
  const n = patchSize * patchSize;
  const buffers: Float32Array[] = [];
  for (let r = 0; r < regionCount; r++) {
    const buf = new Float32Array(n);
    const regionPhase = (r / regionCount) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const x = (i % patchSize) / patchSize;
      const y = Math.floor(i / patchSize) / patchSize;
      buf[i] =
        0.35 +
        0.25 * Math.sin(x * 6 + regionPhase) * Math.cos(y * 5 - regionPhase * 0.5);
    }
    buffers.push(buf);
  }
  return buffers;
}

export function patchMean(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]!;
  return s / buf.length;
}
