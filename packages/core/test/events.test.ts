import { describe, expect, it } from "vitest";
import { makeSim, run } from "./helpers.js";

describe("world events", () => {
  it("deterministic event timeline from seed", () => {
    const a = makeSim(4242);
    const b = makeSim(4242);
    run(a, 800);
    run(b, 800);
    const eventsA = a.getView().regions.flatMap((r) => r.events);
    const eventsB = b.getView().regions.flatMap((r) => r.events);
    expect(eventsA.length).toBe(eventsB.length);
    for (let i = 0; i < eventsA.length; i++) {
      expect(eventsA[i]!.kind).toBe(eventsB[i]!.kind);
      expect(eventsA[i]!.severity).toBe(eventsB[i]!.severity);
    }
  });

  it("events occur over a long run", () => {
    const sim = makeSim(9001);
    sim.setSpeedMultiplier(128);
    const kinds = new Set<string>();
    for (let i = 0; i < 1200; i++) {
      sim.advance(16);
      for (const r of sim.getView().regions) {
        for (const e of r.events) kinds.add(e.kind);
      }
    }
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it("drought can depress regional food during an active event", () => {
    const sim = makeSim(31415, { regionCount: 6 });
    sim.setSpeedMultiplier(256);
    let droughtRegion: number | null = null;
    for (let frame = 0; frame < 2000; frame++) {
      sim.advance(16);
      for (let r = 0; r < 6; r++) {
        const ev = sim.getView().regions[r]!.events;
        if (ev.some((e) => e.kind === "drought")) {
          droughtRegion = r;
          break;
        }
      }
      if (droughtRegion !== null) break;
    }
    expect(droughtRegion).not.toBeNull();
    sim.setActiveRegion(droughtRegion!);
    const foodDuring = sim.getView().activeFood!.length;
    // Keep simulating until drought ends.
    for (let i = 0; i < 800; i++) sim.advance(16);
    sim.setActiveRegion(droughtRegion!);
    const foodAfter = sim.getView().activeFood!.length;
    expect(foodDuring).toBeLessThan(foodAfter + 40);
  });

  it("disease leaves infected creatures that recover after the outbreak", () => {
    const sim = makeSim(27182, { regionCount: 4 });
    sim.setSpeedMultiplier(256);
    let diseaseRegion: number | null = null;
    for (let frame = 0; frame < 2500; frame++) {
      sim.advance(16);
      for (let r = 0; r < 4; r++) {
        if (sim.getView().regions[r]!.events.some((e) => e.kind === "disease")) {
          diseaseRegion = r;
          break;
        }
      }
      if (diseaseRegion !== null) break;
    }
    expect(diseaseRegion).not.toBeNull();
    sim.setActiveRegion(diseaseRegion!);
    const infectedDuring = sim
      .getView()
      .activeCreatures!.filter((c) => c.infection > 0.12).length;
    expect(infectedDuring).toBeGreaterThan(0);
    for (let i = 0; i < 1200; i++) sim.advance(16);
    sim.setActiveRegion(diseaseRegion!);
    const infectedLater = sim
      .getView()
      .activeCreatures!.filter((c) => c.infection > 0.12).length;
    expect(infectedLater).toBeLessThan(infectedDuring);
  });

  it("storms appear and stress regions", () => {
    const sim = makeSim(16180, { regionCount: 8 });
    sim.setSpeedMultiplier(256);
    let sawStorm = false;
    for (let i = 0; i < 3500; i++) {
      sim.advance(16);
      if (sim.getView().regions.some((r) => r.events.some((e) => e.kind === "storm"))) {
        sawStorm = true;
        break;
      }
    }
    expect(sawStorm).toBe(true);
  });
});
