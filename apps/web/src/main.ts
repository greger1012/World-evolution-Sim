import "./style.css";
import { generateWorldMap, speedPresets } from "@evo-world-sim/core";
import type {
  HistorySample,
  ReadonlySimulationView,
  SavedWorld,
  SpeciesRecord,
  WorldMapData,
} from "@evo-world-sim/core";
import {
  chunkHintText,
  chunkAtScreen,
  defaultMapCamera,
  DETAIL_TILE_PX,
  drawInspectOverlay,
  drawUnifiedWorldMap,
  mapTileAtScreen,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  screenToArena,
  terrainAtCursor,
  zoomCameraToChunk,
  type MapCamera,
} from "./map-view.js";
import type { MainToWorker, WorkerToMain } from "./protocol.js";

const SAVE_KEY = "evo-world-sim-save-v1";

const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
  type: "module",
});

function send(msg: MainToWorker): void {
  worker.postMessage(msg);
}

let view: ReadonlySimulationView | null = null;
let speciesList: SpeciesRecord[] = [];
let speciesById = new Map<number, SpeciesRecord>();
let historySamples: HistorySample[] = [];

worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
  const msg = e.data;
  switch (msg.type) {
    case "frame":
      view = msg.view;
      break;
    case "meta":
      speciesList = msg.species;
      speciesById = new Map(msg.species.map((s) => [s.id, s]));
      historySamples = msg.history;
      break;
    case "saved":
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(msg.data));
        if (msg.reason === "manual") flashButton(saveBtn, "Saved ✓");
      } catch {
        if (msg.reason === "manual") flashButton(saveBtn, "Save failed");
      }
      break;
    case "loadFailed":
      localStorage.removeItem(SAVE_KEY);
      break;
  }
};

function loadSavedWorld(): SavedWorld | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SavedWorld) : null;
  } catch {
    return null;
  }
}

const savedOnLoad = loadSavedWorld();
const worldSeed = savedOnLoad?.seed ?? 1337;
let worldMap: WorldMapData = generateWorldMap(worldSeed);

send({ type: "init", seed: worldSeed, saved: savedOnLoad });
setInterval(() => send({ type: "save", reason: "auto" }), 30_000);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header>
    <h1>Evo world sim</h1>
    <div class="stats" id="stats"></div>
    <div class="controls">
      <label>Speed
        <select id="speed"></select>
      </label>
      <button type="button" id="pause">Pause</button>
      <button type="button" id="overview" class="active" disabled>World view</button>
      <button type="button" id="save" title="Save this world in the browser">Save</button>
      <button type="button" id="new" title="Start a fresh world">New world</button>
    </div>
  </header>
  <main>
    <section class="panel panel-hero">
      <header><h2>World</h2></header>
      <p class="hint" id="map-hint">Pan and zoom the map — click land to zoom in and watch evolution.</p>
      <div class="canvas-wrap canvas-wrap-hero">
        <canvas id="world-canvas" width="800" height="520" aria-label="Unified world map"></canvas>
      </div>
    </section>
    <section class="panel">
      <header><h2>Population history</h2></header>
      <p class="hint">World population over time, coloured by species.</p>
      <div class="canvas-wrap">
        <canvas id="history-canvas" width="600" height="300" aria-label="Population history"></canvas>
      </div>
    </section>
    <section class="panel">
      <header><h2>Phylogeny</h2></header>
      <p class="hint">Species lifespans and descent; bars end at extinction.</p>
      <div class="canvas-wrap">
        <canvas id="phylo-canvas" width="600" height="300" aria-label="Phylogeny"></canvas>
      </div>
    </section>
  </main>
`;

const statsEl = document.querySelector<HTMLDivElement>("#stats")!;
const speedSel = document.querySelector<HTMLSelectElement>("#speed")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause")!;
const overviewBtn = document.querySelector<HTMLButtonElement>("#overview")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;
const newBtn = document.querySelector<HTMLButtonElement>("#new")!;
const mapHint = document.querySelector<HTMLParagraphElement>("#map-hint")!;
const worldCanvas = document.querySelector<HTMLCanvasElement>("#world-canvas")!;
const historyCanvas = document.querySelector<HTMLCanvasElement>("#history-canvas")!;
const phyloCanvas = document.querySelector<HTMLCanvasElement>("#phylo-canvas")!;

for (const s of speedPresets) {
  const opt = document.createElement("option");
  opt.value = String(s);
  opt.textContent = `${s}×`;
  speedSel.appendChild(opt);
}
speedSel.value = "1";

let selectedCreatureId: number | null = null;

function flashButton(btn: HTMLButtonElement, text: string): void {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

speedSel.addEventListener("change", () => {
  send({ type: "setSpeed", value: Number(speedSel.value) });
});

pauseBtn.addEventListener("click", () => {
  send({ type: "setPaused", value: !(view?.time.paused ?? false) });
});

overviewBtn.addEventListener("click", () => {
  selectedCreatureId = null;
  resetMapCamera();
  send({ type: "setActiveRegion", value: null });
  mapHint.textContent = "Pan and zoom the map — click land to zoom in and watch evolution.";
});

saveBtn.addEventListener("click", () => {
  send({ type: "save", reason: "manual" });
});

newBtn.addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY);
  selectedCreatureId = null;
  const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  worldMap = generateWorldMap(seed);
  resetMapCamera();
  send({ type: "newWorld", seed });
  flashButton(newBtn, "New world ✓");
});

function resizeCanvas(canvas: HTMLCanvasElement, wrap: HTMLElement): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(wrap.clientWidth));
  const h = Math.max(1, Math.floor(wrap.clientHeight));
  const nextW = Math.floor(w * dpr);
  const nextH = Math.floor(h * dpr);
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const observedCanvases: [HTMLCanvasElement, HTMLElement][] = [
  [worldCanvas, worldCanvas.parentElement!],
  [historyCanvas, historyCanvas.parentElement!],
  [phyloCanvas, phyloCanvas.parentElement!],
];
const ro = new ResizeObserver(() => {
  for (const [canvas, wrap] of observedCanvases) resizeCanvas(canvas, wrap);
});
for (const [, wrap] of observedCanvases) ro.observe(wrap);

function logicalCanvasSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

let mapCamera: MapCamera = { panX: 0, panY: 0, zoom: 1 };
let hoverChunk: number | null = null;
let mapDragging = false;
let mapDragLastX = 0;
let mapDragLastY = 0;
let dragMoved = false;

function resetMapCamera(): void {
  const { w, h } = logicalCanvasSize(worldCanvas);
  mapCamera = defaultMapCamera(worldMap, w, h);
}

function isDetailZoom(): boolean {
  return mapCamera.zoom >= DETAIL_TILE_PX;
}

function syncActiveRegionFromCamera(): void {
  const { w, h } = logicalCanvasSize(worldCanvas);
  if (!isDetailZoom()) {
    if (view?.activeRegionId !== null) {
      send({ type: "setActiveRegion", value: null });
    }
    return;
  }
  const chunkId = chunkAtScreen(worldMap, mapCamera, w / 2, h / 2);
  if (chunkId === null) return;
  if (view?.activeRegionId !== chunkId) {
    send({ type: "setActiveRegion", value: chunkId });
    selectedCreatureId = null;
  }
}

function drawWorld(v: ReadonlySimulationView | null): void {
  const ctx = worldCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(worldCanvas);
  const activeChunk = v?.activeRegionId ?? null;
  const selected = drawUnifiedWorldMap(
    ctx,
    worldMap,
    mapCamera,
    w,
    h,
    v,
    activeChunk,
    hoverChunk,
    { selectedCreatureId, speciesById },
  );

  if (isDetailZoom() && v?.activeStats) {
    drawInspectOverlay(ctx, w, v.activeStats, selected, speciesById);
  }
}

worldCanvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const rect = worldCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const before = mapTileAtScreen(worldMap, mapCamera, sx, sy);
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  mapCamera.zoom = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, mapCamera.zoom * factor));
  if (before) {
    mapCamera.panX = sx - before.tx * mapCamera.zoom;
    mapCamera.panY = sy - before.ty * mapCamera.zoom;
  }
  syncActiveRegionFromCamera();
});

worldCanvas.addEventListener("mousedown", (e) => {
  mapDragging = true;
  dragMoved = false;
  mapDragLastX = e.clientX;
  mapDragLastY = e.clientY;
});

window.addEventListener("mouseup", () => {
  if (mapDragging) syncActiveRegionFromCamera();
  mapDragging = false;
});

worldCanvas.addEventListener("mousemove", (e) => {
  const rect = worldCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  if (mapDragging) {
    mapCamera.panX += e.clientX - mapDragLastX;
    mapCamera.panY += e.clientY - mapDragLastY;
    mapDragLastX = e.clientX;
    mapDragLastY = e.clientY;
    dragMoved = true;
    return;
  }
  const tile = mapTileAtScreen(worldMap, mapCamera, sx, sy);
  if (!tile) {
    hoverChunk = null;
    if (!isDetailZoom()) {
      mapHint.textContent = "Pan and zoom the map — click land to zoom in and watch evolution.";
    }
    return;
  }
  const t = worldMap.tiles[tile.ty * worldMap.width + tile.tx]!;
  hoverChunk = t.chunkId >= 0 ? t.chunkId : null;
  if (isDetailZoom() && view && view.activeRegionId !== null) {
    mapHint.textContent = chunkHintText(worldMap, view.activeRegionId, view);
  } else {
    mapHint.textContent = terrainAtCursor(worldMap, tile.tx, tile.ty);
  }
});

worldCanvas.addEventListener("click", (e) => {
  if (!view || dragMoved) return;
  const rect = worldCanvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (isDetailZoom() && view.activeRegionId !== null && view.activeCreatures) {
    const arena = screenToArena(worldMap, mapCamera, view.activeRegionId, view.arenaSize, sx, sy);
    if (!arena) return;
    let picked: number | null = null;
    let bestD = Infinity;
    for (const c of view.activeCreatures) {
      const d = Math.hypot(arena.x - c.x, arena.y - c.y);
      const reach = c.radius + 0.8;
      if (d <= reach && d < bestD) {
        bestD = d;
        picked = c.id;
      }
    }
    selectedCreatureId = picked;
    return;
  }

  const chunkId = chunkAtScreen(worldMap, mapCamera, sx, sy);
  if (chunkId === null) return;
  const { w, h } = logicalCanvasSize(worldCanvas);
  mapCamera = zoomCameraToChunk(worldMap, mapCamera, chunkId, w, h);
  send({ type: "setActiveRegion", value: chunkId });
  selectedCreatureId = null;
  mapHint.textContent = chunkHintText(worldMap, chunkId, view);
});

setTimeout(resetMapCamera, 0);

function speciesColor(hue: number, alive: boolean): string {
  return `hsl(${hue} 70% ${alive ? 58 : 38}%)`;
}

function drawHistory(): void {
  const ctx = historyCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(historyCanvas);
  ctx.clearRect(0, 0, w, h);

  const samples = historySamples;
  if (samples.length < 2) {
    ctx.fillStyle = "#2a3140";
    ctx.font = "12px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Gathering history…", w / 2, h / 2);
    return;
  }

  const top = speciesList
    .filter((s) => s.extinctAt === null && s.population > 0)
    .sort((a, b) => b.population - a.population)
    .slice(0, 7);

  const legendH = 20;
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const chartH = h - legendH - padT - 14;
  const t0 = samples[0]!.t;
  const t1 = samples[samples.length - 1]!.t;
  const tSpan = Math.max(1e-6, t1 - t0);
  let maxPop = 10;
  for (const s of samples) maxPop = Math.max(maxPop, s.totalPopulation);

  const x = (t: number) => padL + ((t - t0) / tSpan) * (w - padL - padR);
  const y = (p: number) => padT + chartH - (p / maxPop) * chartH;

  ctx.strokeStyle = "#242c3a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + chartH);
  ctx.lineTo(w - padR, padT + chartH);
  ctx.stroke();
  ctx.fillStyle = "#5d6a80";
  ctx.font = "9px system-ui,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(maxPop), padL - 4, padT + 8);
  ctx.fillText("0", padL - 4, padT + chartH);

  ctx.strokeStyle = "#4a5568";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const px = x(s.t);
    const py = y(s.totalPopulation);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  for (const sp of top) {
    ctx.strokeStyle = speciesColor(sp.hue, true);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const s of samples) {
      let pop = 0;
      for (const [id, p] of s.populations) {
        if (id === sp.id) {
          pop = p;
          break;
        }
      }
      const px = x(s.t);
      const py = y(pop);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  ctx.font = "10px system-ui,sans-serif";
  ctx.textAlign = "left";
  let lx = padL;
  const ly = h - 7;
  for (const sp of top) {
    ctx.fillStyle = speciesColor(sp.hue, true);
    ctx.beginPath();
    ctx.arc(lx + 3, ly - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    const label = `${sp.name} ${sp.population}`;
    ctx.fillStyle = "#a7b2c4";
    ctx.fillText(label, lx + 9, ly);
    lx += 18 + ctx.measureText(label).width;
    if (lx > w - 60) break;
  }
}

function drawPhylo(v: ReadonlySimulationView): void {
  const ctx = phyloCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(phyloCanvas);
  ctx.clearRect(0, 0, w, h);

  const now = Math.max(1e-6, v.summary.simTime);
  const all = speciesList;

  const living = all.filter((s) => s.extinctAt === null);
  const extinct = all
    .filter((s) => s.extinctAt !== null)
    .sort((a, b) => b.peakPopulation - a.peakPopulation);
  const maxRows = Math.max(4, Math.floor((h - 22) / 14));
  const kept = [...living, ...extinct]
    .slice(0, maxRows)
    .sort((a, b) => a.foundedAt - b.foundedAt);
  if (kept.length === 0) return;

  const rowOf = new Map<number, number>();
  kept.forEach((s, i) => rowOf.set(s.id, i));

  const padL = 8;
  const padR = 8;
  const x = (t: number) => padL + (t / now) * (w - padL - padR);
  const rowY = (i: number) => 10 + i * 14;

  for (const sp of kept) {
    const i = rowOf.get(sp.id)!;
    const yy = rowY(i);
    const alive = sp.extinctAt === null;
    const xStart = x(sp.foundedAt);
    const xEnd = alive ? x(now) : x(sp.extinctAt!);

    if (sp.parentId !== null && rowOf.has(sp.parentId)) {
      const py = rowY(rowOf.get(sp.parentId)!);
      ctx.strokeStyle = "rgba(139,149,168,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xStart, py);
      ctx.lineTo(xStart, yy);
      ctx.stroke();
    }

    ctx.strokeStyle = speciesColor(sp.hue, alive);
    ctx.lineWidth = alive ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(xStart, yy);
    ctx.lineTo(Math.max(xEnd, xStart + 2), yy);
    ctx.stroke();

    if (sp.trophic === "carnivore") {
      ctx.fillStyle = "#ff5a5a";
      ctx.beginPath();
      ctx.arc(xStart, yy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (xEnd - xStart > 44 || alive) {
      ctx.fillStyle = alive ? "#dbe3ef" : "#6b7788";
      ctx.font = "9px system-ui,sans-serif";
      ctx.textAlign = "left";
      const lx = Math.min(Math.max(xStart + 3, padL), w - 70);
      ctx.fillText(alive ? `${sp.name} (${sp.population})` : sp.name, lx, yy - 4);
    }
  }

  ctx.fillStyle = "#5d6a80";
  ctx.font = "9px system-ui,sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(
    `${all.length} species recorded · ${living.length} living · red dot = carnivore`,
    w - 8,
    h - 6,
  );
}

function frame(): void {
  if (view) {
    statsEl.innerHTML = `
      <span>Tick <strong>${view.summary.tick}</strong></span>
      <span>Creatures <strong>${view.summary.totalPopulation}</strong></span>
      <span>Species <strong>${view.summary.livingSpecies}</strong></span>
      <span>Diversity <strong>${view.summary.meanDiversity.toFixed(3)}</strong></span>
      <span>Speed <strong>${view.time.speedMultiplier}×</strong>${view.time.paused ? " (paused)" : ""}</span>
    `;
    pauseBtn.textContent = view.time.paused ? "Resume" : "Pause";
    const atWorldView = !isDetailZoom() && view.activeRegionId === null;
    overviewBtn.disabled = atWorldView;
    overviewBtn.classList.toggle("active", atWorldView);
    if (String(view.time.speedMultiplier) !== speedSel.value) {
      speedSel.value = String(view.time.speedMultiplier);
    }
    drawHistory();
    drawPhylo(view);
  }
  drawWorld(view);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
