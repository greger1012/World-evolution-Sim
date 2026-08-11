import type { ReadonlySimulationView, TerrainId, WorldMapData } from "@evo-world-sim/core";
import { chunkTileBounds, summarizeChunk } from "@evo-world-sim/core";

const TERRAIN_COLORS: Record<TerrainId, string> = {
  ocean: "#1a3a5c",
  coast: "#c4a574",
  plains: "#5a9e4a",
  forest: "#2d6b38",
  jungle: "#1f5c32",
  desert: "#c9a85a",
  tundra: "#9cb4c4",
  snow: "#e8eef4",
  mountain: "#6b5d52",
  swamp: "#3d5c40",
  river: "#3d8ec9",
};

export type MapCamera = {
  panX: number;
  panY: number;
  zoom: number;
};

export function terrainColor(terrain: TerrainId, elevation: number): string {
  const base = TERRAIN_COLORS[terrain];
  if (terrain === "mountain") {
    const t = Math.min(1, (elevation - 0.65) * 3);
    const g = Math.floor(93 + t * 40);
    return `rgb(${g},${g - 10},${g - 18})`;
  }
  if (terrain === "snow") return "#e8eef4";
  if (terrain === "swamp") return "#355a42";
  return base;
}

/** Fit the whole map in the view with a little margin. */
export function defaultMapCamera(map: WorldMapData, viewW: number, viewH: number): MapCamera {
  const margin = 12;
  const zoom = Math.min((viewW - margin * 2) / map.width, (viewH - margin * 2) / map.height);
  const panX = (viewW - map.width * zoom) / 2;
  const panY = (viewH - map.height * zoom) / 2;
  return { panX, panY, zoom };
}

export function mapTileAtScreen(
  map: WorldMapData,
  camera: MapCamera,
  sx: number,
  sy: number,
): { tx: number; ty: number } | null {
  const tx = Math.floor((sx - camera.panX) / camera.zoom);
  const ty = Math.floor((sy - camera.panY) / camera.zoom);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
  return { tx, ty };
}

export function drawWorldMap(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  view: ReadonlySimulationView | null,
  activeChunk: number | null,
  hoverChunk: number | null,
): void {
  ctx.fillStyle = "#080a0d";
  ctx.fillRect(0, 0, viewW, viewH);

  const tilePx = camera.zoom;
  if (tilePx < 0.4) return;

  ctx.save();
  ctx.translate(camera.panX, camera.panY);
  ctx.scale(camera.zoom, camera.zoom);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x]!;
      ctx.fillStyle = terrainColor(t.terrain, t.elevation);
      ctx.fillRect(x, y, 1, 1);
      // Subtle fertility tint on zoomed-in views.
      if (tilePx >= 3 && t.richness > 0.55 && t.terrain !== "ocean") {
        ctx.fillStyle = `rgba(180,255,140,${(t.richness - 0.5) * 0.35})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Chunk grid + biomass overlay from sim (Phase A: overlay only).
  if (view && tilePx >= 1.2) {
    for (let chunk = 0; chunk < view.regions.length; chunk++) {
      const { x0, y0, x1, y1 } = chunkTileBounds(map, chunk);
      const reg = view.regions[chunk];
      if (!reg) continue;
      const biomass = reg.biomass;
      if (biomass > 0.05) {
        ctx.fillStyle = `rgba(120,220,160,${biomass * 0.22})`;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (reg.events.length > 0) {
        ctx.strokeStyle = "rgba(255,200,80,0.55)";
        ctx.lineWidth = 1 / camera.zoom;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      }
    }
  }

  if (hoverChunk !== null) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, hoverChunk);
    ctx.strokeStyle = "rgba(200,220,255,0.65)";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  if (activeChunk !== null) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, activeChunk);
    ctx.strokeStyle = "#eaf2ff";
    ctx.lineWidth = 2.5 / camera.zoom;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  ctx.restore();

  // Legend strip.
  ctx.font = "10px system-ui,sans-serif";
  ctx.fillStyle = "#8b95a8";
  ctx.textAlign = "left";
  ctx.fillText("Drag to pan · scroll to zoom · click land to open arena", 8, viewH - 8);
}

export function chunkHintText(map: WorldMapData, chunkId: number, view: ReadonlySimulationView): string {
  const summary = summarizeChunk(map, chunkId);
  const reg = view.regions[chunkId];
  const eventHint =
    reg && reg.events.length > 0 ? ` · ${reg.events.map((e) => e.kind).join(", ")} active` : "";
  const pop = reg ? ` · ${reg.population} creatures` : "";
  return `Chunk ${chunkId} · ${summary.dominant} · fertility ${summary.richness.toFixed(2)}${pop}${eventHint} — click a blob to inspect`;
}

export function terrainAtCursor(map: WorldMapData, tx: number, ty: number): string {
  const t = map.tiles[ty * map.width + tx]!;
  if (t.terrain === "ocean") return "Ocean — no regional arena";
  const summary = summarizeChunk(map, t.chunkId);
  return `${t.terrain} · elev ${t.elevation.toFixed(2)} · fertility ${t.richness.toFixed(2)} · chunk ${t.chunkId} (${summary.dominant})`;
}
