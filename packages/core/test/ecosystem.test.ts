import { beforeAll, describe, expect, it } from "vitest";
import type { EvolutionSimulation } from "../src/index.js";
import { allCreatures, makeSim, run } from "./helpers.js";

/**
 * One long shared run, sampled as it goes. Assertions are RANGES, not exact
 * values: they guard ecosystem behaviour (life persists, predators cycle but
 * never permanently vanish, values stay sane) without pinning implementation
 * details, so refactors that preserve behaviour keep passing.
 */
describe("ecosystem balance (long run @64x)", () => {
  let sim: EvolutionSimulation;
  const popSamples: number[] = [];
  const carnSamples: number[] = [];

  beforeAll(() => {
    sim = makeSim(1337);
    sim.setSpeedMultiplier(64);
    for (let f = 0; f < 3000; f++) {
      sim.advance(16);
      if (f % 100 === 99) {
        const cs = allCreatures(sim);
        popSamples.push(cs.length);
        carnSamples.push(cs.filter((c) => c.diet >= 0.5).length);
      }
    }
  });

  it("life persists at plausible scale", () => {
    const cfg = sim.getConfig();
    const cap = cfg.regionCount * cfg.maxCreatures;
    for (const p of popSamples) {
      expect(p).toBeGreaterThan(40);
      expect(p).toBeLessThanOrEqual(cap);
    }
  });

  it("predators cycle but keep re-emerging", () => {
    const withPreds = carnSamples.filter((n) => n > 0).length;
    expect(withPreds / carnSamples.length).toBeGreaterThan(0.4);
    expect(Math.max(...carnSamples)).toBeGreaterThanOrEqual(5);
    // Herbivores always remain the base of the pyramid.
    for (let i = 0; i < popSamples.length; i++) {
      expect(carnSamples[i]!).toBeLessThan(popSamples[i]!);
    }
  });

  it("creature state stays finite and in range", () => {
    for (const c of allCreatures(sim)) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
      expect(c.energy).toBeGreaterThanOrEqual(0);
      expect(c.energy).toBeLessThanOrEqual(1);
      expect(c.health).toBeGreaterThan(0);
      expect(c.health).toBeLessThanOrEqual(1);
      expect(c.radius).toBeGreaterThan(0);
      expect(c.diet).toBeGreaterThanOrEqual(0);
      expect(c.diet).toBeLessThanOrEqual(1);
      expect(c.armor).toBeGreaterThanOrEqual(0);
      expect(c.armor).toBeLessThanOrEqual(1);
    }
  });

  it("effective speed reflects the size/armor trade-off", () => {
    for (const c of allCreatures(sim)) {
      const expected = (c.speed / Math.sqrt(c.radius)) * (1 - 0.35 * c.armor);
      expect(Math.abs(c.effSpeed - expected)).toBeLessThan(1e-6);
    }
  });

  it("evolved predators carry less armor than prey", () => {
    const cs = allCreatures(sim);
    const preds = cs.filter((c) => c.diet >= 0.5);
    const prey = cs.filter((c) => c.diet < 0.5);
    // Predator counts cycle; only assert when there is a real sample.
    if (preds.length >= 5 && prey.length >= 20) {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(preds.map((c) => c.armor))).toBeLessThan(
        mean(prey.map((c) => c.armor)) + 0.1,
      );
    }
  });
});

describe("extreme fast-forward", () => {
  it("stays stable at 2048x (clamped stepping)", () => {
    const sim = makeSim(99);
    sim.setSpeedMultiplier(2048);
    run(sim, 300);
    const v = sim.getView();
    expect(Number.isFinite(v.summary.simTime)).toBe(true);
    expect(v.summary.totalPopulation).toBeGreaterThan(0);
    for (const c of allCreatures(sim)) {
      expect(Number.isFinite(c.x)).toBe(true);
      expect(c.energy).toBeGreaterThanOrEqual(0);
    }
  });
});
