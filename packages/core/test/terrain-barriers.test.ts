import { describe, expect, it } from "vitest";
import {
  ChunkTerrain,
  TERRAIN_MOVE_COST,
  isTerrainPassable,
  tileSample,
} from "../src/chunkterrain.js";
import type { MapTile } from "../src/worldmap.js";
import { makeSim, run } from "./helpers.js";

function sampleTile(terrain: MapTile["terrain"], overrides: Partial<MapTile> = {}): MapTile {
  return {
    terrain,
    elevation: terrain === "ocean" ? 0.2 : 0.55,
    moisture: 0.5,
    temperature: 0.5,
    richness: terrain === "ocean" ? 0 : 0.6,
    chunkId: terrain === "ocean" ? -1 : 0,
    ...overrides,
  };
}

describe("terrain passability (Phase G)", () => {
  it("ocean is never passable regardless of tolerance", () => {
    const ocean = tileSample(sampleTile("ocean"));
    expect(isTerrainPassable(ocean, 1)).toBe(false);
    expect(isTerrainPassable(ocean, 5)).toBe(false);
  });

  it("easy ground is passable at baseline tolerance", () => {
    const plains = tileSample(sampleTile("plains"));
    expect(isTerrainPassable(plains, 1)).toBe(true);
  });

  it("mountains and snow require higher tolerance than plains dwellers", () => {
    const mountain = tileSample(sampleTile("mountain"));
    const snow = tileSample(sampleTile("snow"));
    expect(TERRAIN_MOVE_COST.mountain).toBeGreaterThan(TERRAIN_MOVE_COST.plains * 1.15);
    expect(isTerrainPassable(mountain, 1)).toBe(false);
    expect(isTerrainPassable(snow, 1)).toBe(false);
    expect(isTerrainPassable(mountain, 3.5)).toBe(true);
    expect(isTerrainPassable(snow, 2)).toBe(true);
  });

  it("creatures never occupy ocean tiles after a long run", () => {
    const sim = makeSim(4242);
    sim.setSpeedMultiplier(64);
    run(sim, 2000);

    const map = sim.getWorldMap();
    const size = sim.getConfig().patchSize;
    const terrains = Array.from({ length: sim.getConfig().regionCount }, (_, i) => new ChunkTerrain(map, i));

    const view = sim.getView();
    for (let chunkId = 0; chunkId < view.worldLayers.length; chunkId++) {
      for (const c of view.worldLayers[chunkId]!.creatures) {
        const sample = terrains[chunkId]!.sample(c.x, c.y, size);
        expect(sample.terrain).not.toBe("ocean");
      }
    }
  });
});
