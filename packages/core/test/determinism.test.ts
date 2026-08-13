import { describe, expect, it } from "vitest";
import { makeSim, run, worldFingerprint } from "./helpers.js";

describe("determinism", () => {
  it("same seed produces an identical world after many frames", () => {
    const a = makeSim(42);
    const b = makeSim(42);
    run(a, 400);
    run(b, 400);
    expect(worldFingerprint(a)).toBe(worldFingerprint(b));
  });

  it("different seeds diverge", () => {
    const a = makeSim(1);
    const b = makeSim(2);
    run(a, 100);
    run(b, 100);
    expect(worldFingerprint(a)).not.toBe(worldFingerprint(b));
  });

  it("pausing stops time; resuming continues deterministically", () => {
    const a = makeSim(7);
    run(a, 100);
    const before = worldFingerprint(a);
    a.setPaused(true);
    run(a, 50);
    expect(worldFingerprint(a)).toBe(before);
    a.setPaused(false);

    const b = makeSim(7);
    run(b, 100);
    run(a, 100);
    run(b, 100);
    expect(worldFingerprint(a)).toBe(worldFingerprint(b));
  });
});
