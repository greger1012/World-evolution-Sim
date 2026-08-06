import "./style.css";
import {
  defaultSimulationConfig,
  EvolutionSimulation,
  speedPresets,
} from "@evo-world-sim/core";

const sim = new EvolutionSimulation({ ...defaultSimulationConfig });
const cfg = sim.getConfig();

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
  </main>
`;

const statsEl = document.querySelector<HTMLDivElement>("#stats")!;
const speedSel = document.querySelector<HTMLSelectElement>("#speed")!;
const pauseBtn = document.querySelector<HTMLButtonElement>("#pause")!;
const globeBtn = document.querySelector<HTMLButtonElement>("#globe")!;
const patchHint = document.querySelector<HTMLParagraphElement>("#patch-hint")!;
const globeCanvas = document.querySelector<HTMLCanvasElement>("#globe-canvas")!;
const patchCanvas = document.querySelector<HTMLCanvasElement>("#patch-canvas")!;

for (const s of speedPresets) {
  const opt = document.createElement("option");
  opt.value = String(s);
  opt.textContent = `${s}×`;
  speedSel.appendChild(opt);
}
speedSel.value = "1";

speedSel.addEventListener("change", () => {
  sim.setSpeedMultiplier(Number(speedSel.value));
});

pauseBtn.addEventListener("click", () => {
  const view = sim.getView();
  const next = !view.time.paused;
  sim.setPaused(next);
  pauseBtn.textContent = next ? "Resume" : "Pause";
});

globeBtn.addEventListener("click", () => {
  sim.setActiveRegion(null);
  globeBtn.disabled = true;
  globeBtn.classList.add("active");
  patchHint.textContent = "Globe view — select a region to watch its creatures evolve.";
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

const globeWrap = globeCanvas.parentElement!;
const patchWrap = patchCanvas.parentElement!;

const ro = new ResizeObserver(() => {
  resizeCanvas(globeCanvas, globeWrap);
  resizeCanvas(patchCanvas, patchWrap);
});
ro.observe(globeWrap);
ro.observe(patchWrap);

let last = performance.now();

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

function drawGlobe(): void {
  const ctx = globeCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(globeCanvas);
  ctx.clearRect(0, 0, w, h);
  const view = sim.getView();
  const { cx, cy, R } = globeGeometry(w, h);
  const n = view.regions.length;

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
    const reg = view.regions[i]!;
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

  // Highlight the active region wedge.
  if (view.activeRegionId !== null) {
    const i = view.activeRegionId;
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

  // Summary readout.
  ctx.fillStyle = "#cdd7e6";
  ctx.textAlign = "center";
  ctx.font = "600 12px system-ui,sans-serif";
  ctx.fillText(`${view.summary.totalPopulation} creatures`, cx, cy + R + 22);
  ctx.fillStyle = "#8b95a8";
  ctx.font = "11px system-ui,sans-serif";
  ctx.fillText(
    `diversity ${view.summary.meanDiversity.toFixed(2)}`,
    cx,
    cy + R + 38,
  );
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

function drawArena(): void {
  const ctx = patchCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(patchCanvas);
  ctx.clearRect(0, 0, w, h);
  const view = sim.getView();
  const creatures = view.activeCreatures;
  const food = view.activeFood;
  if (!creatures || !food) {
    ctx.fillStyle = "#2a3140";
    ctx.font = "13px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No region selected", w / 2, h / 2);
    return;
  }

  const arenaSize = view.arenaSize;
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
  for (const c of creatures) {
    const px = ox + c.x * scale;
    const py = oy + c.y * scale;
    const r = Math.max(1.5, c.radius * scale);
    const light = 32 + c.energy * 34;
    ctx.fillStyle = `hsl(${c.hue} 70% ${light}%)`;
    ctx.strokeStyle = `hsl(${c.hue} 75% ${Math.min(88, light + 22)}%)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Stats overlay.
  const s = view.activeStats;
  if (s) {
    ctx.textAlign = "left";
    ctx.font = "11px system-ui,sans-serif";
    ctx.fillStyle = "rgba(10,14,20,0.55)";
    ctx.fillRect(ox + 6, oy + 6, 172, 74);
    ctx.fillStyle = "#e8ecf4";
    ctx.fillText(`pop ${s.population}   gen ${s.generation}`, ox + 14, oy + 22);
    ctx.fillStyle = "#a7b2c4";
    ctx.fillText(`size ${s.meanSize.toFixed(2)}`, ox + 14, oy + 38);
    ctx.fillText(`speed ${s.meanSpeed.toFixed(2)}`, ox + 14, oy + 52);
    ctx.fillText(`sense ${s.meanSense.toFixed(2)}`, ox + 14, oy + 66);
  }
}

function sectorFromGlobeClick(clientX: number, clientY: number): number | null {
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
  const n = cfg.regionCount;
  const idx = Math.floor((ang / (Math.PI * 2)) * n);
  return Math.min(n - 1, Math.max(0, idx));
}

globeCanvas.addEventListener("click", (e) => {
  const id = sectorFromGlobeClick(e.clientX, e.clientY);
  if (id === null) return;
  sim.setActiveRegion(id);
  globeBtn.disabled = false;
  globeBtn.classList.remove("active");
  patchHint.textContent = `Region ${id} — living arena (blobs sense, eat, breed, mutate)`;
});

function frame(now: number): void {
  const dt = now - last;
  last = now;
  sim.advance(dt);
  const view = sim.getView();
  statsEl.innerHTML = `
    <span>Tick <strong>${view.summary.tick}</strong></span>
    <span>Creatures <strong>${view.summary.totalPopulation}</strong></span>
    <span>Biomass <strong>${view.summary.totalBiomass.toFixed(2)}</strong></span>
    <span>Diversity <strong>${view.summary.meanDiversity.toFixed(3)}</strong></span>
    <span>Speed <strong>${view.time.speedMultiplier}×</strong>${view.time.paused ? " (paused)" : ""}</span>
  `;
  drawGlobe();
  drawArena();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
