import { climateFoodFactor } from "./globe.js";
import { SpatialGrid } from "./spatial.js";
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
const UNIT_GENE_MUTATION = 0.05; // additive stddev for armor/social/fecundity

// Armor: plating blocks and punishes attacks, but is heavy and costly.
const ARMOR_COST = 0.15; // energy/sec * armor * size
const ARMOR_SPEED_PENALTY = 0.35; // fraction of pace lost at full armor
const ARMOR_DEFENSE = 0.3; // catch chance *= 1 - this * armor
const ARMOR_SPIKE = 0.7; // attacker injury *= 1 + this * armor

// Social: herbivores herd for safety; carnivores hunt in packs.
const HERD_RADIUS = 5; // same-species neighbours that count as a herd
const HERD_DEFENSE = 0.08; // catch chance *= 1 - min(0.4, this * social * mates)
const PACK_RADIUS = 6; // same-species hunters that count as a pack
const PACK_BONUS = 0.22; // catch chance *= 1 + this * social * packmates (<=4)
const PACK_PREY_RATIO = 0.22; // packs attempt prey up to this much bigger per mate
const KILL_SHARE = 0.45; // fraction of a pack kill shared with packmates
const COHESION_TURN = 2.5; // group-cohesion steering rate * social

// Fecundity (r/K): a fixed birth pool splits across the litter.
const MAX_LITTER = 3;
const BIRTH_POOL = 0.92; // ~ both parents' mating spend
const CHILD_ENERGY_MIN = 0.17;
const CHILD_ENERGY_MAX = 0.46;

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
const ASEX_ENERGY = 1.28; // asexual fallback threshold (well above mating)
const ASEX_COST = 0.64;
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
const PREDATOR_SPRINT = 1.38; // hunting burst: predators move this much faster
const CATCH_REACH = 0.9; // extra lunge distance when striking prey
const CATCH_BASE_CHANCE = 0.9; // scaled by (predSize / (preySize*1.15))^2.5
const CATCH_MIN_CHANCE = 0.12;
const CATCH_MAX_CHANCE = 0.95;
const ATTACK_COOLDOWN = 0.55; // sim-seconds between strikes
const ATTACK_COST = 0.025; // energy per strike, hit or miss
const STRUGGLE_INJURY = 0.05; // attacker health lost * (preySize/predSize) on a miss
const MEAT_ENERGY_K = 1.0; // energy per unit of prey body size
const MEAT_ENERGY_CAP = 1.7;

const FOOD_RADIUS = 0.35;
const FOOD_BASE_CAPACITY = 135; // * richness * climate -> plant carrying capacity
const FOOD_REGROW = 1.0; // regrowth rate toward capacity (per sec)

// Climate stress (Bergmann's rule): cold punishes small bodies (poor
// surface-to-volume ratio), heat punishes large ones — so different regions
// select for different sizes.
const COLD_THRESHOLD = 0.45;
const HEAT_THRESHOLD = 0.62;
const COLD_STRESS = 0.18; // energy/sec * coldness / size
const HEAT_STRESS = 0.06; // energy/sec * heat * size

// Migration: a region's left/right edges connect to its neighbours. Crossing
// is chancy (think mountain passes) and costs energy, so gene flow is real
// but regional ecologies stay distinct.
const MIGRATION_CHANCE = 0.07;
const MIGRATION_COST = 0.06;

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
  /** Set when the creature crossed a border this step (leaves, not dies). */
  migrated: boolean;
  /** Time until this creature may breed again. */
  matingCd: number;
  /** Time until a predator may strike again. */
  attackCd: number;
};

/** A creature leaving a region: direction is -1 (left/previous) or +1 (right/next). */
export type Emigrant = { creature: Creature; direction: -1 | 1 };

type Food = { x: number; y: number; dead: boolean };

/** Grid cell size; interaction radii up to `sense` span a couple of cells. */
const GRID_CELL = 12;
/** Cell-pruning pad: creatures can move a few units between rebuild and query. */
const GRID_SLACK = 4;
/**
 * Below this population a plain scan beats the grid (cell pruning cannot pay
 * for its bookkeeping), so the grid only engages for crowded arenas.
 */
const GRID_MIN_ITEMS = 64;

export function isPredator(g: Genome): boolean {
  return g.diet >= 0.5;
}

/**
 * Trade-off: actual movement speed falls with body size and armor weight, so
 * a big or plated body must be paid for with staying power, not raw pace.
 */
function effectiveSpeed(g: Genome): number {
  return (g.speed / Math.sqrt(g.size)) * (1 - ARMOR_SPEED_PENALTY * g.armor);
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
    armor: predator ? lerp(0, 0.15) : lerp(0.02, 0.3),
    social: predator ? lerp(0.3, 0.8) : lerp(0, 0.6),
    // Hunters start as K-strategists: few, well-provisioned young. A hungry
    // newborn that must catch prey cannot afford to start weak.
    fecundity: predator ? lerp(0.1, 0.4) : lerp(0.25, 0.7),
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
  const unit = (v: number) => clamp(v + gaussian(rng) * UNIT_GENE_MUTATION, 0, 1);
  return {
    size: jitter(g.size, GENE_BOUNDS.size[0], GENE_BOUNDS.size[1]),
    speed: jitter(g.speed, GENE_BOUNDS.speed[0], GENE_BOUNDS.speed[1]),
    sense: jitter(g.sense, GENE_BOUNDS.sense[0], GENE_BOUNDS.sense[1]),
    diet: clamp(g.diet + gaussian(rng) * dietStep, 0, 1),
    armor: unit(g.armor),
    social: unit(g.social),
    fecundity: unit(g.fecundity),
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
      armor: pick(a.armor, b.armor),
      social: pick(a.social, b.social),
      fecundity: pick(a.fecundity, b.fecundity),
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
  readonly temperature: number;
  private readonly rng: () => number;
  private readonly maxCreatures: number;
  private readonly nextId: () => number;
  private creatures: Creature[] = [];
  private food: Food[] = [];
  private emigrants: Emigrant[] = [];
  private readonly creatureGrid: SpatialGrid<Creature>;
  private readonly foodGrid: SpatialGrid<Food>;
  /** Food never moves: the grid is maintained incrementally and only rebuilt
   * occasionally to purge eaten (dead) references. */
  private foodPurgeCountdown = 64;
  private generation = 0;
  private births = 0;
  private deaths = 0;

  constructor(opts: {
    size: number;
    richness: number;
    temperature: number;
    seed: number;
    initialCreatures: number;
    maxCreatures: number;
    /** Shared id allocator so ids stay unique across regions (migration). */
    idAlloc: () => number;
  }) {
    this.size = opts.size;
    this.richness = opts.richness;
    this.temperature = opts.temperature;
    this.rng = makeRng(opts.seed);
    this.maxCreatures = opts.maxCreatures;
    this.nextId = opts.idAlloc;
    this.creatureGrid = new SpatialGrid<Creature>(opts.size, GRID_CELL, GRID_SLACK);
    this.foodGrid = new SpatialGrid<Food>(opts.size, GRID_CELL, GRID_SLACK);

    const capacity = this.foodCapacity();
    const startFood = Math.floor(capacity * 0.85);
    for (let i = 0; i < startFood; i++) this.food.push(this.randomPoint());
    this.foodGrid.rebuild(this.food);

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
      id: this.nextId(),
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
      migrated: false,
      matingCd: 1.5,
      attackCd: 0,
    };
  }

  private foodCapacity(): number {
    return Math.max(
      6,
      Math.floor(FOOD_BASE_CAPACITY * this.richness * climateFoodFactor(this.temperature)),
    );
  }

  /** Creatures that crossed a border this step; caller routes them onward. */
  takeEmigrants(): Emigrant[] {
    if (this.emigrants.length === 0) return this.emigrants;
    const out = this.emigrants;
    this.emigrants = [];
    return out;
  }

  /** Accept a creature arriving from a neighbouring region. */
  receiveMigrant(e: Emigrant): void {
    const c = e.creature;
    c.migrated = false;
    // Entering from the side opposite to its travel direction.
    c.x = e.direction === 1 ? 0.5 : this.size - 0.5;
    c.y = clamp(c.y, 0, this.size);
    this.creatures.push(c);
  }

  private randomPoint(): Food {
    return { x: this.rng() * this.size, y: this.rng() * this.size, dead: false };
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
    // Compact food eaten last step and regrow; new food is inserted into the
    // grid as it spawns, with an occasional rebuild to purge dead references.
    this.food = this.food.filter((f) => !f.dead);
    this.growFood(dt);
    if (--this.foodPurgeCountdown <= 0) {
      this.foodGrid.rebuild(this.food);
      this.foodPurgeCountdown = 64;
    }
    if (this.creatures.length > GRID_MIN_ITEMS) this.creatureGrid.rebuild(this.creatures);

    const list = this.creatures;
    const newborns: Creature[] = [];

    for (const c of list) {
      if (c.dead) continue;

      this.senseAndSteer(c, dt);
      this.move(c, dt);
      if (c.migrated) continue; // left for a neighbouring region

      const g = c.genome;
      const pred = isPredator(g);
      const moveCost =
        MOVE_COST * g.size * g.size * g.speed * g.speed *
        (pred ? PREDATOR_MOVE_DISCOUNT : 1);
      const cold = Math.max(0, COLD_THRESHOLD - this.temperature);
      const heat = Math.max(0, this.temperature - HEAT_THRESHOLD);
      const climateStress =
        (COLD_STRESS * cold) / g.size + HEAT_STRESS * heat * g.size;
      const cost =
        BASE_METABOLISM +
        moveCost +
        climateStress +
        ARMOR_COST * g.armor * g.size +
        SENSE_COST * g.sense * g.sense +
        (pred ? PREDATOR_UPKEEP : 0);
      c.energy -= cost * dt;
      if (c.energy < 0) c.energy = 0;
      c.age += dt;
      if (c.matingCd > 0) c.matingCd -= dt;
      if (c.attackCd > 0) c.attackCd -= dt;

      this.feed(c);

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
        const mate = this.findMate(c, /*contactOnly*/ true);
        if (mate) {
          this.mate(c, mate, newborns);
        } else if (c.energy >= ASEX_ENERGY) {
          // Lonely but very well fed: costlier asexual budding keeps sparse
          // populations from dead-ending while still favouring pair mating.
          c.energy -= ASEX_COST;
          c.matingCd = REPRO_COOLDOWN;
          this.birth(mutate(c.genome, this.rng), c.generation + 1, c, CHILD_ENERGY_MAX, newborns);
        }
      }

      if (c.energy > MAX_ENERGY) c.energy = MAX_ENERGY;
    }

    const survivors: Creature[] = [];
    for (const c of list) if (!c.dead && !c.migrated) survivors.push(c);
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
  private findMate(c: Creature, contactOnly: boolean): Creature | null {
    const range = contactOnly
      ? c.genome.size + MATE_CONTACT_BONUS
      : c.genome.sense;
    // Contact reach depends on the partner's size; pad the cell query by the
    // largest possible body.
    const query = contactOnly ? range + GENE_BOUNDS.size[1] : range;
    let best: Creature | null = null;
    let bestD2 = Infinity;
    for (const o of this.candidatesNear(c.x, c.y, query)) {
      if (o === c || o.migrated || !this.readyToMate(o) || !this.compatible(c, o)) continue;
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
    // r/K trade-off: fecund pairs bear more young, but the birth pool is
    // fixed, so each child starts weaker.
    const fecundity = (a.genome.fecundity + b.genome.fecundity) / 2;
    let litter = 1;
    if (this.rng() < fecundity * 0.9) litter++;
    if (this.rng() < fecundity * 0.55) litter++;
    if (litter > MAX_LITTER) litter = MAX_LITTER;
    const childEnergy = clamp(
      (BIRTH_POOL / litter) * 0.62,
      CHILD_ENERGY_MIN,
      CHILD_ENERGY_MAX,
    );
    for (let i = 0; i < litter; i++) {
      this.birth(crossover(a.genome, b.genome, this.rng), gen, a, childEnergy, newborns);
    }
  }

  private birth(
    genome: Genome,
    gen: number,
    near: Creature,
    energy: number,
    newborns: Creature[],
  ): void {
    if (gen > this.generation) this.generation = gen;
    this.births++;
    newborns.push(
      this.spawn(
        genome,
        gen,
        energy,
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
      if (expected >= 1 || this.rng() < expected) {
        const f = this.randomPoint();
        this.food.push(f);
        this.foodGrid.insert(f);
      }
      expected -= 1;
    }
  }

  /** Pack hunting: hunting with packmates lets a predator attempt bigger prey. */
  private maxPreySize(c: Creature, packmates: number): number {
    return (
      c.genome.size *
      PREY_MAX_RATIO *
      (1 + PACK_PREY_RATIO * c.genome.social * Math.min(3, packmates))
    );
  }

  private nearestPrey(c: Creature): Creature | null {
    const senseR2 = c.genome.sense * c.genome.sense;
    // Hunters pick targets they can realistically run down; anything faster
    // than their sprint is not worth chasing.
    const maxPreySpeed = effectiveSpeed(c.genome) * PREDATOR_SPRINT;
    const pack = this.groupmates(c, c.x, c.y, PACK_RADIUS);
    const sizeLimit = this.maxPreySize(c, pack);
    let best: Creature | null = null;
    let bestD2 = senseR2;
    for (const o of this.candidatesNear(c.x, c.y, c.genome.sense)) {
      if (o === c || o.dead || o.migrated || isPredator(o.genome)) continue;
      if (o.genome.size > sizeLimit) continue;
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

  private nearestPredator(c: Creature): Creature | null {
    const senseR2 = c.genome.sense * c.genome.sense;
    let best: Creature | null = null;
    let bestD2 = senseR2;
    for (const o of this.candidatesNear(c.x, c.y, c.genome.sense)) {
      if (o === c || o.dead || o.migrated || !isPredator(o.genome)) continue;
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

  private nearestFood(c: Creature): Food | null {
    const senseR2 = c.genome.sense * c.genome.sense;
    let best: Food | null = null;
    let bestD2 = senseR2;
    for (const f of this.foodNear(c.x, c.y, c.genome.sense)) {
      if (f.dead) continue;
      const dx = f.x - c.x;
      const dy = f.y - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = f;
      }
    }
    return best;
  }

  /** Grid pruning pays only for crowded arenas and queries much smaller than
   * the arena; otherwise a plain scan of the backing array is faster. */
  private gridWorthIt(count: number, radius: number): boolean {
    return count > GRID_MIN_ITEMS && (radius + GRID_SLACK) * 2 < this.size * 0.55;
  }

  /** Candidate creatures near a point: grid-pruned only when it pays off. */
  private candidatesNear(x: number, y: number, radius: number): readonly Creature[] {
    return this.gridWorthIt(this.creatures.length, radius)
      ? this.creatureGrid.near(x, y, radius)
      : this.creatures;
  }

  /** Candidate food near a point: grid-pruned only when it pays off. */
  private foodNear(x: number, y: number, radius: number): readonly Food[] {
    return this.gridWorthIt(this.food.length, radius)
      ? this.foodGrid.near(x, y, radius)
      : this.food;
  }

  /** Same-species neighbours of the same trophic type within `radius` of (x, y). */
  private groupmates(c: Creature, x: number, y: number, radius: number): number {
    const pred = isPredator(c.genome);
    const r2 = radius * radius;
    let n = 0;
    for (const o of this.candidatesNear(x, y, radius)) {
      if (o === c || o.dead || o.migrated) continue;
      if (o.speciesId !== c.speciesId || isPredator(o.genome) !== pred) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy <= r2) n++;
    }
    return n;
  }

  /** Nudge heading toward the local centroid of same-species groupmates. */
  private steerCohesion(c: Creature, dt: number): void {
    if (c.genome.social < 0.15) return;
    const pred = isPredator(c.genome);
    const r2 = c.genome.sense * c.genome.sense;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const o of this.candidatesNear(c.x, c.y, c.genome.sense)) {
      if (o === c || o.dead || o.migrated) continue;
      if (o.speciesId !== c.speciesId || isPredator(o.genome) !== pred) continue;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      if (dx * dx + dy * dy <= r2) {
        sx += o.x;
        sy += o.y;
        n++;
      }
    }
    if (n === 0) return;
    const target = Math.atan2(sy / n - c.y, sx / n - c.x);
    let diff = target - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = COHESION_TURN * c.genome.social * dt;
    c.heading += clamp(diff, -maxTurn, maxTurn);
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

  private senseAndSteer(c: Creature, dt: number): void {
    if (isPredator(c.genome)) {
      // Well-fed adults court; hungry ones hunt.
      if (this.readyToMate(c)) {
        const partner = this.findMate(c, false);
        if (partner) {
          this.steerToward(c, partner.x, partner.y, dt);
          return;
        }
      }
      const prey = this.nearestPrey(c);
      if (prey) {
        this.steerToward(c, prey.x, prey.y, dt);
        return;
      }
      // No target: social hunters regroup with the pack.
      this.steerCohesion(c, dt);
    } else {
      const threat = this.nearestPredator(c);
      if (threat) {
        this.steerAway(c, threat.x, threat.y, dt);
        return;
      }
      if (this.readyToMate(c)) {
        const partner = this.findMate(c, false);
        if (partner) {
          this.steerToward(c, partner.x, partner.y, dt);
          return;
        }
      }
      const f = this.nearestFood(c);
      if (f) {
        this.steerToward(c, f.x, f.y, dt);
        // Grazers drift toward the herd even while feeding.
        this.steerCohesion(c, dt);
        return;
      }
      this.steerCohesion(c, dt);
    }
    c.heading += (this.rng() - 0.5) * TURN_JITTER * dt;
  }

  private move(c: Creature, dt: number): void {
    const sprint = isPredator(c.genome) ? PREDATOR_SPRINT : 1;
    const v = effectiveSpeed(c.genome) * MOVE_SPEED * sprint;
    c.x += Math.cos(c.heading) * v * dt;
    c.y += Math.sin(c.heading) * v * dt;

    // Left/right edges border the neighbouring regions: crossing sometimes
    // succeeds (and costs energy), otherwise the border turns the creature back.
    if (c.x < 0 || c.x > this.size) {
      const direction: -1 | 1 = c.x < 0 ? -1 : 1;
      if (this.rng() < MIGRATION_CHANCE && c.energy > MIGRATION_COST) {
        c.energy -= MIGRATION_COST;
        c.migrated = true;
        c.x = clamp(c.x, 0, this.size);
        this.emigrants.push({ creature: c, direction });
        return;
      }
      c.x = direction === -1 ? -c.x : 2 * this.size - c.x;
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
  private feed(c: Creature): void {
    const diet = c.genome.diet;

    // Herbivory: consume nearby plants (efficiency falls as diet -> carnivore).
    const plantGain = PLANT_ENERGY * (1 - diet);
    if (plantGain > 0.001 && c.energy < MAX_ENERGY) {
      const reach = c.genome.size + FOOD_RADIUS;
      const reach2 = reach * reach;
      for (const f of this.foodNear(c.x, c.y, reach)) {
        if (f.dead) continue;
        const dx = f.x - c.x;
        const dy = f.y - c.y;
        if (dx * dx + dy * dy <= reach2) {
          c.energy += plantGain;
          f.dead = true;
          if (c.energy >= MAX_ENERGY) return;
        }
      }
    }

    // Carnivory: strike the nearest catchable prey in contact. Success depends
    // on the size ratio — big predators bring down big prey, while relatively
    // big prey usually win the struggle, escape, and can injure the attacker.
    if (diet > 0.05 && c.attackCd <= 0) {
      const pack = this.groupmates(c, c.x, c.y, PACK_RADIUS);
      const sizeLimit = this.maxPreySize(c, pack);
      const query = c.genome.size + sizeLimit + CATCH_REACH;
      let prey: Creature | null = null;
      let bestD2 = Infinity;
      for (const o of this.candidatesNear(c.x, c.y, query)) {
        if (o === c || o.dead || o.migrated || isPredator(o.genome)) continue;
        if (o.genome.size > sizeLimit) continue;
        const dx = o.x - c.x;
        const dy = o.y - c.y;
        const contact = c.genome.size + o.genome.size + CATCH_REACH;
        const d2 = dx * dx + dy * dy;
        if (d2 <= contact * contact && d2 < bestD2) {
          bestD2 = d2;
          prey = o;
        }
      }
      if (prey) {
        c.attackCd = ATTACK_COOLDOWN;
        c.energy -= ATTACK_COST;
        if (c.energy < 0) c.energy = 0;
        const ratio = c.genome.size / (prey.genome.size * 1.15);
        let chance = clamp(
          CATCH_BASE_CHANCE * Math.pow(ratio, 2.5),
          CATCH_MIN_CHANCE,
          CATCH_MAX_CHANCE,
        );
        // Plating blocks; herds confuse; packs overwhelm.
        chance *= 1 - ARMOR_DEFENSE * prey.genome.armor;
        const herd = this.groupmates(prey, prey.x, prey.y, HERD_RADIUS);
        chance *= 1 - Math.min(0.4, HERD_DEFENSE * prey.genome.social * herd);
        chance *= 1 + PACK_BONUS * c.genome.social * Math.min(4, pack);
        chance = clamp(chance, 0.02, 0.97);

        if (this.rng() < chance) {
          const raw = Math.min(
            MEAT_ENERGY_CAP,
            MEAT_ENERGY_K * prey.genome.size + 0.5 * prey.energy,
          );
          prey.dead = true;
          prey.energy = 0;
          this.deaths++;
          if (pack > 0 && c.genome.social > 0.2) {
            // Pack kill: the striker feeds first, packmates share the rest.
            c.energy += raw * (1 - KILL_SHARE) * diet;
            const share = (raw * KILL_SHARE) / pack;
            const pr2 = PACK_RADIUS * PACK_RADIUS;
            for (const o of this.candidatesNear(c.x, c.y, PACK_RADIUS)) {
              if (o === c || o.dead || o.migrated) continue;
              if (o.speciesId !== c.speciesId || !isPredator(o.genome)) continue;
              const dx = o.x - c.x;
              const dy = o.y - c.y;
              if (dx * dx + dy * dy <= pr2) {
                o.energy = Math.min(MAX_ENERGY, o.energy + share * o.genome.diet);
              }
            }
          } else {
            c.energy += raw * diet;
          }
        } else {
          // The prey fights free: big and armored prey punish the attacker.
          c.health -=
            STRUGGLE_INJURY *
            (prey.genome.size / c.genome.size) *
            (1 + ARMOR_SPIKE * prey.genome.armor);
          prey.heading = Math.atan2(prey.y - c.y, prey.x - c.x);
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
        armor: c.genome.armor,
        social: c.genome.social,
        fecundity: c.genome.fecundity,
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
        speciesCount: 0,
        generation: this.generation,
        meanSize: 0,
        meanSpeed: 0,
        meanSense: 0,
        meanHealth: 0,
        meanArmor: 0,
        meanSocial: 0,
        meanFecundity: 0,
        carnivoreFraction: 0,
        births: this.births,
        deaths: this.deaths,
      };
    }
    let s = 0;
    let sp = 0;
    let se = 0;
    let hp = 0;
    let ar = 0;
    let so = 0;
    let fe = 0;
    let carn = 0;
    const speciesSeen = new Set<number>();
    for (const c of this.creatures) {
      s += c.genome.size;
      sp += c.genome.speed;
      se += c.genome.sense;
      hp += c.health;
      ar += c.genome.armor;
      so += c.genome.social;
      fe += c.genome.fecundity;
      speciesSeen.add(c.speciesId);
      if (isPredator(c.genome)) carn++;
    }
    return {
      population: n,
      speciesCount: speciesSeen.size,
      generation: this.generation,
      meanSize: s / n,
      meanSpeed: sp / n,
      meanSense: se / n,
      meanHealth: hp / n,
      meanArmor: ar / n,
      meanSocial: so / n,
      meanFecundity: fe / n,
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
