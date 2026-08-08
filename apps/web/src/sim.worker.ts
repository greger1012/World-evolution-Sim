import {
  defaultSimulationConfig,
  EvolutionSimulation,
} from "@evo-world-sim/core";
import type { MainToWorker, WorkerToMain } from "./protocol.js";

let sim: EvolutionSimulation | null = null;
let last = performance.now();
let lastMeta = 0;

function post(msg: WorkerToMain): void {
  (self as unknown as Worker).postMessage(msg);
}

function tick(): void {
  if (!sim) return;
  const now = performance.now();
  const dt = Math.min(100, now - last); // clamp hiccups (tab switches etc.)
  last = now;
  sim.advance(dt);
  post({ type: "frame", view: sim.getView() });
  if (now - lastMeta > 400) {
    lastMeta = now;
    post({
      type: "meta",
      species: [...sim.getSpecies()],
      history: [...sim.getHistory()],
    });
  }
}

setInterval(tick, 16);

self.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      if (msg.saved) {
        try {
          sim = EvolutionSimulation.restore(msg.saved);
        } catch {
          post({ type: "loadFailed" });
          sim = new EvolutionSimulation({ ...defaultSimulationConfig }, msg.seed);
        }
      } else {
        sim = new EvolutionSimulation({ ...defaultSimulationConfig }, msg.seed);
      }
      last = performance.now();
      lastMeta = 0;
      break;
    }
    case "setSpeed":
      sim?.setSpeedMultiplier(msg.value);
      break;
    case "setPaused":
      sim?.setPaused(msg.value);
      break;
    case "setActiveRegion":
      sim?.setActiveRegion(msg.value);
      break;
    case "save":
      if (sim) post({ type: "saved", data: sim.serialize(), reason: msg.reason });
      break;
    case "newWorld":
      sim = new EvolutionSimulation({ ...defaultSimulationConfig }, msg.seed);
      last = performance.now();
      lastMeta = 0;
      break;
  }
};
