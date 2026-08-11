import type { SimulationConfig } from "./types.js";

/** Terrain categories for the 2D world map (WorldBox-style geography). */
export type TerrainId =
  | "ocean"
  | "coast"
  | "plains"
  | "forest"
  | "jungle"
  | "desert"
  | "tundra"
  | "snow"
  | "mountain"
  | "swamp"
  | "river";

/** One cell of the procedural world map. */
export type MapTile = {
  terrain: TerrainId;
  /** 0–1 elevation (sea level ≈ 0.38). */
  elevation: number;
  /** 0–1 atmospheric moisture. */
  moisture: number;
  /** 0–1 temperature (latitude + elevation adjusted). */
  temperature: number;
  /** 0–1 plant / resource fertility. */
  richness: number;
  /** Simulation chunk index (0–23) for land; -1 for open water. */
  chunkId: number;
};

export type WorldMapData = {
  seed: number;
  width: number;
  height: number;
  chunkCols: number;
  chunkRows: number;
  tiles: MapTile[];
};

export const DEFAULT_MAP_WIDTH = 128;
export const DEFAULT_MAP_HEIGHT = 80;
export const MAP_CHUNK_COLS = 4;
export const MAP_CHUNK_ROWS = 6;
export const MAP_CHUNK_COUNT = MAP_CHUNK_COLS * MAP_CHUNK_ROWS;

const SEA_LEVEL = 0.38;

function hash2(ix: number, iy: number, seed: number): number {
  let n = (ix * 374761393 + iy * 668265263 + seed) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + fx * (n10 - n00);
  const nx1 = n01 + fx * (n11 - n01);
  return nx0 + fy * (nx1 - nx0);
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, y * freq, seed + i * 7919);
    amp *= 0.52;
    freq *= 2.05;
  }
  return v;
}

function chunkIndex(tx: number, ty: number, width: number, height: number): number {
  const col = Math.min(MAP_CHUNK_COLS - 1, Math.floor((tx / width) * MAP_CHUNK_COLS));
  const row = Math.min(MAP_CHUNK_ROWS - 1, Math.floor((ty / height) * MAP_CHUNK_ROWS));
  return row * MAP_CHUNK_COLS + col;
}

function classifyTerrain(
  elevation: number,
  moisture: number,
  temperature: number,
  isCoast: boolean,
): TerrainId {
  if (elevation < SEA_LEVEL) return "ocean";
  if (isCoast && elevation < SEA_LEVEL + 0.06) return "coast";
  if (elevation > 0.72) return temperature < 0.35 ? "snow" : "mountain";
  if (moisture > 0.68 && elevation < SEA_LEVEL + 0.22) return "swamp";
  if (temperature < 0.28 && elevation > 0.55) return "snow";
  if (temperature < 0.32) return moisture > 0.45 ? "forest" : "tundra";
  if (temperature > 0.62 && moisture < 0.32) return "desert";
  if (temperature > 0.58 && moisture > 0.55) return "jungle";
  if (moisture > 0.48) return "forest";
  return "plains";
}

function tileRichness(elevation: number, moisture: number, temperature: number, terrain: TerrainId): number {
  if (terrain === "ocean" || terrain === "mountain" || terrain === "snow") {
    return terrain === "mountain" ? 0.15 : 0.05;
  }
  const heat = Math.max(0, temperature - 0.55) * 2;
  const cold = Math.max(0, 0.35 - temperature) * 2;
  let r = 0.35 + 0.45 * moisture - 0.2 * Math.max(0, elevation - 0.5);
  r *= 1 - 0.25 * heat - 0.15 * cold;
  if (terrain === "swamp") r *= 1.15;
  if (terrain === "jungle") r *= 1.1;
  if (terrain === "desert") r *= 0.45;
  if (terrain === "river") r *= 1.05;
  return Math.min(1, Math.max(0.08, r));
}

function isOceanAt(tiles: MapTile[], width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  return tiles[y * width + x]!.terrain === "ocean";
}

function carveRivers(tiles: MapTile[], width: number, height: number, seed: number): void {
  const rng = (() => {
    let a = (seed ^ 0x523972fa) >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const peaks: { x: number; y: number; e: number }[] = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const t = tiles[i]!;
      if (t.terrain === "ocean") continue;
      const e = t.elevation;
      if (e < 0.62) continue;
      let isPeak = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (tiles[(y + dy) * width + (x + dx)]!.elevation > e + 0.02) isPeak = false;
        }
      }
      if (isPeak) peaks.push({ x, y, e });
      else if (e > 0.66 && rng() < 0.02) peaks.push({ x, y, e });
    }
  }

  const riverCount = 10 + Math.floor(rng() * 8);
  for (let r = 0; r < riverCount && peaks.length > 0; r++) {
    const idx = Math.floor(rng() * peaks.length);
    let cx = peaks[idx]!.x;
    let cy = peaks[idx]!.y;
    peaks.splice(idx, 1);

    for (let step = 0; step < width + height; step++) {
      const i = cy * width + cx;
      const t = tiles[i]!;
      if (t.terrain === "ocean") break;
      if (t.terrain !== "mountain" && t.terrain !== "snow") {
        t.terrain = "river";
        t.richness = tileRichness(t.elevation, Math.min(1, t.moisture + 0.2), t.temperature, "river");
      }

      let bestX = cx;
      let bestY = cy;
      let bestE = t.elevation;
      const neighbors = [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ];
      for (const [dx, dy] of neighbors) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ne = tiles[ny * width + nx]!.elevation;
        if (ne < bestE - 0.001) {
          bestE = ne;
          bestX = nx;
          bestY = ny;
        }
      }
      if (bestX === cx && bestY === cy) break;
      cx = bestX;
      cy = bestY;
    }
  }
}

/**
 * Build a deterministic top-down tile map from a seed.
 * Phase A: visual + chunk layout; simulation hookup follows in Phase B.
 */
export function generateWorldMap(
  seed: number,
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
): WorldMapData {
  const tiles: MapTile[] = new Array(width * height);

  for (let y = 0; y < height; y++) {
    const latitude = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      const rawElev =
        0.52 * fbm(nx * 3.2 + 0.2, ny * 2.4, seed, 5) +
        0.34 * fbm(nx * 6.5, ny * 5.0, seed + 333, 3) -
        0.1 * Math.abs(nx - 0.5);
      const elev = Math.min(1, Math.max(0, 0.06 + rawElev * 1.12));
      const moisture = fbm(nx * 2.8 + 1.1, ny * 3.1, seed + 777, 4);
      const tempBase = 0.12 + 0.76 * latitude;
      const temperature = Math.min(
        0.95,
        Math.max(0.05, tempBase - (elev - SEA_LEVEL) * 0.55),
      );

      tiles[y * width + x] = {
        terrain: "plains",
        elevation: elev,
        moisture,
        temperature,
        richness: 0,
        chunkId: -1,
      };
    }
  }

  // Coast flags and terrain labels.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = tiles[i]!;
      const land = t.elevation >= SEA_LEVEL;
      let nearOcean = false;
      if (land) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (isOceanAt(tiles, width, height, x + dx, y + dy)) nearOcean = true;
          }
        }
      }
      t.terrain = classifyTerrain(t.elevation, t.moisture, t.temperature, nearOcean);
      t.richness = tileRichness(t.elevation, t.moisture, t.temperature, t.terrain);
      if (t.terrain !== "ocean") {
        t.chunkId = chunkIndex(x, y, width, height);
      }
    }
  }

  carveRivers(tiles, width, height, seed);

  // Re-assign chunk ids after rivers (still land).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = tiles[i]!;
      if (t.terrain !== "ocean") {
        t.chunkId = chunkIndex(x, y, width, height);
      } else {
        t.chunkId = -1;
      }
    }
  }

  return {
    seed,
    width,
    height,
    chunkCols: MAP_CHUNK_COLS,
    chunkRows: MAP_CHUNK_ROWS,
    tiles,
  };
}

export function getMapTile(map: WorldMapData, x: number, y: number): MapTile | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.tiles[y * map.width + x]!;
}

/** Chunk bounds in tile coordinates (inclusive start, exclusive end). */
export function chunkTileBounds(
  map: WorldMapData,
  chunkId: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const col = chunkId % MAP_CHUNK_COLS;
  const row = Math.floor(chunkId / MAP_CHUNK_COLS);
  const x0 = Math.floor((col / MAP_CHUNK_COLS) * map.width);
  const x1 = Math.floor(((col + 1) / MAP_CHUNK_COLS) * map.width);
  const y0 = Math.floor((row / MAP_CHUNK_ROWS) * map.height);
  const y1 = Math.floor(((row + 1) / MAP_CHUNK_ROWS) * map.height);
  return { x0, y0, x1, y1 };
}

/** Dominant terrain and mean richness for a simulation chunk. */
export function summarizeChunk(map: WorldMapData, chunkId: number): {
  dominant: TerrainId;
  richness: number;
  temperature: number;
  counts: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  let richness = 0;
  let temperature = 0;
  let n = 0;
  for (const t of map.tiles) {
    if (t.chunkId !== chunkId) continue;
    counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;
    richness += t.richness;
    temperature += t.temperature;
    n++;
  }
  let dominant: TerrainId = "plains";
  let best = 0;
  for (const [k, v] of Object.entries(counts)) {
    if (v > best) {
      best = v;
      dominant = k as TerrainId;
    }
  }
  return {
    dominant,
    richness: n ? richness / n : 0,
    temperature: n ? temperature / n : 0.5,
    counts,
  };
}

/** Map dimensions aligned with the current simulation region count. */
export function mapMatchesSimulation(config: SimulationConfig): boolean {
  return config.regionCount === MAP_CHUNK_COUNT;
}
