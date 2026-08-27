import { describe, expect, it } from "vitest";
import { EvolutionSimulation } from "../src/simulation.js";
import { makeSim, run } from "./helpers.js";

describe("food-limited populations (Phase H)", () => {
  it("regions stay near plant carrying capacity without a hard creature cap", () => {
    const sim = makeSim(8642);
    sim.setSpeedMultiplier(64);
    run(sim, 2500);

    const view = sim.getView();
    let maxPop = 0;
    for (const r of view.regions) {
      maxPop = Math.max(maxPop, r.population);
      // Rich regions top out near ~135 plant slots; allow migration/starvation overshoot.
      expect(r.population).toBeLessThan(260);
    }
    expect(maxPop).toBeGreaterThan(20);
  });

  it("legacy saves with maxCreatures still restore", () => {
    const sim = makeSim(314);
    sim.setSpeedMultiplier(16);
    run(sim, 120);

    const saved = sim.serialize();
    const legacy = {
      ...saved,
      config: { ...saved.config, maxCreatures: 140 },
    };
    const restored = EvolutionSimulation.restore(legacy);
    expect(restored.getView().summary.totalPopulation).toBe(sim.getView().summary.totalPopulation);
  });
});
