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

// --- Tunable model constants -------------------------------------------------
const GENE_BOUNDS = {
  size: [0.5, 3.2] as const,
  speed: [0.3, 4.2] as const,
  sense: [1.5, 15.0] as const,
};
const MUTATION_RATE = 0.09; // multiplicative log-normal spread per gene
const HUE_MUTATION = 10; // degrees stddev
const DIET_MUTATION = 0.06; // additive stddev on diet in [0,1]

const MOVE_SPEED = 3.2; // world units/sec per unit of `speed`
const TURN_JITTER = 2.2; // wander turn rate scale
const PREDATOR_START_FRACTION = 0.18;

const BASE_METABOLISM = 0.02; // energy/sec baseline
const MOVE_COST = 0.017; // * size^3 * speed^2
const PREDATOR_MOVE_DISCOUNT = 0.55; // hunters are built for the chase
const SENSE_COST = 0.0008; // * sense^2
const PREDATOR_UPKEEP = 0.006; // extra baseline for hunters

const START_ENERGY = 0.55;
const MAX_ENERGY = 1.6;
const PLANT_ENERGY = 0.34; // per plant, scaled by (1 - diet)
const REPRO_ENERGY = 1.15; // reproduce at/above this
const REPRO_COST = 0.64; // parent energy spent to spawn a child
const CHILD_ENERGY = 0.46;
const MAX_AGE = 55; // sim-seconds

// Health: body condition, distinct from the energy (food) reserve.
const START_HEALTH = 0.85;
const MAX_HEALTH = 1;
const STARVE_HEALTH_RATE = 0.32; // health/sec lost while energy is empty
const REGEN_HEALTH_RATE = 0.12; // health/sec regained while well fed
const REGEN_ENERGY = 0.5; // energy above which health regenerates
const AGE_HEALTH_PENALTY = 0.4; // max health lost by end of life
const REPRO_HEALTH_MIN = 0.5; // must be at least this healthy to breed

// Predation.
const PREY_MAX_RATIO = 1.4; // predator can catch prey up to this * own size
const CATCH_REACH = 0.9; // extra lunge distance when striking prey
const MEAT_ENERGY_K = 0.9; // energy per unit of prey body size
const MEAT_ENERGY_CAP = 1.6;

const FOOD_RADIUS = 0.35;
const FOOD_BASE_CAPACITY = 130; // * richness -> per-region plant carrying capacity
const FOOD_REGROW = 1.0; // regrowth rate toward capacity (per sec)

type Creature = {
  id: number;
  x: number;
  y: number;
  heading: number;
  energy: number;
  health: number;
  age: number;
  generation: number;
  genome: Genome;
  dead: boolean;
};

type Food = { x: number; y: number };

function isPredator(g: Genome): boolean {
  return g.diet >= 0.5;
}

function randomGenome(rng: () => number, allowPredator: boolean): Genome {
  const lerp = (a: number, b: number) => a + (b - a) * rng();
  const predator = allowPredator && rng() < PREDATOR_START_FRACTION;
  return {
    size: predator ? lerp(0.9, 1.5) : lerp(GENE_BOUNDS.size[0], 1.4),
    speed: predator ? lerp(1.8, 3.0) : lerp(0.9, 2.4),
    sense: predator ? lerp(4, 9) : lerp(GENE_BOUNDS.sense[0], 8),
    diet: predator ? lerp(0.6, 0.85) : lerp(0, 0.18),
    hue: predator ? lerp(0, 30) : lerp(90, 210),
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
    diet: clamp(g.diet + gaussian(rng) * DIET_MUTATION, 0, 1),
    hue,
  };
}

/**
 * A single region's arena. Plants (food points) regrow toward a carrying
 * capacity; creatures carry heritable genomes (size, speed, sense, diet, hue)
 * and spend energy to move and sense. Herbivores graze plants and flee
 * predators; carnivores hunt smaller creatures. Reproduction copies the genome
 * with mutation, and starvation or old age erodes health until death. Natural
 * selection emerges from the energy budget and predation pressure.
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
  private nextId = 1;

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
    const startFood = Math.floor(capacity * 0.85);
    for (let i = 0; i < startFood; i++) this.food.push(this.randomPoint());

    for (let i = 0; i < opts.initialCreatures; i++) {
      this.creatures.push(this.spawn(randomGenome(this.rng, true), 0, START_ENERGY));
    }
  }

  private spawn(genome: Genome, generation: number, energy: number, x?: number, y?: number): Creature {
    return {
      id: this.nextId++,
      x: x ?? this.rng() * this.size,
      y: y ?? this.rng() * this.size,
      heading: this.rng() * Math.PI * 2,
      energy,
      health: START_HEALTH,
      age: 0,
      generation,
      genome,
      dead: false,
    };
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

    const list = this.creatures;
    const newborns: Creature[] = [];

    for (const c of list) {
      if (c.dead) continue;

      this.senseAndSteer(c, list, dt);
      this.move(c, dt);

      const g = c.genome;
      const pred = isPredator(g);
      const moveCost =
        MOVE_COST * g.size * g.size * g.size * g.speed * g.speed *
        (pred ? PREDATOR_MOVE_DISCOUNT : 1);
      const cost =
        BASE_METABOLISM +
        moveCost +
        SENSE_COST * g.sense * g.sense +
        (pred ? PREDATOR_UPKEEP : 0);
      c.energy -= cost * dt;
      if (c.energy < 0) c.energy = 0;
      c.age += dt;

      this.feed(c, list);

      // Health tracks body condition separately from the food reserve.
      const maxH = MAX_HEALTH * (1 - AGE_HEALTH_PENALTY * (c.age / MAX_AGE));
      if (c.energy <= 1e-4) {
        c.health -= STARVE_HEALTH_RATE * dt;
      } else if (c.energy > REGEN_ENERGY && c.health < maxH) {
        c.health = Math.min(maxH, c.health + REGEN_HEALTH_RATE * dt);
      }
      if (c.health > maxH) c.health = maxH;

      if (c.dead || c.health <= 0 || c.age >= MAX_AGE) {
        c.dead = true;
        this.deaths++;
        continue;
      }

      if (
        c.energy >= REPRO_ENERGY &&
        c.health >= REPRO_HEALTH_MIN &&
        list.length + newborns.length < this.maxCreatures
      ) {
        c.energy -= REPRO_COST;
        const childGen = c.generation + 1;
        if (childGen > this.generation) this.generation = childGen;
        this.births++;
        newborns.push(
          this.spawn(
            mutate(c.genome, this.rng),
            childGen,
            CHILD_ENERGY,
            clamp(c.x + (this.rng() - 0.5) * 2, 0, this.size),
            clamp(c.y + (this.rng() - 0.5) * 2, 0, this.size),
          ),
        );
      }

      if (c.energy > MAX_ENERGY) c.energy = MAX_ENERGY;
    }

    const survivors: Creature[] = [];
    for (const c of list) if (!c.dead) survivors.push(c);
    for (const n of newborns) survivors.push(n);
    this.creatures = survivors;

    // Reseed a small founder population if the region goes extinct, so the
    // world keeps exploring rather than staying empty forever.
    if (this.creatures.length === 0 && this.food.length > 4) {
      for (let i = 0; i < 4; i++) {
        this.creatures.push(this.spawn(randomGenome(this.rng, false), 0, START_ENERGY));
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

  private nearestPrey(c: Creature, list: Creature[]): Creature | null {
    const senseR2 = c.genome.sense * c.genome.sense;
    let best: Creature | null = null;
    let bestD2 = senseR2;
    for (const o of list) {
      if (o === c || o.dead || isPredator(o.genome)) continue;
      if (o.genome.size > c.genome.size * PREY_MAX_RATIO) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    }
    return best;
  }

  private nearestPredator(c: Creature, list: Creature[]): Creature | null {
    const senseR2 = c.genome.sense * c.genome.sense;
    let best: Creature | null = null;
    let bestD2 = senseR2;
    for (const o of list) {
      if (o === c || o.dead || !isPredator(o.genome)) continue;
      if (c.genome.size > o.genome.size * PREY_MAX_RATIO) continue; // too big to be prey
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    }
    return best;
  }

  private nearestFood(c: Creature): number {
    const senseR2 = c.genome.sense * c.genome.sense;
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
    return best;
  }

  private steerToward(c: Creature, tx: number, ty: number, dt: number): void {
    const target = Math.atan2(ty - c.y, tx - c.x);
    let diff = target - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.heading += clamp(diff, -6 * dt, 6 * dt);
  }

  private steerAway(c: Creature, tx: number, ty: number, dt: number): void {
    this.steerToward(c, 2 * c.x - tx, 2 * c.y - ty, dt);
  }

  private senseAndSteer(c: Creature, list: Creature[], dt: number): void {
    if (isPredator(c.genome)) {
      const prey = this.nearestPrey(c, list);
      if (prey) {
        this.steerToward(c, prey.x, prey.y, dt);
        return;
      }
    } else {
      const threat = this.nearestPredator(c, list);
      if (threat) {
        this.steerAway(c, threat.x, threat.y, dt);
        return;
      }
      const fi = this.nearestFood(c);
      if (fi >= 0) {
        const f = this.food[fi]!;
        this.steerToward(c, f.x, f.y, dt);
        return;
      }
    }
    c.heading += (this.rng() - 0.5) * TURN_JITTER * dt;
  }

  private move(c: Creature, dt: number): void {
    const v = c.genome.speed * MOVE_SPEED;
    c.x += Math.cos(c.heading) * v * dt;
    c.y += Math.sin(c.heading) * v * dt;
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

  /** Eat plants (herbivory) and/or catch prey (carnivory), scaled by diet. */
  private feed(c: Creature, list: Creature[]): void {
    const diet = c.genome.diet;

    // Herbivory: consume nearby plants (efficiency falls as diet -> carnivore).
    const plantGain = PLANT_ENERGY * (1 - diet);
    if (plantGain > 0.001) {
      const reach = c.genome.size + FOOD_RADIUS;
      const reach2 = reach * reach;
      for (let i = this.food.length - 1; i >= 0; i--) {
        const f = this.food[i]!;
        const dx = f.x - c.x;
        const dy = f.y - c.y;
        if (dx * dx + dy * dy <= reach2) {
          c.energy += plantGain;
          const lastFood = this.food.pop()!;
          if (i < this.food.length) this.food[i] = lastFood;
          if (c.energy >= MAX_ENERGY) return;
        }
      }
    }

    // Carnivory: catch the nearest catchable prey in contact.
    if (diet > 0.05) {
      for (const o of list) {
        if (o === c || o.dead || isPredator(o.genome)) continue;
        if (o.genome.size > c.genome.size * PREY_MAX_RATIO) continue;
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        const contact = c.genome.size + o.genome.size + CATCH_REACH;
        if (dx * dx + dy * dy <= contact * contact) {
          const gain = Math.min(
            MEAT_ENERGY_CAP,
            MEAT_ENERGY_K * o.genome.size + 0.5 * o.energy,
          ) * diet;
          c.energy += gain;
          o.dead = true;
          o.energy = 0;
          this.deaths++;
          if (c.energy >= MAX_ENERGY) return;
        }
      }
    }
  }

  creatureViews(): CreatureView[] {
    const out: CreatureView[] = new Array(this.creatures.length);
    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i]!;
      out[i] = {
        id: c.id,
        x: c.x,
        y: c.y,
        radius: c.genome.size,
        hue: c.genome.hue,
        energy: clamp(c.energy / MAX_ENERGY, 0, 1),
        health: clamp(c.health, 0, 1),
        speed: c.genome.speed,
        sense: c.genome.sense,
        diet: c.genome.diet,
        age: c.age,
        generation: c.generation,
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
        meanHealth: 0,
        carnivoreFraction: 0,
        births: this.births,
        deaths: this.deaths,
      };
    }
    let s = 0;
    let sp = 0;
    let se = 0;
    let hp = 0;
    let carn = 0;
    for (const c of this.creatures) {
      s += c.genome.size;
      sp += c.genome.speed;
      se += c.genome.sense;
      hp += c.health;
      if (isPredator(c.genome)) carn++;
    }
    return {
      population: n,
      generation: this.generation,
      meanSize: s / n,
      meanSpeed: sp / n,
      meanSense: se / n,
      meanHealth: hp / n,
      carnivoreFraction: carn / n,
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
