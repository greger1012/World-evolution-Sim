import { isPredator, makeRng } from "./creatures.js";
import type { Creature } from "./creatures.js";
import type { SpeciesRecord } from "./types.js";

// Hue-gap clustering: members of one species whose lineage colours drift apart
// by more than this (with nothing in between) are considered reproductively
// isolated and split into separate species.
const HUE_BIN_DEG = 15;
const HUE_BINS = 360 / HUE_BIN_DEG;
const SPLIT_GAP_BINS = 3; // empty gap (>= 45 degrees) that separates clusters
/** A trophic offshoot (e.g. carnivorous mutants inside a herbivore species)
 * becomes its own species once it has at least this many members. */
const TROPHIC_SPLIT_MIN = 3;
/** Unassigned creatures join an existing compatible species within this hue
 * distance, otherwise they found a new one. */
const ADOPT_HUE_DISTANCE = 40;

const NAME_SYLLABLES = [
  "va", "ren", "tor", "mi", "lu", "ka", "dro", "bel", "sha", "qui",
  "nor", "fen", "gal", "ryn", "zu", "pel", "om", "ta", "vis", "hur",
];
const HERBIVORE_SUFFIXES = ["mus", "ella", "ix", "ara", "opsis", "ina"];
const CARNIVORE_SUFFIXES = ["rax", "don", "gor", "yx", "dax", "cera"];

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function circularMeanHue(hues: number[]): number {
  let sx = 0;
  let sy = 0;
  for (const h of hues) {
    const r = (h * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  let deg = (Math.atan2(sy, sx) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Tracks named species across the whole world. Creatures inherit their
 * parent's species tag; the registry periodically (a) adopts untagged
 * creatures, (b) splits species whose members have diverged (by trophic type
 * or by a gap in lineage colour), and (c) records extinctions. Splits keep the
 * parent link, giving a phylogeny.
 */
export class SpeciesRegistry {
  private readonly records = new Map<number, SpeciesRecord>();
  private readonly rng: () => number;
  private nextId = 1;

  constructor(seed: number) {
    this.rng = makeRng(seed ^ 0x5eeded);
  }

  /** All species ever seen (living and extinct), founding order. */
  all(): SpeciesRecord[] {
    return [...this.records.values()];
  }

  get(id: number): SpeciesRecord | undefined {
    return this.records.get(id);
  }

  livingCount(): number {
    let n = 0;
    for (const r of this.records.values()) if (r.extinctAt === null) n++;
    return n;
  }

  private makeName(trophic: "herbivore" | "carnivore"): string {
    const syl = () => NAME_SYLLABLES[Math.floor(this.rng() * NAME_SYLLABLES.length)]!;
    const suffixes = trophic === "carnivore" ? CARNIVORE_SUFFIXES : HERBIVORE_SUFFIXES;
    const suffix = suffixes[Math.floor(this.rng() * suffixes.length)]!;
    const base = syl() + (this.rng() < 0.45 ? syl() : "") + suffix;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  private found(
    hue: number,
    trophic: "herbivore" | "carnivore",
    parentId: number | null,
    simTime: number,
  ): SpeciesRecord {
    const rec: SpeciesRecord = {
      id: this.nextId++,
      name: this.makeName(trophic),
      parentId,
      hue,
      trophic,
      foundedAt: simTime,
      extinctAt: null,
      population: 0,
      peakPopulation: 0,
    };
    this.records.set(rec.id, rec);
    return rec;
  }

  /**
   * Bring the registry in sync with the world. Call periodically (sim-time
   * cadence), with every living creature from all regions.
   */
  refresh(creatures: readonly Creature[], simTime: number): void {
    this.adoptUntagged(creatures, simTime);
    this.splitDivergent(creatures, simTime);

    // Recount populations and record extinctions.
    const counts = new Map<number, { n: number; hues: number[] }>();
    for (const c of creatures) {
      let e = counts.get(c.speciesId);
      if (!e) {
        e = { n: 0, hues: [] };
        counts.set(c.speciesId, e);
      }
      e.n++;
      e.hues.push(c.genome.hue);
    }
    for (const rec of this.records.values()) {
      const e = counts.get(rec.id);
      if (e) {
        rec.population = e.n;
        rec.hue = circularMeanHue(e.hues);
        if (e.n > rec.peakPopulation) rec.peakPopulation = e.n;
        rec.extinctAt = null; // revived tags (e.g. late newborns) stay alive
      } else {
        rec.population = 0;
        if (rec.extinctAt === null) rec.extinctAt = simTime;
      }
    }
  }

  /** Assign species to creatures with no tag (initial founders, reseeds). */
  private adoptUntagged(creatures: readonly Creature[], simTime: number): void {
    for (const c of creatures) {
      if (c.speciesId >= 0) continue;
      const trophic = isPredator(c.genome) ? "carnivore" : "herbivore";
      let best: SpeciesRecord | null = null;
      let bestD = ADOPT_HUE_DISTANCE;
      for (const rec of this.records.values()) {
        if (rec.extinctAt !== null || rec.trophic !== trophic) continue;
        const d = hueDistance(rec.hue, c.genome.hue);
        if (d <= bestD) {
          bestD = d;
          best = rec;
        }
      }
      const rec = best ?? this.found(c.genome.hue, trophic, null, simTime);
      c.speciesId = rec.id;
    }
  }

  /** Split species whose members have diverged beyond breeding range. */
  private splitDivergent(creatures: readonly Creature[], simTime: number): void {
    const members = new Map<number, Creature[]>();
    for (const c of creatures) {
      const list = members.get(c.speciesId);
      if (list) list.push(c);
      else members.set(c.speciesId, [c]);
    }

    for (const [id, list] of members) {
      const rec = this.records.get(id);
      if (!rec) continue;

      // 1. Trophic offshoot: diet mutants that crossed the predator line form
      //    their own species (they can no longer breed with the parent stock).
      const majorityTrophic = rec.trophic;
      const offshoot = list.filter(
        (c) => (isPredator(c.genome) ? "carnivore" : "herbivore") !== majorityTrophic,
      );
      if (offshoot.length >= TROPHIC_SPLIT_MIN && offshoot.length < list.length) {
        const trophic = majorityTrophic === "carnivore" ? "herbivore" : "carnivore";
        const child = this.found(
          circularMeanHue(offshoot.map((c) => c.genome.hue)),
          trophic,
          id,
          simTime,
        );
        for (const c of offshoot) c.speciesId = child.id;
      }

      // 2. Colour divergence: find hue clusters separated by an empty gap.
      const remaining = list.filter((c) => c.speciesId === id);
      if (remaining.length < 4) continue;
      const bins: Creature[][] = Array.from({ length: HUE_BINS }, () => []);
      for (const c of remaining) {
        bins[Math.floor((((c.genome.hue % 360) + 360) % 360) / HUE_BIN_DEG) % HUE_BINS]!.push(c);
      }
      const clusters = this.circularClusters(bins);
      if (clusters.length <= 1) continue;
      clusters.sort((a, b) => b.length - a.length);
      // Largest cluster keeps the name; the rest are new species.
      for (let k = 1; k < clusters.length; k++) {
        const group = clusters[k]!;
        if (group.length < 3) continue; // stragglers stay with the parent
        const child = this.found(
          circularMeanHue(group.map((c) => c.genome.hue)),
          rec.trophic,
          id,
          simTime,
        );
        for (const c of group) c.speciesId = child.id;
      }
    }
  }

  /** Group occupied hue bins into clusters separated by >= SPLIT_GAP_BINS. */
  private circularClusters(bins: Creature[][]): Creature[][] {
    const occupied: number[] = [];
    for (let i = 0; i < HUE_BINS; i++) if (bins[i]!.length > 0) occupied.push(i);
    if (occupied.length === 0) return [];

    // Find the largest empty gap to anchor the scan start.
    let start = occupied[0]!;
    let maxGap = -1;
    for (let k = 0; k < occupied.length; k++) {
      const cur = occupied[k]!;
      const next = occupied[(k + 1) % occupied.length]!;
      const gap = (next - cur - 1 + HUE_BINS) % HUE_BINS;
      if (gap > maxGap) {
        maxGap = gap;
        start = next;
      }
    }
    if (maxGap < SPLIT_GAP_BINS) return [bins.flat()]; // one contiguous ring

    const clusters: Creature[][] = [];
    let current: Creature[] = [];
    let prev: number | null = null;
    for (let k = 0; k < occupied.length; k++) {
      const i = occupied[(occupied.indexOf(start) + k) % occupied.length]!;
      if (prev !== null) {
        const gap = (i - prev - 1 + HUE_BINS) % HUE_BINS;
        if (gap >= SPLIT_GAP_BINS && current.length > 0) {
          clusters.push(current);
          current = [];
        }
      }
      current.push(...bins[i]!);
      prev = i;
    }
    if (current.length > 0) clusters.push(current);
    return clusters;
  }
}
