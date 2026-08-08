import "./style.css";
import { speedPresets } from "@evo-world-sim/core";
import type {
  ArenaStats,
  HistorySample,
  ReadonlySimulationView,
  SavedWorld,
  SpeciesRecord,
} from "@evo-world-sim/core";
import type { MainToWorker, WorkerToMain } from "./protocol.js";

const SAVE_KEY = "evo-world-sim-save-v1";

// ---------------------------------------------------------------------------
// Simulation worker: the sim runs off the main thread; we render snapshots.
// ---------------------------------------------------------------------------
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

send({ type: "init", seed: 1337, saved: loadSavedWorld() });

// Autosave: the world quietly persists so a refresh never loses it.
setInterval(() => send({ type: "save", reason: "auto" }), 30_000);

// ---------------------------------------------------------------------------
// UI scaffolding
// ---------------------------------------------------------------------------
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
      <button type="button" id="globe" class="active" disabled>Globe</button>
      <button type="button" id="save" title="Save this world in the browser">Save</button>
      <button type="button" id="new" title="Start a fresh world">New world</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <header><h2>Stratified globe</h2></header>
      <p class="hint">Click a region to open its living arena.</p>
      <div class="canvas-wrap">
        <canvas id="globe-canvas" width="600" height="400" aria-label="Globe regions"></canvas>
      </div>
    </section>
    <section class="panel">
      <header><h2>Regional arena</h2></header>
      <p class="hint" id="patch-hint">Globe view — select a region to watch its creatures evolve.</p>
      <div class="canvas-wrap">
        <canvas id="patch-canvas" width="600" height="400" aria-label="Regional arena"></canvas>
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
const globeBtn = document.querySelector<HTMLButtonElement>("#globe")!;
const saveBtn = document.querySelector<HTMLButtonElement>("#save")!;
const newBtn = document.querySelector<HTMLButtonElement>("#new")!;
const patchHint = document.querySelector<HTMLParagraphElement>("#patch-hint")!;
const globeCanvas = document.querySelector<HTMLCanvasElement>("#globe-canvas")!;
const patchCanvas = document.querySelector<HTMLCanvasElement>("#patch-canvas")!;
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

globeBtn.addEventListener("click", () => {
  send({ type: "setActiveRegion", value: null });
  selectedCreatureId = null;
  patchHint.textContent = "Globe view — select a region to watch its creatures evolve.";
});

saveBtn.addEventListener("click", () => {
  send({ type: "save", reason: "manual" });
});

newBtn.addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY);
  selectedCreatureId = null;
  send({ type: "newWorld", seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 });
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
  [globeCanvas, globeCanvas.parentElement!],
  [patchCanvas, patchCanvas.parentElement!],
  [historyCanvas, historyCanvas.parentElement!],
  [phyloCanvas, phyloCanvas.parentElement!],
];
const ro = new ResizeObserver(() => {
  for (const [canvas, wrap] of observedCanvases) resizeCanvas(canvas, wrap);
});
for (const [, wrap] of observedCanvases) ro.observe(wrap);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function biomassColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const h = 205 - 150 * x; // blue (barren) -> green (lush)
  const l = 20 + 34 * x;
  return `hsl(${h} 58% ${l}%)`;
}

function logicalCanvasSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function globeGeometry(w: number, h: number): { cx: number; cy: number; R: number } {
  const cx = w * 0.5;
  const cy = h * 0.52;
  const R = Math.min(w, h) * 0.4;
  return { cx, cy, R };
}

function drawGlobe(v: ReadonlySimulationView): void {
  const ctx = globeCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(globeCanvas);
  ctx.clearRect(0, 0, w, h);
  const { cx, cy, R } = globeGeometry(w, h);
  const n = v.regions.length;

  // Atmospheric halo behind the planet.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.28);
  halo.addColorStop(0, "rgba(91,159,212,0.28)");
  halo.addColorStop(1, "rgba(91,159,212,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.28, 0, Math.PI * 2);
  ctx.fill();

  // Colored region wedges, clipped to the planet disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const reg = v.regions[i]!;
    ctx.fillStyle = biomassColor(reg.biomass);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fill();
  }

  // Graticule: latitude ellipses + longitude lines for a spherical read.
  ctx.strokeStyle = "rgba(10,14,20,0.28)";
  ctx.lineWidth = 1;
  for (let k = 1; k <= 3; k++) {
    const ry = (R * k) / 4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let k = 0; k < 6; k++) {
    const rx = R * Math.cos((k / 6) * Math.PI);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(rx), R, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Spherical shading: lit highlight upper-left fading to a dark limb.
  const shade = ctx.createRadialGradient(
    cx - R * 0.35,
    cy - R * 0.4,
    R * 0.1,
    cx,
    cy,
    R * 1.05,
  );
  shade.addColorStop(0, "rgba(255,255,255,0.32)");
  shade.addColorStop(0.45, "rgba(255,255,255,0.03)");
  shade.addColorStop(0.75, "rgba(0,0,0,0.18)");
  shade.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Red markers on regions that currently host predators.
  for (let i = 0; i < n; i++) {
    const reg = v.regions[i]!;
    if (reg.carnivores <= 0) continue;
    const mid = ((i + 0.5) / n) * Math.PI * 2 - Math.PI / 2;
    const mr = R * 0.82;
    ctx.fillStyle = "#ff5a5a";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(mid) * mr, cy + Math.sin(mid) * mr, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlight the active region wedge.
  if (v.activeRegionId !== null) {
    const i = v.activeRegionId;
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = "#eaf2ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.stroke();
  }

  // Planet rim.
  ctx.strokeStyle = "rgba(150,180,220,0.5)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  // Climate ring: each region's temperature, frozen blue to scorching red.
  for (let i = 0; i < n; i++) {
    const reg = v.regions[i]!;
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = `hsl(${220 - 210 * reg.temperature} 75% 55% / 0.85)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 5, a0 + 0.01, a1 - 0.01);
    ctx.stroke();
  }

  // Summary readout.
  ctx.fillStyle = "#cdd7e6";
  ctx.textAlign = "center";
  ctx.font = "600 12px system-ui,sans-serif";
  ctx.fillText(`${v.summary.totalPopulation} creatures`, cx, cy + R + 22);
  ctx.fillStyle = "#8b95a8";
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillText(`diversity ${v.summary.meanDiversity.toFixed(2)}`, cx, cy + R + 38);
}

function arenaTransform(
  w: number,
  h: number,
  arenaSize: number,
): { scale: number; ox: number; oy: number } {
  const scale = Math.min(w, h) / arenaSize;
  const ox = (w - arenaSize * scale) / 2;
  const oy = (h - arenaSize * scale) / 2;
  return { scale, ox, oy };
}

function drawArena(v: ReadonlySimulationView): void {
  const ctx = patchCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(patchCanvas);
  ctx.clearRect(0, 0, w, h);
  const creatures = v.activeCreatures;
  const food = v.activeFood;
  if (!creatures || !food) {
    ctx.fillStyle = "#2a3140";
    ctx.font = "13px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No region selected", w / 2, h / 2);
    return;
  }

  const arenaSize = v.arenaSize;
  const { scale, ox, oy } = arenaTransform(w, h, arenaSize);

  // Arena floor.
  ctx.fillStyle = "#0b120e";
  ctx.fillRect(ox, oy, arenaSize * scale, arenaSize * scale);
  ctx.strokeStyle = "#1d2a22";
  ctx.strokeRect(ox, oy, arenaSize * scale, arenaSize * scale);

  // Food.
  ctx.fillStyle = "#6fcf7a";
  const foodR = Math.max(1.2, 0.35 * scale);
  for (const f of food) {
    ctx.beginPath();
    ctx.arc(ox + f.x * scale, oy + f.y * scale, foodR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Creatures.
  let selected: (typeof creatures)[number] | null = null;
  for (const c of creatures) {
    if (c.id === selectedCreatureId) selected = c;
    const px = ox + c.x * scale;
    const py = oy + c.y * scale;
    const r = Math.max(1.5, c.radius * scale);
    const light = 32 + c.energy * 34;
    const predator = c.diet >= 0.5;
    ctx.fillStyle = `hsl(${c.hue} 70% ${light}%)`;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    // Trophic cue: predators get a bold red ring, herbivores a soft light ring.
    if (predator) {
      ctx.strokeStyle = "#ff5a5a";
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = `hsl(${c.hue} 75% ${Math.min(88, light + 24)}%)`;
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    // Heavily plated creatures show a steel ring inside the body.
    if (c.armor > 0.35 && r > 3) {
      ctx.strokeStyle = "rgba(200,210,225,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Selected creature: highlight ring + a small health bar.
  if (selected) {
    const px = ox + selected.x * scale;
    const py = oy + selected.y * scale;
    const r = Math.max(1.5, selected.radius * scale);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r + 4, 0, Math.PI * 2);
    ctx.stroke();

    const barW = Math.max(20, r * 3);
    const barX = px - barW / 2;
    const barY = py - r - 10;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, 5);
    ctx.fillStyle = "#4fd07a";
    ctx.fillRect(barX, barY, barW * selected.health, 3);
  }

  drawArenaOverlay(ctx, ox, oy, v.activeStats, selected);
}

function dietLabel(diet: number): string {
  if (diet >= 0.66) return "Carnivore";
  if (diet >= 0.34) return "Omnivore";
  return "Herbivore";
}

function drawArenaOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  stats: ArenaStats | null,
  selected:
    | {
        id: number;
        speciesId: number;
        radius: number;
        speed: number;
        effSpeed: number;
        sense: number;
        diet: number;
        armor: number;
        social: number;
        fecundity: number;
        hue: number;
        energy: number;
        health: number;
        age: number;
        generation: number;
        mature: boolean;
        readyToMate: boolean;
      }
    | null,
): void {
  ctx.textAlign = "left";
  ctx.font = "11px system-ui,sans-serif";

  // Compact population summary line.
  if (stats) {
    ctx.fillStyle = "rgba(10,14,20,0.55)";
    ctx.fillRect(ox + 6, oy + 6, 262, 20);
    ctx.fillStyle = "#e8ecf4";
    const carn = (stats.carnivoreFraction * 100).toFixed(0);
    ctx.fillText(
      `pop ${stats.population} · species ${stats.speciesCount} · gen ${stats.generation} · carniv. ${carn}%`,
      ox + 12,
      oy + 20,
    );
  }

  if (!selected) {
    ctx.fillStyle = "#8b95a8";
    ctx.fillText("Click a blob to inspect its stats", ox + 12, oy + 42);
    return;
  }

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
    ["diet", `${dietLabel(selected.diet)} (${selected.diet.toFixed(2)})`],
    ["health", selected.health.toFixed(2)],
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
  const boxX = ox + 6;
  const boxY = oy + 32;
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

  // Axes.
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

  // Total population.
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

  // Per-species lines.
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

  // Legend.
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

  // Show every living species plus the most significant extinct ones.
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

    // Descent connector to the parent's row.
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

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function sectorFromGlobeClick(clientX: number, clientY: number): number | null {
  if (!view) return null;
  const rect = globeCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const { cx, cy, R } = globeGeometry(rect.width, rect.height);
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > R) return null;
  let ang = Math.atan2(dy, dx) + Math.PI / 2;
  if (ang < 0) ang += Math.PI * 2;
  const n = view.regions.length;
  const idx = Math.floor((ang / (Math.PI * 2)) * n);
  return Math.min(n - 1, Math.max(0, idx));
}

globeCanvas.addEventListener("click", (e) => {
  const id = sectorFromGlobeClick(e.clientX, e.clientY);
  if (id === null || !view) return;
  send({ type: "setActiveRegion", value: id });
  selectedCreatureId = null;
  const reg = view.regions[id];
  const climate = reg
    ? ` · ${reg.biome} (${reg.temperature < 0.3 ? "cold" : reg.temperature > 0.65 ? "hot" : "mild"})`
    : "";
  patchHint.textContent = `Region ${id}${climate} — click a blob to inspect it`;
});

patchCanvas.addEventListener("click", (e) => {
  if (!view) return;
  const creatures = view.activeCreatures;
  if (!creatures) return;
  const { w, h } = logicalCanvasSize(patchCanvas);
  const { scale, ox, oy } = arenaTransform(w, h, view.arenaSize);
  const rect = patchCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  let picked: number | null = null;
  let bestD = Infinity;
  for (const c of creatures) {
    const cxp = ox + c.x * scale;
    const cyp = oy + c.y * scale;
    const rp = Math.max(4, c.radius * scale);
    const d = Math.hypot(px - cxp, py - cyp);
    if (d <= rp + 5 && d < bestD) {
      bestD = d;
      picked = c.id;
    }
  }
  selectedCreatureId = picked;
});

// ---------------------------------------------------------------------------
// Render loop: draws the latest snapshot from the worker.
// ---------------------------------------------------------------------------
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
    const onGlobe = view.activeRegionId === null;
    globeBtn.disabled = onGlobe;
    globeBtn.classList.toggle("active", onGlobe);
    if (String(view.time.speedMultiplier) !== speedSel.value) {
      speedSel.value = String(view.time.speedMultiplier);
    }
    drawGlobe(view);
    drawArena(view);
    drawHistory();
    drawPhylo(view);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
