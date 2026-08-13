import { beforeAll, describe, expect, it } from "vitest";
import type { EvolutionSimulation } from "../src/index.js";
import { allCreatures, makeSim } from "./helpers.js";

describe("species registry & migration (long run @64x)", () => {
  let sim: EvolutionSimulation;

  beforeAll(() => {
    sim = makeSim(1337);
    sim.setSpeedMultiplier(64);
    for (let f = 0; f < 2500; f++) sim.advance(16);
  });

  it("every creature carries a registered species tag", () => {
    const species = new Map(sim.getSpecies().map((s) => [s.id, s]));
    for (const c of allCreatures(sim)) {
      expect(c.speciesId).toBeGreaterThanOrEqual(0);
      expect(species.has(c.speciesId)).toBe(true);
    }
  });

  it("species split over time, recording their parent lineage", () => {
    const all = sim.getSpecies();
    expect(all.length).toBeGreaterThan(5);
    const splits = all.filter((s) => s.parentId !== null);
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      // Parent must exist and predate the child.
      const parent = sim.getSpeciesById(s.parentId!);
      expect(parent).toBeDefined();
      expect(parent!.foundedAt).toBeLessThanOrEqual(s.foundedAt);
    }
  });

  it("extinctions are recorded consistently", () => {
    for (const s of sim.getSpecies()) {
      if (s.extinctAt !== null) {
        expect(s.extinctAt).toBeGreaterThanOrEqual(s.foundedAt);
        expect(s.population).toBe(0);
      }
      expect(s.peakPopulation).toBeGreaterThanOrEqual(s.population);
      expect(s.name.length).toBeGreaterThan(2);
    }
  });

  it("living species count matches the world", () => {
    const livingIds = new Set(allCreatures(sim).map((c) => c.speciesId));
    // Registry refresh runs on a cadence, so allow slight drift.
    const counted = sim.getView().summary.livingSpecies;
    expect(Math.abs(counted - livingIds.size)).toBeLessThanOrEqual(3);
  });

  it("migration spreads at least one species across several regions", () => {
    const regionsOf = new Map<number, Set<number>>();
    const regions = sim.getConfig().regionCount;
    for (let r = 0; r < regions; r++) {
      sim.setActiveRegion(r);
      for (const c of sim.getView().activeCreatures ?? []) {
        let set = regionsOf.get(c.speciesId);
        if (!set) {
          set = new Set();
          regionsOf.set(c.speciesId, set);
        }
        set.add(r);
      }
    }
    sim.setActiveRegion(null);
    const maxSpan = Math.max(...[...regionsOf.values()].map((s) => s.size));
    expect(maxSpan).toBeGreaterThanOrEqual(3);
  });

  it("history covers the whole timeline within capacity", () => {
    const h = sim.getHistory();
    const now = sim.getView().summary.simTime;
    expect(h.length).toBeGreaterThan(10);
    expect(h.length).toBeLessThanOrEqual(512);
    expect(h[0]!.t).toBeLessThan(now * 0.05);
    for (let i = 1; i < h.length; i++) {
      expect(h[i]!.t).toBeGreaterThan(h[i - 1]!.t);
    }
    // The most recent sample is not stale.
    expect(now - h[h.length - 1]!.t).toBeLessThan(now * 0.25 + 130);
  });
});
