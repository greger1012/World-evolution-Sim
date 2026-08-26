import type {
  ArenaStats,
  CreatureView,
  ReadonlySimulationView,
  SpeciesRecord,
  TerrainId,
  WorldMapData,
} from "@evo-world-sim/core";
import { chunkTileBounds, summarizeChunk } from "@evo-world-sim/core";
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

function drawCreaturesInWorld(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  chunkId: number,
  arenaSize: number,
  creatures: readonly CreatureView[],
  selectedId: number | null,
  tilePx: number,
): CreatureView | null {
  const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const unit = Math.min(cw, ch) / arenaSize;

  const toWorld = (c: CreatureView) => arenaToWorld(map, chunkId, arenaSize, c.x, c.y);
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

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = Math.max(0.06, 1.2 / tilePx);
  ctx.strokeRect(x0 + 0.02, y0 + 0.02, cw - 0.04, ch - 0.04);

  return selected;
}

/** Animated specks suggesting life at medium zoom (population-driven). */
function drawLifeSpecks(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  view: ReadonlySimulationView,
  simTime: number,
  tilePx: number,
): void {
  const t = simTime * 0.6;
  for (let chunk = 0; chunk < view.regions.length; chunk++) {
    const reg = view.regions[chunk];
    if (!reg || reg.population <= 0) continue;
    const { x0, y0, x1, y1 } = chunkTileBounds(map, chunk);
    const cw = x1 - x0;
    const ch = y1 - y0;
    const specks = Math.min(14, Math.ceil(reg.population / 4));
    const carnShare = reg.population > 0 ? reg.carnivores / reg.population : 0;
    for (let i = 0; i < specks; i++) {
      const seed = chunk * 9973 + i * 7919;
      const px = x0 + ((seed * 0.618033) % 1) * cw;
      const py = y0 + ((seed * 0.381966) % 1) * ch;
      const wobble = Math.sin(t + seed * 0.01) * 0.15;
      const sx = px + wobble;
      const sy = py + Math.cos(t * 1.1 + seed) * 0.12;
      const predator = i / specks < carnShare;
      ctx.fillStyle = predator ? "rgba(255,110,110,0.55)" : "rgba(120,220,160,0.5)";
      const r = Math.max(0.06, 0.22 / tilePx);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFoodInWorld(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  chunkId: number,
  arenaSize: number,
  food: readonly { x: number; y: number }[],
  tilePx: number,
): void {
  const { x0, y0, x1, y1 } = chunkTileBounds(map, chunkId);
  const cw = x1 - x0;
  const ch = y1 - y0;
  const unit = Math.min(cw, ch) / arenaSize;
  const foodR = Math.max(0.06, 0.35 * unit);

  ctx.fillStyle = "#6fcf7a";
  for (const f of food) {
    const { wx, wy } = arenaToWorld(map, chunkId, arenaSize, f.x, f.y);
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
 * Phase C unified view: one zoomable map. At high zoom the active chunk shows
 * food and creatures painted in map tile space (WorldBox-style).
 * Returns the selected creature ref for overlay drawing (if any).
 */
export function drawUnifiedWorldMap(
  ctx: CanvasRenderingContext2D,
  map: WorldMapData,
  camera: MapCamera,
  viewW: number,
  viewH: number,
  view: ReadonlySimulationView | null,
  activeChunk: number | null,
  hoverChunk: number | null,
  opts: UnifiedMapDrawOptions,
): CreatureView | null {
  ctx.fillStyle = "#080a0d";
  ctx.fillRect(0, 0, viewW, viewH);

  const tilePx = camera.zoom;
  if (tilePx < 0.4) return;

  const detailMode =
    tilePx >= DETAIL_TILE_PX &&
    view !== null &&
    activeChunk !== null &&
    view.activeRegionId === activeChunk &&
    view.activeCreatures !== null &&
    view.activeFood !== null;

  const lifeMode = view !== null && tilePx >= LIFE_TILE_PX && tilePx < DETAIL_TILE_PX;

  let selectedCreature: CreatureView | null = null;

  ctx.save();
  ctx.translate(camera.panX, camera.panY);
  ctx.scale(camera.zoom, camera.zoom);

  const visX0 = Math.max(0, Math.floor((0 - camera.panX) / camera.zoom));
  const visY0 = Math.max(0, Math.floor((0 - camera.panY) / camera.zoom));
  const visX1 = Math.min(map.width, Math.ceil((viewW - camera.panX) / camera.zoom));
  const visY1 = Math.min(map.height, Math.ceil((viewH - camera.panY) / camera.zoom));

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
    if (lifeMode) {
      drawLifeSpecks(ctx, map, view, view.summary.simTime, tilePx);
    }
  }

  if (detailMode && activeChunk !== null) {
    drawFoodInWorld(ctx, map, activeChunk, view!.arenaSize, view!.activeFood!, tilePx);
    selectedCreature = drawCreaturesInWorld(
      ctx,
      map,
      activeChunk,
      view!.arenaSize,
      view!.activeCreatures!,
      opts.selectedCreatureId,
      tilePx,
    );
  }

  if (hoverChunk !== null && hoverChunk !== activeChunk) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, hoverChunk);
    ctx.strokeStyle = "rgba(200,220,255,0.65)";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  }

  if (activeChunk !== null) {
    const { x0, y0, x1, y1 } = chunkTileBounds(map, activeChunk);
    ctx.strokeStyle = detailMode ? "rgba(234,242,255,0.85)" : "#eaf2ff";
    ctx.lineWidth = (detailMode ? 2 : 2.5) / camera.zoom;
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
    ? "Detail view — click creatures to inspect · Follow modes in header"
    : lifeMode
      ? "Life layer — zoom in for evolved creatures and hunts"
      : "Drag to pan · scroll to zoom · click land to zoom in";
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
  if (t.terrain === "ocean") return "Ocean — no life here";
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
