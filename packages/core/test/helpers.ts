import {
  defaultSimulationConfig,
  EvolutionSimulation,
} from "../src/index.js";
import type { CreatureView, SimulationConfig } from "../src/index.js";

export function makeSim(seed = 1337, config: Partial<SimulationConfig> = {}): EvolutionSimulation {
  return new EvolutionSimulation({ ...defaultSimulationConfig, ...config }, seed);
}

/** Advance `frames` simulated frames of ~16ms wall time each. */
export function run(sim: EvolutionSimulation, frames: number): void {
  for (let i = 0; i < frames; i++) sim.advance(16);
}

/** Every creature in the world, via the per-region views. */
export function allCreatures(sim: EvolutionSimulation): CreatureView[] {
  const out: CreatureView[] = [];
  const regions = sim.getConfig().regionCount;
  for (let r = 0; r < regions; r++) {
    sim.setActiveRegion(r);
    const cs = sim.getView().activeCreatures;
    if (cs) out.push(...cs);
  }
  sim.setActiveRegion(null);
  return out;
}

/** Deterministic, comparable snapshot of the whole world state. */
export function worldFingerprint(sim: EvolutionSimulation): string {
  const v = sim.getView();
  const parts: string[] = [
    `t=${v.summary.simTime.toFixed(6)}`,
    `pop=${v.summary.totalPopulation}`,
    `species=${v.summary.livingSpecies}`,
  ];
  for (const c of allCreatures(sim)) {
    parts.push(
      [
        c.id,
        c.speciesId,
        c.x.toFixed(6),
        c.y.toFixed(6),
        c.energy.toFixed(6),
        c.health.toFixed(6),
        c.age.toFixed(6),
        c.radius.toFixed(6),
        c.speed.toFixed(6),
        c.sense.toFixed(6),
        c.diet.toFixed(6),
        c.armor.toFixed(6),
        c.social.toFixed(6),
        c.fecundity.toFixed(6),
      ].join(","),
    );
  }
  return parts.join(";");
}
