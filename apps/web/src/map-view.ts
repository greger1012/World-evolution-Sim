import type {
  ArenaStats,
  CreatureView,
  ReadonlySimulationView,
  SpeciesRecord,
  TerrainId,
  WorldMapData,
} from "@evo-world-sim/core";
import { chunkTileBounds, MAP_CHUNK_COUNT, summarizeChunk } from "@evo-world-sim/core";
import { drawEvolvedCreature, drawSocialLinks } from "./creature-render.js";
import type { DramaFxLayer } from "./drama-fx.js";

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
  lake: "#2a6a9e",
};

/** Tile size on screen (px) at which creatures/food are drawn on the map. */
export const DETAIL_TILE_PX = 5.5;
/** Medium zoom: animated life specks on chunks with population. */
export const LIFE_TILE_PX = 1.2;
export const MIN_MAP_ZOOM = 0.35;
export const MAX_MAP_ZOOM = 36;

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

export function chunkAtScreen(
  map: WorldMapData,
  camera: MapCamera,
  sx: number,
  sy: number,
): number | null {
  const tile = mapTileAtScreen(map, camera, sx, sy);
  if (!tile) return null;
  const chunkId = map.tiles[tile.ty * map.width + tile.tx]!.chunkId;
  return chunkId >= 0 ? chunkId : null;
}

/** Map arena coordinates for a chunk into tile-space world coords. */
export function arenaToWorld(
  map: WorldMapData,
  chunkId: number,
  arenaSize: number,
  ax: number,
  ay: number,
): { wx: number; wy: number } {
  const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
  const cw = x1 - x0;
  const ch = y1 - y0;
  return {
    wx: x0 + (ax / arenaSize) * cw,
    wy: y0 + (ay / arenaSize) * ch,
  };
}

/** Screen click → arena coords for the given chunk (null if off-chunk). */
export function screenToArena(
  map: WorldMapData,
  camera: MapCamera,
  chunkId: number,
  arenaSize: number,
  sx: number,
  sy: number,
): { x: number; y: number } | null {
  const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
  const wx = (sx - camera.panX) / camera.zoom;
  const wy = (sy - camera.panY) / camera.zoom;
  if (wx < x0 || wy < y0 || wx >= x1 || wy >= y1) return null;
  const cw = x1 - x0;
  const ch = y1 - y0;
  return {
    x: ((wx - x0) / cw) * arenaSize,
    y: ((wy - y0) / ch) * arenaSize,
  };
}

/** Center the camera on a chunk at detail zoom. */
export function zoomCameraToChunk(
  map: WorldMapData,
  camera: MapCamera,
  chunkId: number,
  viewW: number,
  viewH: number,
): MapCamera {
  const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const fitZoom = Math.min((viewW * 0.88) / cw, (viewH * 0.82) / ch);
  const zoom = Math.min(MAX_MAP_ZOOM, Math.max(DETAIL_TILE_PX + 1.5, fitZoom));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return {
    zoom,
    panX: viewW / 2 - cx * zoom,
    panY: viewH / 2 - cy * zoom,
  };
}

/** Pan so a map-tile-space point sits at the view centre. */
export function centerCameraOnWorldPoint(
  camera: MapCamera,
  wx: number,
  wy: number,
  viewW: number,
  viewH: number,
): MapCamera {
  return {
    ...camera,
    panX: viewW / 2 - wx * camera.zoom,
    panY: viewH / 2 - wy * camera.zoom,
  };
}

/** Chunks whose tile bounds overlap a map-tile viewport rectangle. */
export function visibleChunkIds(
  map: WorldMapData,
  visX0: number,
  visY0: number,
  visX1: number,
  visY1: number,
): number[] {
  const out: number[] = [];
  for (let chunk = 0; chunk < MAP_CHUNK_COUNT; chunk++) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, chunk);
    if (x0 < visX1 && x1 > visX0 && y0 < visY1 && y1 > visY0) out.push(chunk);
  }
  return out;
}

export function drawArenaTerrain(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  scale: number,
  arenaSize: number,
  cols: number,
  rows: number,
  cells: readonly { terrain: TerrainId; richness: number }[],
): void {
  if (cols <= 0 || rows <= 0 || cells.length === 0) return;
  const tw = arenaSize / cols;
  const th = arenaSize / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row * cols + col]!;
      ctx.fillStyle = terrainColor(cell.terrain, 0.5);
      const px = ox + col * tw * scale;
      const py = oy + row * th * scale;
      const pw = Math.ceil(tw * scale);
      const ph = Math.ceil(th * scale);
      ctx.fillRect(px, py, pw, ph);
      if (cell.richness > 0.55) {
        ctx.fillStyle = `rgba(160,230,120,${(cell.richness - 0.5) * 0.25})`;
        ctx.fillRect(px, py, pw, ph);
      }
    }
  }
}

/** Map creature arena coordinates into map-tile world space. */
export function creatureToWorld(
  map: WorldMapData,
  view: ReadonlySimulationView,
  chunkId: number,
  c: { x: number; y: number },
): { wx: number; wy: number } {
  if (view.worldLayout === "fused") {
    return { wx: c.x, wy: c.y };
  }
  return arenaToWorld(map, chunkId, view.arenaSize, c.x, c.y);
}

function drawCreaturesInWorld(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  chunkId: number,
  view: ReadonlySimulationView,
  creatures: readonly CreatureView[],
  selectedId: number | null,
  tilePx: number,
): CreatureView | null {
  const unit =
    view.worldLayout === "fused"
      ? 1
      : (() => {
          const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
          return Math.min(x1 - x0, y1 - y0) / view.arenaSize;
        })();

  const toWorld = (c: CreatureView) => creatureToWorld(map, view, chunkId, c);
  drawSocialLinks(ctx, creatures, toWorld, tilePx);

  let selected: CreatureView | null = null;
  const style = { selectedId, tilePx };
  for (const c of creatures) {
    if (c.id === selectedId) selected = c;
    const { wx, wy } = toWorld(c);
    drawEvolvedCreature(ctx, wx, wy, c, unit, style);
  }

  if (selected) {
    const barW = Math.max(0.5, selected.radius * unit * 2.2);
    const { wx, wy } = toWorld(selected);
    const barX = wx - barW / 2;
    const barY = wy - selected.radius * unit - 10 / tilePx;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(barX - 0.04, barY - 0.04, barW + 0.08, 0.18);
    ctx.fillStyle = "#4fd07a";
    ctx.fillRect(barX, barY, barW * selected.health, 0.12);
  }

  return selected;
}

/** Real creature positions at medium zoom (tiny moving dots). */
function drawLifeCreatures(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  view: ReadonlySimulationView,
  chunks: readonly number[],
  tilePx: number,
): void {
  for (const chunk of chunks) {
    const layer = view.worldLayers[chunk];
    if (!layer || layer.creatures.length === 0) continue;
    const unit =
      view.worldLayout === "fused"
        ? 1
        : (() => {
            const { x0, y0, x1, y1 } = chunkTileBounds(map, chunk);
            return Math.min(x1 - x0, y1 - y0) / view.arenaSize;
          })();
    for (const c of layer.creatures) {
      const { wx, wy } = creatureToWorld(map, view, chunk, c);
      const predator = c.diet >= 0.5;
      ctx.fillStyle = predator
        ? `hsla(${c.hue}, 75%, 58%, 0.72)`
        : `hsla(${c.hue}, 65%, 52%, 0.62)`;
      const r = Math.max(0.05, Math.min(0.28, c.radius * unit * 0.55));
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFoodInWorld(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  chunkId: number,
  view: ReadonlySimulationView,
  food: readonly { x: number; y: number }[],
  tilePx: number,
): void {
  const unit =
    view.worldLayout === "fused"
      ? 1
      : (() => {
          const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
          return Math.min(x1 - x0, y1 - y0) / view.arenaSize;
        })();
  const foodR = Math.max(0.06, 0.35 * unit);

  ctx.fillStyle = "#6fcf7a";
  for (const f of food) {
    const { wx, wy } = creatureToWorld(map, view, chunkId, f);
    ctx.beginPath();
    ctx.arc(wx, wy, foodR, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type UnifiedMapDrawOptions = {
  selectedCreatureId: number | null;
  speciesById: Map<number, SpeciesRecord>;
  dramaFx?: DramaFxLayer | null;
  fxNow?: number;
};

/**
 * Phase F seamless view: one continuous zoomable world. At high zoom, creatures
 * and food from every visible chunk render in map tile space (no chunk borders).
 */
export function drawUnifiedWorldMap(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  view: ReadonlySimulationView | null,
  focusChunk: number | null,
  hoverChunk: number | null,
  opts: UnifiedMapDrawOptions,
): CreatureView | null {
  ctx.fillStyle = "#080a0d";
  ctx.fillRect(0, 0, viewW, viewH);

  const tilePx = camera.zoom;
  if (tilePx < 0.4) return;

  const detailMode = tilePx >= DETAIL_TILE_PX && view !== null;
  const lifeMode = view !== null && tilePx >= LIFE_TILE_PX && tilePx < DETAIL_TILE_PX;

  let selectedCreature: CreatureView | null = null;

  ctx.save();
  ctx.translate(camera.panX, camera.panY);
  ctx.scale(camera.zoom, camera.zoom);

  const visX0 = Math.max(0, Math.floor((0 - camera.panX) / camera.zoom));
  const visY0 = Math.max(0, Math.floor((0 - camera.panY) / camera.zoom));
  const visX1 = Math.min(map.width, Math.ceil((viewW - camera.panX) / camera.zoom));
  const visY1 = Math.min(map.height, Math.ceil((viewH - camera.panY) / camera.zoom));
  const visibleChunks = visibleChunkIds(map, visX0, visY0, visX1, visY1);

  for (let y = visY0; y < visY1; y++) {
    for (let x = visX0; x < visX1; x++) {
      const t = map.tiles[y * map.width + x]!;
      ctx.fillStyle = terrainColor(t.terrain, t.elevation);
      ctx.fillRect(x, y, 1, 1);
      if (tilePx >= 3 && t.richness > 0.55 && t.terrain !== "ocean") {
        ctx.fillStyle = `rgba(180,255,140,${(t.richness - 0.5) * 0.35})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  if (view && tilePx >= 1.2 && !detailMode) {
    for (const chunk of visibleChunks) {
      const reg = view.regions[chunk];
      if (!reg || reg.events.length === 0) continue;
      const { x0, y0, x1, y1 } = chunkTileBounds(map, chunk);
      ctx.strokeStyle = "rgba(255,200,80,0.45)";
      ctx.lineWidth = 1 / camera.zoom;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    }
    if (lifeMode) {
      drawLifeCreatures(ctx, map, view, visibleChunks, tilePx);
    }
  }

  if (detailMode) {
    for (const chunk of visibleChunks) {
      const layer = view!.worldLayers[chunk];
      if (!layer) continue;
      if (layer.food.length > 0) {
        drawFoodInWorld(ctx, map, chunk, view!, layer.food, tilePx);
      }
      if (layer.creatures.length > 0) {
        const sel = drawCreaturesInWorld(
          ctx,
          map,
          chunk,
          view!,
          layer.creatures,
          opts.selectedCreatureId,
          tilePx,
        );
        if (sel) selectedCreature = sel;
      }
    }
  }

  if (hoverChunk !== null && hoverChunk !== focusChunk && tilePx < DETAIL_TILE_PX) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, hoverChunk);
    ctx.strokeStyle = "rgba(200,220,255,0.35)";
    ctx.lineWidth = 1.5 / camera.zoom;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  ctx.restore();

  if (opts.dramaFx && opts.fxNow !== undefined) {
    opts.dramaFx.draw(ctx, camera.panX, camera.panY, camera.zoom, opts.fxNow);
  }

  ctx.font = "10px system-ui,sans-serif";
  ctx.fillStyle = "#8b95a8";
  ctx.textAlign = "left";
  const legend = detailMode
    ? view?.worldLayout === "fused"
      ? "Fused world — one continuous map · pan and zoom freely"
      : "Seamless world — pan across regions · click creatures to inspect"
    : lifeMode
      ? "Life layer — real creature positions · zoom in for detail"
      : "Drag to pan · scroll to zoom · geography is the only border";
  ctx.fillText(legend, 8, viewH - 8);
  return selectedCreature;
}

export function chunkHintText(map: WorldMapData, chunkId: number, view: ReadonlySimulationView): string {
  const summary = summarizeChunk(map, chunkId);
  const reg = view.regions[chunkId];
  const eventHint =
    reg && reg.events.length > 0 ? ` · ${reg.events.map((e) => e.kind).join(", ")} active` : "";
  const pop = reg ? ` · ${reg.population} creatures` : "";
  return `Chunk ${chunkId} · ${summary.dominant} · fertility ${summary.richness.toFixed(2)}${pop}${eventHint} — click a creature to inspect`;
}

export function terrainAtCursor(map: WorldMapData, tx: number, ty: number): string {
  const t = map.tiles[ty * map.width + tx]!;
  if (t.terrain === "ocean") return "Ocean — impassable barrier";
  if (t.terrain === "mountain" || t.terrain === "snow") {
    const summary = summarizeChunk(map, t.chunkId);
    return `${t.terrain} — harsh terrain · only large, armored, or energetic creatures cross · chunk ${t.chunkId} (${summary.dominant})`;
  }
  const summary = summarizeChunk(map, t.chunkId);
  return `${t.terrain} · elev ${t.elevation.toFixed(2)} · fertility ${t.richness.toFixed(2)} · chunk ${t.chunkId} (${summary.dominant})`;
}

export function drawInspectOverlay(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  stats: ArenaStats | null,
  selected: CreatureView | null,
  speciesById: Map<number, SpeciesRecord>,
): void {
  ctx.textAlign = "left";
  ctx.font = "11px system-ui,sans-serif";

  const ox = 8;
  const oy = 8;

  if (stats) {
    ctx.fillStyle = "rgba(10,14,20,0.55)";
    ctx.fillRect(ox, oy, 262, 20);
    ctx.fillStyle = "#e8ecf4";
    const carn = (stats.carnivoreFraction * 100).toFixed(0);
    ctx.fillText(
      `pop ${stats.population} · species ${stats.speciesCount} · gen ${stats.generation} · carniv. ${carn}%`,
      ox + 6,
      oy + 14,
    );
  }

  if (!selected) {
    if (stats) {
      ctx.fillStyle = "#8b95a8";
      ctx.fillText("Click a creature to inspect its stats", ox + 6, oy + 36);
    }
    return;
  }

  const dietLabel =
    selected.diet >= 0.66 ? "Carnivore" : selected.diet >= 0.34 ? "Omnivore" : "Herbivore";
  const mating = !selected.mature
    ? "juvenile"
    : selected.readyToMate
      ? "seeking mate"
      : "recovering";
  const speciesName = speciesById.get(selected.speciesId)?.name ?? "…";
  const socialLabel =
    selected.diet >= 0.5
      ? `${selected.social.toFixed(2)}${selected.social > 0.4 ? " (pack hunter)" : ""}`
      : `${selected.social.toFixed(2)}${selected.social > 0.4 ? " (herding)" : ""}`;
  const rows = [
    ["species", speciesName],
    ["diet", `${dietLabel} (${selected.diet.toFixed(2)})`],
    ["health", selected.health.toFixed(2)],
    ...(selected.infection > 0.05
      ? [["infection", selected.infection.toFixed(2)] as [string, string]]
      : []),
    ["energy", selected.energy.toFixed(2)],
    ["size", selected.radius.toFixed(2)],
    ["speed", `${selected.speed.toFixed(2)} (eff ${selected.effSpeed.toFixed(2)})`],
    ["sense", selected.sense.toFixed(2)],
    ["armor", selected.armor.toFixed(2)],
    ["social", socialLabel],
    ["litter", selected.fecundity < 0.33 ? "small (K)" : selected.fecundity > 0.66 ? "large (r)" : "medium"],
    ["age", `${selected.age.toFixed(1)} / 55`],
    ["gen", String(selected.generation)],
    ["mating", mating],
  ];

  const boxX = ox;
  const boxY = oy + (stats ? 26 : 0);
  const boxW = 176;
  const boxH = 26 + rows.length * 15;
  ctx.fillStyle = "rgba(8,12,18,0.78)";
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeStyle = "rgba(150,180,220,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = `hsl(${selected.hue} 70% 55%)`;
  ctx.beginPath();
  ctx.arc(boxX + 12, boxY + 14, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8ecf4";
  ctx.font = "600 11px system-ui,sans-serif";
  ctx.fillText(`Creature #${selected.id}`, boxX + 24, boxY + 18);

  ctx.font = "11px system-ui,sans-serif";
  let y = boxY + 36;
  for (const [k, v] of rows) {
    ctx.fillStyle = "#8b95a8";
    ctx.fillText(k!, boxX + 12, y);
    ctx.fillStyle = "#dbe3ef";
    ctx.fillText(v!, boxX + 74, y);
    y += 15;
  }
}
