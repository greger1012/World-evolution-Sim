import { describe, expect, it } from "vitest";
import { EvolutionSimulation } from "../src/index.js";
import { makeSim, run, worldFingerprint } from "./helpers.js";

describe("save / load", () => {
  it("restore resumes with exact fidelity (same future as never saving)", () => {
    const original = makeSim(2024);
    original.setSpeedMultiplier(16);
    run(original, 300);

    const restored = EvolutionSimulation.restore(original.serialize());
    expect(worldFingerprint(restored)).toBe(worldFingerprint(original));

    // The strictest check: both worlds must produce the identical future.
    run(original, 300);
    run(restored, 300);
    expect(worldFingerprint(restored)).toBe(worldFingerprint(original));
  });

  it("survives a JSON round-trip (storage format)", () => {
    const original = makeSim(555);
    original.setSpeedMultiplier(16);
    run(original, 200);

    const json = JSON.stringify(original.serialize());
    const restored = EvolutionSimulation.restore(JSON.parse(json));
    run(original, 200);
    run(restored, 200);
    expect(worldFingerprint(restored)).toBe(worldFingerprint(original));
  });

  it("preserves species records, history, and time controls", () => {
    const original = makeSim(77);
    original.setSpeedMultiplier(64);
    run(original, 400);
    original.setPaused(true);
    original.setActiveRegion(3);

    const restored = EvolutionSimulation.restore(original.serialize());
    expect(restored.getView().time.paused).toBe(true);
    expect(restored.getView().activeRegionId).toBe(3);
    expect(restored.getSpecies()).toEqual(original.getSpecies());
    expect(restored.getHistory()).toEqual(original.getHistory());
    expect(restored.getView().summary.simTime).toBe(original.getView().summary.simTime);
  });
});
