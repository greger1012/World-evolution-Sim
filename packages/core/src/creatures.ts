import type {
  ArenaStats,
  CreatureView,
  FoodView,
  Genome,
} from "./types.js";

/** Small deterministic PRNG (mulberry32) so runs are reproducible/testable. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample via Box–Muller. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// --- Tunable model constants (chosen so life is lively but not explosive) ---
const GENE_BOUNDS = {
  size: [0.5, 3.0] as const,
  speed: [0.3, 4.0] as const,
  sense: [1.5, 14.0] as const,
};
const MUTATION_RATE = 0.09; // multiplicative log-normal spread per gene
const HUE_MUTATION = 10; // degrees stddev

const MOVE_SPEED = 3.2; // world units/sec per unit of `speed`
const TURN_JITTER = 2.2; // wander turn rate (rad/sec scale)

const BASE_METABOLISM = 0.018; // energy/sec baseline
const MOVE_COST = 0.02; // * size^3 * speed^2
const SENSE_COST = 0.0009; // * sense^2

const START_ENERGY = 0.55;
const MAX_ENERGY = 1.6;
const FOOD_ENERGY = 0.36;
const REPRO_ENERGY = 1.1; // reproduce at/above this
const REPRO_COST = 0.62; // parent energy spent to spawn a child
const CHILD_ENERGY = 0.48;
const MAX_AGE = 55; // sim-seconds

const FOOD_RADIUS = 0.35;
const FOOD_BASE_CAPACITY = 95; // * richness -> per-region food carrying capacity
const FOOD_REGROW = 0.9; // regrowth rate toward capacity (per sec)

type Creature = {
  x: number;
  y: number;
  heading: number;
  energy: number;
  age: number;
  generation: number;
  genome: Genome;
};

type Food = { x: number; y: number };

function randomGenome(rng: () => number): Genome {
  const lerp = (a: number, b: number) => a + (b - a) * rng();
  return {
    size: lerp(GENE_BOUNDS.size[0], 1.6),
    speed: lerp(0.8, 2.4),
    sense: lerp(GENE_BOUNDS.sense[0], 8),
    hue: rng() * 360,
  };
}

function mutate(g: Genome, rng: () => number): Genome {
  const jitter = (v: number, lo: number, hi: number) =>
    clamp(v * Math.exp(gaussian(rng) * MUTATION_RATE), lo, hi);
  let hue = g.hue + gaussian(rng) * HUE_MUTATION;
  hue = ((hue % 360) + 360) % 360;
  return {
    size: jitter(g.size, GENE_BOUNDS.size[0], GENE_BOUNDS.size[1]),
    speed: jitter(g.speed, GENE_BOUNDS.speed[0], GENE_BOUNDS.speed[1]),
    sense: jitter(g.sense, GENE_BOUNDS.sense[0], GENE_BOUNDS.sense[1]),
    hue,
  };
}

/**
 * A single region's arena: food points plus creatures that sense, move, eat,
 * reproduce (with mutation) and die. Natural selection emerges from the
 * energy budget: bigger/faster/further-sensing bodies cost more to run.
 */
export class RegionEcosystem {
  readonly size: number;
  readonly richness: number;
  private readonly rng: () => number;
  private readonly maxCreatures: number;
  private creatures: Creature[] = [];
  private food: Food[] = [];
  private generation = 0;
  private births = 0;
  private deaths = 0;

  constructor(opts: {
    size: number;
    richness: number;
    seed: number;
    initialCreatures: number;
    maxCreatures: number;
  }) {
    this.size = opts.size;
    this.richness = opts.richness;
    this.rng = makeRng(opts.seed);
    this.maxCreatures = opts.maxCreatures;

    const capacity = this.foodCapacity();
    const startFood = Math.floor(capacity * 0.6);
    for (let i = 0; i < startFood; i++) this.food.push(this.randomPoint());

    for (let i = 0; i < opts.initialCreatures; i++) {
      this.creatures.push({
        x: this.rng() * this.size,
        y: this.rng() * this.size,
        heading: this.rng() * Math.PI * 2,
        energy: START_ENERGY,
        age: 0,
        generation: 0,
        genome: randomGenome(this.rng),
      });
    }
  }

  private foodCapacity(): number {
    return Math.max(6, Math.floor(FOOD_BASE_CAPACITY * this.richness));
  }

  private randomPoint(): Food {
    return { x: this.rng() * this.size, y: this.rng() * this.size };
  }

  get population(): number {
    return this.creatures.length;
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.growFood(dt);

    const newborns: Creature[] = [];
    const survivors: Creature[] = [];

    for (const c of this.creatures) {
      this.senseAndSteer(c, dt);
      this.move(c, dt);

      const g = c.genome;
      const cost =
        BASE_METABOLISM +
        MOVE_COST * g.size * g.size * g.size * g.speed * g.speed +
        SENSE_COST * g.sense * g.sense;
      c.energy -= cost * dt;
      c.age += dt;

      this.eat(c);

      if (c.energy <= 0 || c.age >= MAX_AGE) {
        this.deaths++;
        continue;
      }

      if (
        c.energy >= REPRO_ENERGY &&
        this.creatures.length + newborns.length < this.maxCreatures
      ) {
        c.energy -= REPRO_COST;
        const childGen = c.generation + 1;
        if (childGen > this.generation) this.generation = childGen;
        this.births++;
        newborns.push({
          x: clamp(c.x + (this.rng() - 0.5) * 2, 0, this.size),
          y: clamp(c.y + (this.rng() - 0.5) * 2, 0, this.size),
          heading: this.rng() * Math.PI * 2,
          energy: CHILD_ENERGY,
          age: 0,
          generation: childGen,
          genome: mutate(c.genome, this.rng),
        });
      }

      if (c.energy > MAX_ENERGY) c.energy = MAX_ENERGY;
      survivors.push(c);
    }

    for (const n of newborns) survivors.push(n);
    this.creatures = survivors;

    // Reseed a small founder population if the region goes extinct, so the
    // world keeps exploring rather than staying empty forever.
    if (this.creatures.length === 0 && this.food.length > 4) {
      for (let i = 0; i < 4; i++) {
        this.creatures.push({
          x: this.rng() * this.size,
          y: this.rng() * this.size,
          heading: this.rng() * Math.PI * 2,
          energy: START_ENERGY,
          age: 0,
          generation: 0,
          genome: randomGenome(this.rng),
        });
      }
    }
  }

  private growFood(dt: number): void {
    const capacity = this.foodCapacity();
    const deficit = capacity - this.food.length;
    if (deficit <= 0) return;
    let expected = deficit * FOOD_REGROW * dt;
    while (expected > 0) {
      if (expected >= 1 || this.rng() < expected) this.food.push(this.randomPoint());
      expected -= 1;
    }
  }

  private senseAndSteer(c: Creature, dt: number): void {
    const senseR = c.genome.sense;
    const senseR2 = senseR * senseR;
    let best = -1;
    let bestD2 = senseR2;
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i]!;
      const dx = f.x - c.x;
      const dy = f.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best >= 0) {
      const f = this.food[best]!;
      const target = Math.atan2(f.y - c.y, f.x - c.x);
      let diff = target - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.heading += clamp(diff, -6 * dt, 6 * dt);
    } else {
      c.heading += (this.rng() - 0.5) * TURN_JITTER * dt;
    }
  }

  private move(c: Creature, dt: number): void {
    const v = c.genome.speed * MOVE_SPEED;
    c.x += Math.cos(c.heading) * v * dt;
    c.y += Math.sin(c.heading) * v * dt;
    // Reflect off arena walls.
    if (c.x < 0) {
      c.x = -c.x;
      c.heading = Math.PI - c.heading;
    } else if (c.x > this.size) {
      c.x = 2 * this.size - c.x;
      c.heading = Math.PI - c.heading;
    }
    if (c.y < 0) {
      c.y = -c.y;
      c.heading = -c.heading;
    } else if (c.y > this.size) {
      c.y = 2 * this.size - c.y;
      c.heading = -c.heading;
    }
    c.x = clamp(c.x, 0, this.size);
    c.y = clamp(c.y, 0, this.size);
  }

  private eat(c: Creature): void {
    const reach = c.genome.size + FOOD_RADIUS;
    const reach2 = reach * reach;
    for (let i = this.food.length - 1; i >= 0; i--) {
      const f = this.food[i]!;
      const dx = f.x - c.x;
      const dy = f.y - c.y;
      if (dx * dx + dy * dy <= reach2) {
        c.energy += FOOD_ENERGY;
        const last = this.food.pop()!;
        if (i < this.food.length) this.food[i] = last;
        if (c.energy >= MAX_ENERGY) break;
      }
    }
  }

  creatureViews(): CreatureView[] {
    const out: CreatureView[] = new Array(this.creatures.length);
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i]!;
      out[i] = {
        x: c.x,
        y: c.y,
        radius: c.genome.size,
        hue: c.genome.hue,
        energy: clamp(c.energy / MAX_ENERGY, 0, 1),
        sense: c.genome.sense,
      };
    }
    return out;
  }

  foodViews(): FoodView[] {
    const out: FoodView[] = new Array(this.food.length);
    for (let i = 0; i < this.food.length; i++) {
      const f = this.food[i]!;
      out[i] = { x: f.x, y: f.y };
    }
    return out;
  }

  stats(): ArenaStats {
    const n = this.creatures.length;
    if (n === 0) {
      return {
        population: 0,
        generation: this.generation,
        meanSize: 0,
        meanSpeed: 0,
        meanSense: 0,
        births: this.births,
        deaths: this.deaths,
      };
    }
    let s = 0;
    let sp = 0;
    let se = 0;
    for (const c of this.creatures) {
      s += c.genome.size;
      sp += c.genome.speed;
      se += c.genome.sense;
    }
    return {
      population: n,
      generation: this.generation,
      meanSize: s / n,
      meanSpeed: sp / n,
      meanSense: se / n,
      births: this.births,
      deaths: this.deaths,
    };
  }

  /** 0–1 ecosystem health: population relative to a reference carrying capacity. */
  biomass(): number {
    const ref = Math.max(8, this.maxCreatures * 0.55);
    return clamp(this.creatures.length / ref, 0, 1);
  }

  /** 0–1 genome dispersion, from the coefficient of variation of body size. */
  diversity(): number {
    const n = this.creatures.length;
    if (n < 2) return 0;
    let mean = 0;
    for (const c of this.creatures) mean += c.genome.size;
    mean /= n;
    if (mean <= 0) return 0;
    let varSum = 0;
    for (const c of this.creatures) {
      const d = c.genome.size - mean;
      varSum += d * d;
    }
    const cv = Math.sqrt(varSum / n) / mean;
    return clamp(cv * 2.2, 0, 1);
  }
}
