import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAP_CHUNK_COUNT,
  generateWorldMap,
  summarizeChunk,
} from "../src/worldmap.js";

describe("world map generation", () => {
  it("is deterministic for the same seed", () => {
    const a = generateWorldMap(42);
    const b = generateWorldMap(42);
    expect(a.tiles.length).toBe(b.tiles.length);
    for (let i = 0; i < a.tiles.length; i++) {
      expect(a.tiles[i]!.terrain).toBe(b.tiles[i]!.terrain);
      expect(a.tiles[i]!.elevation).toBe(b.tiles[i]!.elevation);
      expect(a.tiles[i]!.richness).toBe(b.tiles[i]!.richness);
      expect(a.tiles[i]!.chunkId).toBe(b.tiles[i]!.chunkId);
    }
  });

  it("differs across seeds", () => {
    const a = generateWorldMap(1);
    const b = generateWorldMap(2);
    let same = 0;
    for (let i = 0; i < a.tiles.length; i++) {
      if (a.tiles[i]!.terrain === b.tiles[i]!.terrain) same++;
    }
    expect(same).toBeLessThan(a.tiles.length * 0.95);
  });

  it("uses the requested large default size", () => {
    const map = generateWorldMap(99);
    expect(map.width).toBe(DEFAULT_MAP_WIDTH);
    expect(map.height).toBe(DEFAULT_MAP_HEIGHT);
    expect(map.tiles.length).toBe(DEFAULT_MAP_WIDTH * DEFAULT_MAP_HEIGHT);
  });

  it("includes varied terrain and assigns land chunks", () => {
    const map = generateWorldMap(12345);
    const terrains = new Set(map.tiles.map((t) => t.terrain));
    expect(terrains.has("ocean")).toBe(true);
    expect(terrains.has("forest") || terrains.has("plains")).toBe(true);
    expect(terrains.size).toBeGreaterThanOrEqual(5);

    let rivers = false;
    let lakes = false;
    for (const seed of [12345, 42, 999, 2024]) {
      const m = generateWorldMap(seed);
      if (m.tiles.some((t) => t.terrain === "river")) rivers = true;
      if (m.tiles.some((t) => t.terrain === "lake")) lakes = true;
    }
    expect(rivers).toBe(true);
    expect(lakes).toBe(true);

    const chunkIds = new Set<number>();
    for (const t of map.tiles) {
      if (t.chunkId >= 0) chunkIds.add(t.chunkId);
    }
    expect(chunkIds.size).toBe(MAP_CHUNK_COUNT);
  });

  it("rivers are sparse main stems that reach lakes or ocean", () => {
    const map = generateWorldMap(4242);
    const { width, height, tiles } = map;
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

    const downstream = (x: number, y: number): { x: number; y: number } | null => {
      const i = y * width + x;
      const e0 = tiles[i]!.elevation;
      if (tiles[i]!.terrain === "ocean") return null;
      let best: { x: number; y: number } | null = null;
      let bestDrop = 0;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const drop = e0 - tiles[ny * width + nx]!.elevation;
        if (drop > bestDrop + 1e-5) {
          bestDrop = drop;
          best = { x: nx, y: ny };
        }
      }
      return best;
    };

    let rivers = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = tiles[y * width + x]!;
        if (t.terrain !== "river") continue;
        rivers++;
        let cx = x;
        let cy = y;
        let steps = 0;
        let ok = false;
        while (steps++ < width + height) {
          const cur = tiles[cy * width + cx]!;
          if (cur.terrain === "ocean" || cur.terrain === "lake") {
            ok = true;
            break;
          }
          const next = downstream(cx, cy);
          if (!next) break;
          cx = next.x;
          cy = next.y;
        }
        expect(ok).toBe(true);
      }
    }

    expect(rivers).toBeGreaterThan(20);
    expect(rivers).toBeLessThan(map.tiles.length * 0.025);
  });

  it("lakes form multi-tile bodies, not single-tile puddles", () => {
    const map = generateWorldMap(4242);
    const seen = new Uint8Array(map.tiles.length);
    const sizes: number[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const i = y * map.width + x;
        if (map.tiles[i]!.terrain !== "lake" || seen[i]) continue;
        let n = 0;
        const stack = [[x, y]];
        seen[i] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          n++;
          for (const [dx, dy] of [
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
          ] as const) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
            const j = ny * map.width + nx;
            if (seen[j] || map.tiles[j]!.terrain !== "lake") continue;
            seen[j] = 1;
            stack.push([nx, ny]);
          }
        }
        sizes.push(n);
      }
    }
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(8);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("summarizes chunk dominant terrain", () => {
    const map = generateWorldMap(555);
    const s = summarizeChunk(map, 0);
    expect(s.dominant).toBeTruthy();
    expect(s.richness).toBeGreaterThan(0);
    expect(s.temperature).toBeGreaterThan(0);
  });
});
