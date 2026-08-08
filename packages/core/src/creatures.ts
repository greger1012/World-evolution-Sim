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
const DIET_MUTATION = 0.04; // additive stddev on diet in [0,1]
const DIET_INNOVATION_CHANCE = 0.02; // chance of a larger diet jump
const DIET_INNOVATION_STEP = 0.22; // stddev of that larger jump

const MOVE_SPEED = 3.2; // world units/sec per unit of `speed`
const TURN_JITTER = 2.2; // wander turn rate scale
const PREDATOR_START_FRACTION = 0.22;

// Trade-off: mass (~size^2 here) times speed^2 — raising the speed gene burns
// disproportionately more energy, and bigger bodies pay more for the same gene.
const BASE_METABOLISM = 0.02; // energy/sec baseline
const MOVE_COST = 0.022; // * size^2 * speed^2
const PREDATOR_MOVE_DISCOUNT = 0.55; // hunters are built for the chase
const SENSE_COST = 0.0008; // * sense^2
const PREDATOR_UPKEEP = 0.006; // extra baseline for hunters

const START_ENERGY = 0.55;
const MAX_ENERGY = 1.6;
const PLANT_ENERGY = 0.34; // per plant, scaled by (1 - diet)
const MAX_AGE = 55; // sim-seconds

// Reproduction system: adults that are well fed seek a compatible mate
// (same trophic type, similar lineage colour); pairs pay energy and produce a
// small litter via genome crossover + mutation. Lonely but very well-fed
// creatures can fall back to costlier asexual budding.
const MATURITY_AGE = 6; // sim-seconds before a creature can breed
const MATE_ENERGY = 0.95; // energy needed to seek a mate
const MATE_COST = 0.42; // paid by EACH parent on mating
const MATE_CONTACT_BONUS = 0.6; // extra reach to touch a mate
const REPRO_COOLDOWN = 5; // sim-seconds between breeding attempts
const HUE_COMPATIBILITY = 70; // max lineage-colour distance for mating (degrees)
const LITTER_SECOND_CHILD_CHANCE = 0.35;
const ASEX_ENERGY = 1.28; // asexual fallback threshold (well above mating)
const ASEX_COST = 0.64;
const CHILD_ENERGY = 0.46;
const REPRO_HEALTH_MIN = 0.5; // must be at least this healthy to breed

// Health: body condition, distinct from the energy (food) reserve.
const START_HEALTH = 0.85;
const MAX_HEALTH = 1;
const STARVE_HEALTH_RATE = 0.32; // health/sec lost while energy is empty
const REGEN_HEALTH_RATE = 0.12; // health/sec regained while well fed
const REGEN_ENERGY = 0.5; // energy above which health regenerates
const AGE_HEALTH_PENALTY = 0.4; // max health lost by end of life

// Predation with size-based struggle: bigger predators can take down bigger
// prey; relatively big prey usually win the struggle, escape, and may injure
// the attacker.
const PREY_MAX_RATIO = 1.4; // predator will attempt prey up to this * own size
const PREDATOR_SPRINT = 1.22; // hunting burst: predators move this much faster
const CATCH_REACH = 0.9; // extra lunge distance when striking prey
const CATCH_BASE_CHANCE = 0.9; // scaled by (predSize / (preySize*1.15))^2.5
const CATCH_MIN_CHANCE = 0.08;
const CATCH_MAX_CHANCE = 0.95;
const ATTACK_COOLDOWN = 0.55; // sim-seconds between strikes
const ATTACK_COST = 0.04; // energy per strike, hit or miss
const STRUGGLE_INJURY = 0.06; // attacker health lost * (preySize/predSize) on a miss
const MEAT_ENERGY_K = 0.92; // energy per unit of prey body size
const MEAT_ENERGY_CAP = 1.5;

const FOOD_RADIUS = 0.35;
const FOOD_BASE_CAPACITY = 135; // * richness -> per-region plant carrying capacity
const FOOD_REGROW = 1.0; // regrowth rate toward capacity (per sec)

export type Creature = {
  id: number;
  /** Species tag; inherited from parents, -1 until the registry assigns one. */
  speciesId: number;
  x: number;
  y: number;
  heading: number;
  energy: number;
  health: number;
  age: number;
  generation: number;
  genome: Genome;
  dead: boolean;
  /** Time until this creature may breed again. */
  matingCd: number;
  /** Time until a predator may strike again. */
  attackCd: number;
};

type Food = { x: number; y: number };

export function isPredator(g: Genome): boolean {
  return g.diet >= 0.5;
}

/**
 * Trade-off: actual movement speed falls with body size, so a big body must
 * be paid for with predation power rather than raw pace.
 */
function effectiveSpeed(g: Genome): number {
  return g.speed / Math.sqrt(g.size);
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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
  // Diet normally drifts slowly (niches stay stable), but a rare "innovation"
  // makes a larger jump so carnivory keeps re-seeding from herbivore stock and
  // the predator niche recovers after a crash instead of vanishing for good.
  const dietStep = rng() < DIET_INNOVATION_CHANCE ? DIET_INNOVATION_STEP : DIET_MUTATION;
  return {
    size: jitter(g.size, GENE_BOUNDS.size[0], GENE_BOUNDS.size[1]),
    speed: jitter(g.speed, GENE_BOUNDS.speed[0], GENE_BOUNDS.speed[1]),
    sense: jitter(g.sense, GENE_BOUNDS.sense[0], GENE_BOUNDS.sense[1]),
    diet: clamp(g.diet + gaussian(rng) * dietStep, 0, 1),
    hue,
  };
}

/** Sexual reproduction: each gene comes from either parent, then mutates. */
function crossover(a: Genome, b: Genome, rng: () => number): Genome {
  const pick = (x: number, y: number) => (rng() < 0.5 ? x : y);
  return mutate(
    {
      size: pick(a.size, b.size),
      speed: pick(a.speed, b.speed),
      sense: pick(a.sense, b.sense),
      diet: pick(a.diet, b.diet),
      hue: pick(a.hue, b.hue),
    },
    rng,
  );
}

/**
 * A single region's arena. Plants (food points) regrow toward a carrying
 * capacity; creatures carry heritable genomes (size, speed, sense, diet, hue)
 * and spend energy to move and sense. Herbivores graze plants and flee
 * predators; carnivores hunt. Body size trades off against pace (big = slow)
 * but wins predation struggles on both sides; the speed gene burns extra
 * energy. Mature, well-fed creatures court compatible partners (same trophic
 * type, similar lineage colour) and produce litters via crossover + mutation,
 * with a costly asexual fallback for the lonely. Starvation, injury, or old
 * age erode health until death. Selection emerges from the energy budget,
 * predation pressure, and mate availability.
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
      this.creatures.push(this.spawn(randomGenome(this.rng, true), 0, START_ENERGY, -1));
    }
  }

  private spawn(
    genome: Genome,
    generation: number,
    energy: number,
    speciesId: number,
    x?: number,
    y?: number,
  ): Creature {
    return {
      id: this.nextId++,
      speciesId,
      x: x ?? this.rng() * this.size,
      y: y ?? this.rng() * this.size,
      heading: this.rng() * Math.PI * 2,
      energy,
      health: START_HEALTH,
      age: 0,
      generation,
      genome,
      dead: false,
      matingCd: 1.5,
      attackCd: 0,
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

  get carnivoreCount(): number {
    let n = 0;
    for (const c of this.creatures) if (isPredator(c.genome)) n++;
    return n;
  }

  /** Live internal creature refs, for the species registry. Do not mutate. */
  creaturesRef(): readonly Creature[] {
    return this.creatures;
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
        MOVE_COST * g.size * g.size * g.speed * g.speed *
        (pred ? PREDATOR_MOVE_DISCOUNT : 1);
      const cost =
        BASE_METABOLISM +
        moveCost +
        SENSE_COST * g.sense * g.sense +
        (pred ? PREDATOR_UPKEEP : 0);
      c.energy -= cost * dt;
      if (c.energy < 0) c.energy = 0;
      c.age += dt;
      if (c.matingCd > 0) c.matingCd -= dt;
      if (c.attackCd > 0) c.attackCd -= dt;

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

      if (this.readyToMate(c) && list.length + newborns.length < this.maxCreatures) {
        const mate = this.findMate(c, list, /*contactOnly*/ true);
        if (mate) {
          this.mate(c, mate, newborns);
        } else if (c.energy >= ASEX_ENERGY) {
          // Lonely but very well fed: costlier asexual budding keeps sparse
          // populations from dead-ending while still favouring pair mating.
          c.energy -= ASEX_COST;
          c.matingCd = REPRO_COOLDOWN;
          this.birth(mutate(c.genome, this.rng), c.generation + 1, c, newborns);
        }
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
        this.creatures.push(this.spawn(randomGenome(this.rng, false), 0, START_ENERGY, -1));
      }
    }
  }

  private readyToMate(c: Creature): boolean {
    return (
      !c.dead &&
      c.age >= MATURITY_AGE &&
      c.energy >= MATE_ENERGY &&
      c.health >= REPRO_HEALTH_MIN &&
      c.matingCd <= 0
    );
  }

  private compatible(a: Creature, b: Creature): boolean {
    return (
      isPredator(a.genome) === isPredator(b.genome) &&
      hueDistance(a.genome.hue, b.genome.hue) <= HUE_COMPATIBILITY
    );
  }

  /**
   * Nearest ready, compatible partner — within touching distance when
   * `contactOnly`, otherwise anywhere inside this creature's sense radius.
   */
  private findMate(c: Creature, list: Creature[], contactOnly: boolean): Creature | null {
    const range = contactOnly
      ? c.genome.size + MATE_CONTACT_BONUS
      : c.genome.sense;
    let best: Creature | null = null;
    let bestD2 = Infinity;
    for (const o of list) {
      if (o === c || !this.readyToMate(o) || !this.compatible(c, o)) continue;
      const reach = contactOnly ? range + o.genome.size : range;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= reach * reach && d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    }
    return best;
  }

  private mate(a: Creature, b: Creature, newborns: Creature[]): void {
    a.energy -= MATE_COST;
    b.energy -= MATE_COST;
    a.matingCd = REPRO_COOLDOWN;
    b.matingCd = REPRO_COOLDOWN;
    const gen = Math.max(a.generation, b.generation) + 1;
    const litter = 1 + (this.rng() < LITTER_SECOND_CHILD_CHANCE ? 1 : 0);
    for (let i = 0; i < litter; i++) {
      this.birth(crossover(a.genome, b.genome, this.rng), gen, a, newborns);
    }
  }

  private birth(genome: Genome, gen: number, near: Creature, newborns: Creature[]): void {
    if (gen > this.generation) this.generation = gen;
    this.births++;
    newborns.push(
      this.spawn(
        genome,
        gen,
        CHILD_ENERGY,
        near.speciesId,
        clamp(near.x + (this.rng() - 0.5) * 2, 0, this.size),
        clamp(near.y + (this.rng() - 0.5) * 2, 0, this.size),
      ),
    );
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
    // Hunters pick targets they can realistically run down; anything faster
    // than their sprint is not worth chasing.
    const maxPreySpeed = effectiveSpeed(c.genome) * PREDATOR_SPRINT;
    let best: Creature | null = null;
    let bestD2 = senseR2;
    for (const o of list) {
      if (o === c || o.dead || isPredator(o.genome)) continue;
      if (o.genome.size > c.genome.size * PREY_MAX_RATIO) continue;
      if (effectiveSpeed(o.genome) > maxPreySpeed) continue;
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
      // Well-fed adults court; hungry ones hunt.
      if (this.readyToMate(c)) {
        const partner = this.findMate(c, list, false);
        if (partner) {
          this.steerToward(c, partner.x, partner.y, dt);
          return;
        }
      }
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
      if (this.readyToMate(c)) {
        const partner = this.findMate(c, list, false);
        if (partner) {
          this.steerToward(c, partner.x, partner.y, dt);
          return;
        }
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
    const sprint = isPredator(c.genome) ? PREDATOR_SPRINT : 1;
    const v = effectiveSpeed(c.genome) * MOVE_SPEED * sprint;
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

    // Carnivory: strike the nearest catchable prey in contact. Success depends
    // on the size ratio — big predators bring down big prey, while relatively
    // big prey usually win the struggle, escape, and can injure the attacker.
    if (diet > 0.05 && c.attackCd <= 0) {
      let target: Creature | null = null;
      let bestD2 = Infinity;
      for (const o of list) {
        if (o === c || o.dead || isPredator(o.genome)) continue;
        if (o.genome.size > c.genome.size * PREY_MAX_RATIO) continue;
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        const contact = c.genome.size + o.genome.size + CATCH_REACH;
        const d2 = dx * dx + dy * dy;
        if (d2 <= contact * contact && d2 < bestD2) {
          bestD2 = d2;
          target = o;
        }
      }
      if (target) {
        c.attackCd = ATTACK_COOLDOWN;
        c.energy -= ATTACK_COST;
        if (c.energy < 0) c.energy = 0;
        const ratio = c.genome.size / (target.genome.size * 1.15);
        const chance = clamp(
          CATCH_BASE_CHANCE * Math.pow(ratio, 2.5),
          CATCH_MIN_CHANCE,
          CATCH_MAX_CHANCE,
        );
        if (this.rng() < chance) {
          const gain = Math.min(
            MEAT_ENERGY_CAP,
            MEAT_ENERGY_K * target.genome.size + 0.5 * target.energy,
          ) * diet;
          c.energy += gain;
          target.dead = true;
          target.energy = 0;
          this.deaths++;
        } else {
          // The prey fights free: the bigger it is, the worse for the attacker.
          c.health -= STRUGGLE_INJURY * (target.genome.size / c.genome.size);
          target.heading = Math.atan2(target.y - c.y, target.x - c.x);
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
        speciesId: c.speciesId,
        x: c.x,
        y: c.y,
        radius: c.genome.size,
        hue: c.genome.hue,
        energy: clamp(c.energy / MAX_ENERGY, 0, 1),
        health: clamp(c.health, 0, 1),
        speed: c.genome.speed,
        effSpeed: effectiveSpeed(c.genome),
        sense: c.genome.sense,
        diet: c.genome.diet,
        age: c.age,
        generation: c.generation,
        mature: c.age >= MATURITY_AGE,
        readyToMate: this.readyToMate(c),
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
