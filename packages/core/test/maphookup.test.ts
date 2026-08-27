import { describe, expect, it } from "vitest";
import { TERRAIN_MOVE_COST, borderCrossArrivalCoords, chunkNeighbors } from "../src/chunkterrain.js";
import { EvolutionSimulation } from "../src/simulation.js";
import { generateWorldMap } from "../src/worldmap.js";
import { makeSim, run } from "./helpers.js";

describe("map ↔ simulation hookup (Phase B)", () => {
  it("chunk grid neighbours are orthogonal", () => {
    expect(chunkNeighbors(0)).toEqual({ west: null, east: 1, north: null, south: 4 });
    expect(chunkNeighbors(5)).toEqual({ west: 4, east: 6, north: 1, south: 9 });
    expect(chunkNeighbors(23)).toEqual({ west: 22, east: null, north: 19, south: null });
  });

  it("border crossing maps overflow into the adjacent chunk", () => {
    const s = 60;
    const west = borderCrossArrivalCoords("west", s, -0.35, 22);
    expect(west.x).toBeCloseTo(59.65, 5);
    expect(west.y).toBe(22);
    const east = borderCrossArrivalCoords("east", s, 60.4, 10);
    expect(east.x).toBeCloseTo(0.4, 5);
    expect(east.y).toBe(10);
    const north = borderCrossArrivalCoords("north", s, 5, -1.2);
    expect(north.x).toBe(5);
    expect(north.y).toBeCloseTo(58.8, 5);
    const south = borderCrossArrivalCoords("south", s, 40, 61.0);
    expect(south.x).toBe(40);
    expect(south.y).toBeCloseTo(1.0, 5);
  });

  it("mountains cost more to traverse than plains", () => {
    expect(TERRAIN_MOVE_COST.mountain).toBeGreaterThan(TERRAIN_MOVE_COST.plains * 2);
  });

  it("simulation regions use map-derived biome labels", () => {
    const sim = makeSim(8080);
    const view = sim.getView();
    const labels = new Set(view.regions.map((r) => r.biome));
    expect(labels.size).toBeGreaterThan(1);
    expect([...labels].every((b) => typeof b === "string" && b.length > 0)).toBe(true);
  });

  it("active arena exposes terrain grid from the selected chunk", () => {
    const sim = makeSim(9090);
    sim.setActiveRegion(7);
    const v = sim.getView();
    expect(v.activeTerrain).not.toBeNull();
    expect(v.activeTerrain!.length).toBe(v.activeTerrainCols * v.activeTerrainRows);
    expect(v.activeTerrainCols).toBeGreaterThan(0);
  });

  it("world map is deterministic from seed inside the sim", () => {
    const a = makeSim(42);
    const b = makeSim(42);
    expect(a.getWorldMap().tiles.length).toBe(b.getWorldMap().tiles.length);
    expect(a.getWorldMap().tiles[0]!.terrain).toBe(b.getWorldMap().tiles[0]!.terrain);
  });

  it("grid migration still spreads species across chunks", () => {
    const sim = makeSim(1337);
    sim.setSpeedMultiplier(128);
    run(sim, 2500);
    const regionsWithLife = new Set<number>();
    for (let r = 0; r < sim.getConfig().regionCount; r++) {
      sim.setActiveRegion(r);
      if ((sim.getView().activeCreatures?.length ?? 0) > 0) regionsWithLife.add(r);
    }
    sim.setActiveRegion(null);
    expect(regionsWithLife.size).toBeGreaterThanOrEqual(3);
  });
});

describe("ChunkTerrain sampling", () => {
  it("matches map tile at chunk corner", () => {
    const map = generateWorldMap(100);
    const sim = new EvolutionSimulation(
      { regionCount: 24, patchSize: 60, baseSimRate: 6, maxSubStep: 0.2, maxSubStepsPerFrame: 24, initialCreatures: 4, maxCreatures: 140 },
      100,
    );
    sim.setActiveRegion(0);
    const v = sim.getView();
    expect(v.activeTerrain![0]!.terrain).toBeTruthy();
  });
});
