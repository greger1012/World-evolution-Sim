import { climateFoodFactor } from "./globe.js";
import type { MapTile, TerrainId, WorldMapData } from "./worldmap.js";
import { chunkTileBounds } from "./worldmap.js";

/** Per-tile movement energy multiplier (mountains are passable but costly). */
export const TERRAIN_MOVE_COST: Record<TerrainId, number> = {
  ocean: 8,
  coast: 1.05,
  plains: 1,
  forest: 1.12,
  jungle: 1.18,
  desert: 1.22,
  tundra: 1.15,
  snow: 2.1,
  mountain: 3.6,
  swamp: 1.75,
  river: 1.08,
  lake: 1.2,
};

/** Whether a creature with the given tolerance can enter this tile. */
export function isTerrainPassable(sample: TerrainSample, tolerance: number): boolean {
  if (sample.terrain === "ocean") return false;
  return sample.moveCost <= tolerance * 1.15;
}

/** Sample of terrain at a point in the regional arena. */
export type TerrainSample = {
  terrain: TerrainId;
  richness: number;
  temperature: number;
  moveCost: number;
  foodFactor: number;
};

/** Compact terrain grid for one simulation chunk (subset of the world map). */
export class ChunkTerrain {
  readonly chunkId: number;
  readonly cols: number;
  readonly rows: number;
  private readonly cells: MapTile[];

  constructor(map: WorldMapData, chunkId: number) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
    this.chunkId = chunkId;
    this.cols = Math.max(1, x1 - x0);
    this.rows = Math.max(1, y1 - y0);
    this.cells = [];
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        this.cells.push(map.tiles[ty * map.width + tx]!);
      }
    }
  }

  cell(col: number, row: number): MapTile {
    return this.cells[row * this.cols + col]!;
  }

  /** Map arena coordinates [0, size] to a terrain sample. */
  sample(arenaX: number, arenaY: number, arenaSize: number): TerrainSample {
    const col = Math.min(
      this.cols - 1,
      Math.max(0, Math.floor((arenaX / arenaSize) * this.cols)),
    );
    const row = Math.min(
      this.rows - 1,
      Math.max(0, Math.floor((arenaY / arenaSize) * this.rows)),
    );
    return tileSample(this.cells[row * this.cols + col]!);
  }

  meanRichness(): number {
    let s = 0;
    for (const t of this.cells) s += t.richness;
    return s / this.cells.length;
  }

  meanTemperature(): number {
    let s = 0;
    for (const t of this.cells) s += t.temperature;
    return s / this.cells.length;
  }

  /** Human-readable label for the chunk (dominant terrain). */
  dominantLabel(): string {
    const counts = new Map<TerrainId, number>();
    for (const t of this.cells) {
      if (t.terrain === "ocean") continue;
      counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
    }
    let best: TerrainId = "plains";
    let n = 0;
    for (const [k, v] of counts) {
      if (v > n) {
        n = v;
        best = k;
      }
    }
    return best;
  }

  /** Flat grid for arena rendering (row-major). */
  renderCells(): { terrain: TerrainId; richness: number }[] {
    return this.cells.map((t) => ({ terrain: t.terrain, richness: t.richness }));
  }
}

export function tileSample(t: MapTile): TerrainSample {
  const moveCost = TERRAIN_MOVE_COST[t.terrain];
  const foodFactor =
    t.terrain === "ocean"
      ? 0
      : t.richness * (t.terrain === "desert" ? 0.5 : t.terrain === "jungle" ? 1.12 : 1) *
        climateFoodFactor(t.temperature);
  return {
    terrain: t.terrain,
    richness: t.richness,
    temperature: t.temperature,
    moveCost,
    foodFactor,
  };
}

export type BorderEdge = "west" | "east" | "north" | "south";

/** Orthogonal neighbour chunk ids on the 4×6 grid (null if off-map). */
export function chunkNeighbors(chunkId: number): Record<BorderEdge, number | null> {
  const col = chunkId % 4;
  const row = Math.floor(chunkId / 4);
  return {
    west: col > 0 ? chunkId - 1 : null,
    east: col < 3 ? chunkId + 1 : null,
    north: row > 0 ? chunkId - 4 : null,
    south: row < 5 ? chunkId + 4 : null,
  };
}

export function edgeOpposite(edge: BorderEdge): BorderEdge {
  switch (edge) {
    case "west":
      return "east";
    case "east":
      return "west";
    case "north":
      return "south";
    case "south":
      return "north";
  }
}

/** Band width at chunk borders where predators and prey can interact across regions. */
export const PREDATION_HALO = 10;

export function predatorInPredationHalo(
  edge: BorderEdge,
  x: number,
  y: number,
  size: number,
  halo = PREDATION_HALO,
): boolean {
  switch (edge) {
    case "west":
      return x <= halo;
    case "east":
      return x >= size - halo;
    case "north":
      return y <= halo;
    case "south":
      return y >= size - halo;
  }
}

/** Whether prey sits on the neighbour strip that faces this chunk across `edge`. */
export function preyInPredationHalo(
  edge: BorderEdge,
  x: number,
  y: number,
  size: number,
  halo = PREDATION_HALO,
): boolean {
  switch (edge) {
    case "west":
      return x >= size - halo;
    case "east":
      return x <= halo;
    case "north":
      return y >= size - halo;
    case "south":
      return y <= halo;
  }
}

/** Continuous-world distance across an orthogonal border (same units as arena coords). */
export function crossChunkDelta(
  edge: BorderEdge,
  px: number,
  py: number,
  nx: number,
  ny: number,
  size: number,
): { dx: number; dy: number } {
  switch (edge) {
    case "west":
      return { dx: px + (size - nx), dy: py - ny };
    case "east":
      return { dx: size - px + nx, dy: py - ny };
    case "north":
      return { dx: px - nx, dy: py + (size - ny) };
    case "south":
      return { dx: px - nx, dy: size - py + ny };
  }
}

/** Map a neighbour-creature position into this chunk's local arena coords. */
export function mapNeighborToLocalCoords(
  edge: BorderEdge,
  nx: number,
  ny: number,
  size: number,
): { x: number; y: number } {
  switch (edge) {
    case "west":
      return { x: nx - size, y: ny };
    case "east":
      return { x: size + nx, y: ny };
    case "north":
      return { x: nx, y: ny - size };
    case "south":
      return { x: nx, y: size + ny };
  }
}

/** Map arena coords after crossing an orthogonal chunk border (continuous motion). */
export function borderCrossArrivalCoords(
  departEdge: BorderEdge,
  arenaSize: number,
  x: number,
  y: number,
): { x: number; y: number } {
  switch (departEdge) {
    case "west":
      return { x: arenaSize + x, y };
    case "east":
      return { x: x - arenaSize, y };
    case "north":
      return { x, y: arenaSize + y };
    case "south":
      return { x, y: y - arenaSize };
  }
}
