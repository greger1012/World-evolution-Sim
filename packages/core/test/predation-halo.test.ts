import { describe, expect, it } from "vitest";
import { DEFAULT_REGION_MODIFIERS } from "../src/events.js";
import {
  PREDATION_HALO,
  crossChunkDelta,
  mapNeighborToLocalCoords,
  predatorInPredationHalo,
  preyInPredationHalo,
} from "../src/chunkterrain.js";
import { RegionEcosystem, makeRng } from "../src/creatures.js";
import type { Creature, EcosystemState } from "../src/creatures.js";
import type { Genome } from "../src/types.js";

const predGenome: Genome = {
  size: 1.2,
  speed: 2.5,
  sense: 12,
  diet: 0.8,
  armor: 0.1,
  social: 0.3,
  fecundity: 0.3,
  hue: 10,
};

const preyGenome: Genome = {
  size: 0.7,
  speed: 1.5,
  sense: 5,
  diet: 0.1,
  armor: 0.05,
  social: 0.4,
  fecundity: 0.5,
  hue: 120,
};

function stateWith(creatures: Creature[], seed: number): EcosystemState {
  return {
    rng: makeRng(seed).getState(),
    foodPurgeCountdown: 64,
    generation: 0,
    births: 0,
    deaths: 0,
    creatures,
    food: [],
  };
}

function linkedPair(seedWest: number, seedEast: number) {
  let id = 1;
  const idAlloc = () => id++;
  const size = 60;
  const west = new RegionEcosystem({
    size,
    richness: 0.6,
    temperature: 0.5,
    seed: seedWest,
    initialCreatures: 0,
    chunkId: 0,
    idAlloc,
  });
  const east = new RegionEcosystem({
    size,
    richness: 0.6,
    temperature: 0.5,
    seed: seedEast,
    initialCreatures: 0,
    chunkId: 1,
    idAlloc,
  });
  west.linkPredationNeighbors({ west: null, east, north: null, south: null });
  east.linkPredationNeighbors({ west, east: null, north: null, south: null });
  return { west, east, size };
}

describe("predation halo geometry (Phase I)", () => {
  it("flags creatures in the border band", () => {
    const s = 60;
    expect(predatorInPredationHalo("east", 55, 30, s, PREDATION_HALO)).toBe(true);
    expect(predatorInPredationHalo("east", 40, 30, s, PREDATION_HALO)).toBe(false);
    expect(preyInPredationHalo("east", 4, 30, s, PREDATION_HALO)).toBe(true);
    expect(preyInPredationHalo("east", 20, 30, s, PREDATION_HALO)).toBe(false);
  });

  it("measures continuous distance across an east border", () => {
    const s = 60;
    const { dx, dy } = crossChunkDelta("east", 59, 30, 1, 30, s);
    expect(dx).toBeCloseTo(2, 5);
    expect(dy).toBe(0);
  });

  it("maps neighbour coords into local arena space", () => {
    const s = 60;
    const local = mapNeighborToLocalCoords("east", 1, 30, s);
    expect(local.x).toBe(61);
    expect(local.y).toBe(30);
  });
});

describe("cross-chunk predation (Phase I)", () => {
  it("border predator strikes prey in the adjacent chunk", () => {
    const { west, east } = linkedPair(1001, 2002);
    west.restoreState(
      stateWith(
        [
          {
            id: 1,
            speciesId: 1,
            x: 59,
            y: 30,
            heading: 0,
            energy: 0.95,
            health: 1,
            age: 20,
            generation: 0,
            genome: predGenome,
            dead: false,
            migrated: false,
            matingCd: 99,
            attackCd: 0,
            infection: 0,
          },
        ],
        1001,
      ),
    );
    east.restoreState(
      stateWith(
        [
          {
            id: 2,
            speciesId: 2,
            x: 1,
            y: 30,
            heading: 0,
            energy: 0.8,
            health: 1,
            age: 20,
            generation: 0,
            genome: preyGenome,
            dead: false,
            migrated: false,
            matingCd: 99,
            attackCd: 0,
            infection: 0,
          },
        ],
        2002,
      ),
    );

    west.step(0.05, DEFAULT_REGION_MODIFIERS, 1);
    expect(west.creaturesRef()[0]!.attackCd).toBeGreaterThan(0);
  });

  it("eventually kills neighbour prey without either creature migrating", () => {
    let killed = false;
    for (let attempt = 0; attempt < 80 && !killed; attempt++) {
      const { west, east } = linkedPair(3000 + attempt, 4000 + attempt);
      west.restoreState(
        stateWith(
          [
            {
              id: 1,
              speciesId: 1,
              x: 59,
              y: 30,
              heading: 0,
              energy: 0.95,
              health: 1,
              age: 20,
              generation: 0,
              genome: predGenome,
              dead: false,
              migrated: false,
              matingCd: 99,
              attackCd: 0,
              infection: 0,
            },
          ],
          3000 + attempt,
        ),
      );
      east.restoreState(
        stateWith(
          [
            {
              id: 2,
              speciesId: 2,
              x: 1,
              y: 30,
              heading: 0,
              energy: 0.8,
              health: 1,
              age: 20,
              generation: 0,
              genome: preyGenome,
              dead: false,
              migrated: false,
              matingCd: 99,
              attackCd: 0,
              infection: 0,
            },
          ],
          4000 + attempt,
        ),
      );

      for (let t = 0; t < 30; t++) {
        west.step(0.2, DEFAULT_REGION_MODIFIERS, t);
        const prey = east.creaturesRef()[0]!;
        if (prey.dead) {
          killed = true;
          expect(west.creaturesRef()[0]!.migrated).toBe(false);
          break;
        }
      }
    }
    expect(killed).toBe(true);
  });
});
