import { describe, expect, it } from "vitest";
import { fusedSimulationConfig } from "../src/config.js";
import { DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH } from "../src/worldmap.js";
import { makeSim, run } from "./helpers.js";

describe("fused world layout (experimental)", () => {
  it("runs one map-sized arena instead of 24 patches", () => {
    const sim = makeSim(777, fusedSimulationConfig);
    expect(sim.getConfig().worldLayout).toBe("fused");
    run(sim, 120);
    const v = sim.getView();
    expect(v.worldLayout).toBe("fused");
    expect(v.arenaSize).toBe(DEFAULT_MAP_WIDTH);
    expect(v.arenaHeight).toBe(DEFAULT_MAP_HEIGHT);
    expect(v.summary.totalPopulation).toBeGreaterThan(0);
    const layered = v.worldLayers.reduce((n, l) => n + l.creatures.length, 0);
    expect(layered).toBe(v.summary.totalPopulation);
  });
});
