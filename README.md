# World Evolution Sim

An interactive **world-scale evolution simulation** — organisms adapting over deep time across varied environments, with rich, descriptive biology rather than a toy demo.

> **Early work in progress.** This repository is far from complete. What you can run today is a foundation: a stratified globe, regional biomass patches, and time controls. The fuller evolution system — detailed organisms, selection pressures, and large-scale environmental diversity — is still under active design and development.

## Vision

The long-term goal is a simulation where evolution feels **deep and readable**:

- **Complex evolution mechanics** — traits, populations, and lineages changing under selection, mutation, and ecological pressure, described in enough detail to follow *why* a lineage succeeds or fails
- **Environments at scale** — many regions and biomes (climate, resources, hazards, and spatial structure) that shape what can live where
- **World-level interaction** — zoom from a planetary view into local patches, watching global patterns emerge from local dynamics
- **Descriptive complexity** — not just abstract numbers; the sim should make evolutionary outcomes understandable through clear state, history, and environmental context

The current build scaffolds the **globe / region / time** layer that those systems will sit on. Expect the engine, data model, and UI to grow substantially as the evolution and environment layers land.

## What’s here now

- **Core simulation engine** (`@evo-world-sim/core`) — creatures, species, migration, biomes, save/load snapshots
- **Web UI** (`@evo-world-sim/web`) — Vite + Canvas unified world map (pan/zoom from overview into live regions), history, and phylogeny panels
- **Web worker** — simulation runs off the main thread so the UI stays responsive at high speed multipliers
- **Save / load** — full-world snapshots in browser `localStorage` (autosave + manual Save / New world)
- **Test suite** — Vitest guards determinism, ecosystem behaviour, species tracking, and save fidelity
- **Spatial hashing** — hybrid grid for neighbour queries (food, mates, prey) instead of all-pairs scans
- **Desktop shell** (`@evo-world-sim/desktop`) — Electron wrapper around the web client
- **npm workspaces** — shared TypeScript packages with a single install at the repo root

## Tech stack

| Layer | Tools |
| --- | --- |
| Language | TypeScript |
| Build / web | Vite |
| Desktop | Electron |
| Packaging | npm workspaces |

## Project layout

```
World-evolution-Sim/
├── packages/core/     # Simulation engine (regions, patches, time controls)
├── apps/web/          # Vite web client + canvas UI
└── apps/desktop/      # Electron desktop entry
```

## Quick start

**Requirements:** Node.js 18+ and npm

```bash
git clone https://github.com/greger1012/World-evolution-Sim.git
cd World-evolution-Sim
npm install
npm run build
npm run dev
```

The web app starts via Vite (default: [http://127.0.0.1:5173](http://127.0.0.1:5173)).

### Desktop (optional)

With the web dev server running:

```bash
npm run dev:desktop
```

Or use the workspace scripts in `package.json` to run web and Electron together.

## How to use the current UI

1. **Pan and zoom the world map** — procedural geography with oceans, coasts, forests, mountains, rivers, and lakes. Scroll to zoom, drag to pan.
2. **Click land** to zoom into that region and watch creatures evolve on the terrain. Scroll out or press **World view** for the full map.
3. At detail zoom, **click a creature** to inspect its stats (species, diet, health, traits). Predators are wedge-shaped with red outlines; herds show faint green bonds.
4. Use **Follow creature** / **Follow species** (header) to lock the camera on life in a region.
5. Watch the **Natural history** feed (map overlay) for hunts, births, speciation, extinctions, and world events — bursts flash on the map.
6. Use the **speed** dropdown to accelerate or slow time.
7. **Pause / Resume** to freeze the world state.
8. **Population history** and **Phylogeny** panels track species over time (same as before).
9. **Save / New world** — autosave every 30 seconds; manual save and fresh seeds supported.
10. **World events** — drought, disease, and storms stress regions (visible on the map at medium zoom with animated life specks).

## Architecture (web)

The browser UI is a thin client over snapshots from a **dedicated web worker**:

- `apps/web/src/sim.worker.ts` owns the `EvolutionSimulation` instance and advances it on a ~16 ms timer.
- `apps/web/src/main.ts` posts commands (speed, pause, region, save, new world) and renders the latest `ReadonlySimulationView` on `requestAnimationFrame`.
- Species lists and population history are refreshed from the worker about every 400 ms (lighter than every frame).

Persistence uses `EvolutionSimulation.serialize()` / `EvolutionSimulation.restore()` in `@evo-world-sim/core` — JSON-safe, exact-resume fidelity (RNG state, every creature, species registry, history, time controls). The web client stores the snapshot under `evo-world-sim-save-v1` in `localStorage`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build core, then the web app |
| `npm run test` | Run the Vitest suite in `packages/core` |
| `npm run dev` | Start the Vite web client |
| `npm run dev:desktop` | Run web + Electron together |

### Tests

From the repo root:

```bash
npm run test
```

Tests live in `packages/core/test/` and cover:

- **Determinism** — same seed + inputs → identical world fingerprints
- **Ecosystem** — food regrowth, predator sustainability, migration, trait trade-offs
- **Species** — naming, splits, extinctions, phylogeny inputs
- **Save / load** — serialize → restore round-trip and JSON storage fidelity
- **World events** — drought, disease, storm scheduling and effects

Watch mode (package only): `npm run test -w @evo-world-sim/core -- --watch`

## Status

| Area | Status |
| --- | --- |
| Globe / regions / time controls | Working prototype |
| Regional creature arena (agents, food) | Working prototype |
| Trait genomes + mutation + selection | Working prototype |
| Predator / prey dynamics (size-based struggles) | Working prototype |
| Trait trade-offs (size ↔ speed ↔ energy ↔ armor) | Working prototype |
| Herding & pack hunting (social gene) | Working prototype |
| r/K litter strategies (fecundity gene) | Working prototype |
| Reproduction (maturity, mating, crossover, litters) | Working prototype |
| Per-creature inspection (click a blob) | Working prototype |
| Species tracking, naming & phylogeny | Working prototype |
| Population history charts | Working prototype |
| Cross-region migration & species spread | Working prototype |
| Climate bands & biomes (metabolic effects) | Working prototype |
| Vitest regression suite | Working |
| Spatial hashing (neighbour queries) | Working |
| Web worker (sim off main thread) | Working |
| Save / load (localStorage + core snapshots) | Working |
| World events (drought, disease, storm) | Working prototype |
| 2D procedural world map | Working |
| Map ↔ sim terrain hookup (Phase B) | Working |
| Unified zoom map view (Phase C) | Working |
| Evolved creature rendering + social bonds (Phase D) | Working |
| Drama feed, map FX, follow camera (Phase D) | Working |

Feedback and contributions can wait until the core evolution model is further along; the public surface will keep changing.

## Author

**Gregory Dorfman** ([greger1012](https://github.com/greger1012))
