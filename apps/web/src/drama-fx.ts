import type { DramaEvent, DramaKind, ReadonlySimulationView, WorldMapData } from "@evo-world-sim/core";
import { chunkTileBounds } from "@evo-world-sim/core";
import { creatureToWorld } from "./map-view.js";

export type FxBurst = {
  id: number;
  kind: DramaKind;
  wx: number;
  wy: number;
  t0: number;
  hue?: number;
};

const FX_DURATION_MS = 1400;
const SEEN_CAP = 256;

const KIND_COLORS: Record<DramaKind, string> = {
  kill: "#ff5a5a",
  birth: "#6fcf7a",
  death: "#8b95a8",
  migration: "#5b9fd4",
  speciation: "#e8b84a",
  extinction: "#6b7788",
  drought: "#c9a85a",
  disease: "#b06cff",
  storm: "#7eb8ff",
};

/** Track new drama events and render short-lived map bursts. */
export class DramaFxLayer {
  private seenIds = new Set<number>();
  private seenOrder: number[] = [];
  private bursts: FxBurst[] = [];

  reset(): void {
    this.seenIds.clear();
    this.seenOrder = [];
    this.bursts = [];
  }

  ingest(view: ReadonlySimulationView | null, map: WorldMapData, arenaSize: number, now: number): void {
    if (!view) return;
    for (const ev of view.recentDrama) {
      if (this.seenIds.has(ev.id)) continue;
      this.markSeen(ev.id);
      const burst = this.eventToBurst(ev, map, view, now);
      if (burst) this.bursts.push(burst);
    }
    this.bursts = this.bursts.filter((b) => now - b.t0 < FX_DURATION_MS);
  }

  private markSeen(id: number): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > SEEN_CAP) {
      const old = this.seenOrder.shift();
      if (old !== undefined) this.seenIds.delete(old);
    }
  }

  private eventToBurst(
    ev: DramaEvent,
    map: WorldMapData,
    view: ReadonlySimulationView,
    now: number,
  ): FxBurst | null {
    if (ev.kind === "migration") return null;
    if (ev.regionId >= 0 && ev.ax !== undefined && ev.ay !== undefined) {
      const { wx, wy } =
        view.worldLayout === "fused"
          ? { wx: ev.ax, wy: ev.ay }
          : creatureToWorld(map, view, ev.regionId, { x: ev.ax, y: ev.ay });
      return { id: ev.id, kind: ev.kind, wx, wy, t0: now, hue: ev.hue };
    }
    if (ev.regionId >= 0) {
      const { x0, y0, x1, y1 } = chunkTileBounds(map, ev.regionId);
      return {
        id: ev.id,
        kind: ev.kind,
        wx: (x0 + x1) / 2,
        wy: (y0 + y1) / 2,
        t0: now,
        hue: ev.hue,
      };
    }
    return null;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    panX: number,
    panY: number,
    zoom: number,
    now: number,
  ): void {
    for (const b of this.bursts) {
      const age = (now - b.t0) / FX_DURATION_MS;
      if (age >= 1) continue;
      const sx = panX + b.wx * zoom;
      const sy = panY + b.wy * zoom;
      const base = KIND_COLORS[b.kind];
      const r = (8 + age * 28) / Math.max(0.5, zoom * 0.35);
      const alpha = (1 - age) * 0.85;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = b.hue !== undefined ? `hsl(${b.hue} 75% 58%)` : base;
      ctx.lineWidth = Math.max(1.5, 3 / zoom);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();

      if (b.kind === "kill" || b.kind === "storm") {
        ctx.fillStyle = b.hue !== undefined ? `hsl(${b.hue} 80% 55%)` : base;
        ctx.globalAlpha = alpha * 0.35;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === "birth" || b.kind === "speciation") {
        ctx.strokeStyle = b.hue !== undefined ? `hsl(${b.hue} 70% 62%)` : base;
        ctx.globalAlpha = alpha * 0.55;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.65, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export function dramaKindLabel(kind: DramaKind): string {
  const labels: Record<DramaKind, string> = {
    kill: "Hunt",
    birth: "Birth",
    death: "Death",
    migration: "Migration",
    speciation: "Speciation",
    extinction: "Extinction",
    drought: "Drought",
    disease: "Disease",
    storm: "Storm",
  };
  return labels[kind];
}
