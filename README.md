# World Evolution Sim

A TypeScript monorepo for an interactive **world evolution simulation**: stratified globe regions, regional biomass patches, and adjustable time controls — viewable in the browser or as a desktop app.

## Highlights

- **Core simulation engine** (`@evo-world-sim/core`) — region state, patch grids, speed multipliers, and pause/resume
- **Web UI** (`@evo-world-sim/web`) — Vite + Canvas visualization of the globe and selected regional patches
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

## How to use the UI

1. Watch the **stratified globe** update as the simulation runs.
2. Use the **speed** dropdown to accelerate or slow time (presets up to high multipliers).
3. **Pause / Resume** to freeze the world state.
4. **Click a globe sector** to inspect that region’s local biomass patch; return with the Globe control.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build core, then the web app |
| `npm run dev` | Start the Vite web client |
| `npm run dev:desktop` | Run web + Electron together |

## Author

**Gregory Dorfman** ([greger1012](https://github.com/greger1012))
