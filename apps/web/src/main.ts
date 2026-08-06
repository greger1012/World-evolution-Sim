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
      <p class="hint">Click a sector to open its regional patch.</p>
      <div class="canvas-wrap">
        <canvas id="globe-canvas" width="600" height="400" aria-label="Globe regions"></canvas>
      </div>
    </section>
    <section class="panel">
      <header><h2>Regional patch</h2></header>
      <p class="hint" id="patch-hint">Globe view — select a region for local biomass.</p>
      <div class="canvas-wrap">
        <canvas id="patch-canvas" width="600" height="400" aria-label="Regional patch"></canvas>
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
  patchHint.textContent = "Globe view — select a region for local biomass.";
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
  const h = 210 - 110 * x;
  const l = 18 + 42 * x;
  return `hsl(${h} 55% ${l}%)`;
}

function logicalCanvasSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function drawGlobe(): void {
  const ctx = globeCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(globeCanvas);
  ctx.clearRect(0, 0, w, h);
  const view = sim.getView();
  const cx = w * 0.5;
  const cy = h * 0.52;
  const r0 = Math.min(w, h) * 0.12;
  const r1 = Math.min(w, h) * 0.38;
  const n = view.regions.length;

  ctx.strokeStyle = "#1e2430";
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
    const reg = view.regions[i]!;
    ctx.fillStyle = biomassColor(reg.biomass);
    ctx.beginPath();
    ctx.arc(cx, cy, r1, a0, a1);
    ctx.arc(cx, cy, r0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = "#0a0c10";
  ctx.beginPath();
  ctx.arc(cx, cy, r0 * 0.98, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#6b7a90";
  ctx.font = "600 11px system-ui,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Summary", cx, cy - 4);
  ctx.font = "10px system-ui,sans-serif";
  ctx.fillStyle = "#8b95a8";
  ctx.fillText(`biomass ${view.summary.totalBiomass.toFixed(1)}`, cx, cy + 10);
  ctx.fillText(`diversity ${view.summary.meanDiversity.toFixed(2)}`, cx, cy + 22);
}

function drawPatch(): void {
  const ctx = patchCanvas.getContext("2d");
  if (!ctx) return;
  const { w, h } = logicalCanvasSize(patchCanvas);
  ctx.clearRect(0, 0, w, h);
  const view = sim.getView();
  const data = view.activePatchBiomass;
  if (!data) {
    ctx.fillStyle = "#2a3140";
    ctx.font = "13px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No region selected", w / 2, h / 2);
    return;
  }
  const pw = view.patchWidth;
  const ph = view.patchHeight;
  const cell = Math.min(w / pw, h / ph);
  const ox = (w - cell * pw) / 2;
  const oy = (h - cell * ph) / 2;
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const v = data[y * pw + x] ?? 0;
      ctx.fillStyle = biomassColor(v);
      ctx.fillRect(ox + x * cell, oy + y * cell, cell + 0.5, cell + 0.5);
    }
  }
}

function sectorFromGlobeClick(clientX: number, clientY: number): number | null {
  const rect = globeCanvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  const cx = w * 0.5;
  const cy = h * 0.52;
  const r0 = Math.min(w, h) * 0.12;
  const r1 = Math.min(w, h) * 0.38;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < r0 || dist > r1) return null;
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
  patchHint.textContent = `Region ${id} — local biomass (abstract)`;
});

function frame(now: number): void {
  const dt = now - last;
  last = now;
  sim.advance(dt);
  const view = sim.getView();
  statsEl.innerHTML = `
    <span>Tick <strong>${view.summary.tick}</strong></span>
    <span>Biomass <strong>${view.summary.totalBiomass.toFixed(2)}</strong></span>
    <span>Diversity <strong>${view.summary.meanDiversity.toFixed(3)}</strong></span>
    <span>Speed <strong>${view.time.speedMultiplier}×</strong>${view.time.paused ? " (paused)" : ""}</span>
  `;
  drawGlobe();
  drawPatch();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
