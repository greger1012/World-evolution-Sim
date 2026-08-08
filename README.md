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

- **Core simulation engine** (`@evo-world-sim/core`) — region state, patch grids, speed multipliers, pause/resume
- **Web UI** (`@evo-world-sim/web`) — Vite + Canvas globe and regional patch views
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

1. Watch the **stratified globe** (a shaded sphere) update as the simulation runs; wedge colour reflects each region's living biomass.
2. Use the **speed** dropdown to accelerate or slow time (evolution runs faster at higher multipliers).
3. **Pause / Resume** to freeze the world state.
4. **Click a region** on the globe to open its **living arena**: creatures ("blobs") with heritable traits (size, speed, sense, diet) graze plants, flee or hunt each other, breed, and die. Herbivores carry a soft ring; **predators carry a bold red ring**.
5. **Trait trade-offs** mirror the real world: bigger bodies are slower but take down bigger prey and win defensive struggles (failed attacks injure the attacker); a higher speed gene burns disproportionately more energy; sharper senses cost upkeep. **Armor** blocks and punishes attacks but is heavy and expensive; a **social** gene makes herbivores herd for safety and carnivores **hunt in packs** — regrouping, striking together for a catch bonus, taking down prey too big for a lone hunter, and sharing every kill; a **fecundity** gene picks an r/K strategy (many weak young vs few sturdy ones from a fixed birth pool).
6. **Reproduction**: creatures mature, then well-fed adults court compatible partners (same trophic type, similar lineage colour) and produce litters via genome crossover + mutation — with a costly asexual fallback for lonely creatures. Lineage-colour compatibility gives soft speciation.
7. **Click a blob** to select it and read its individual stats (species, diet, health, energy, size, speed + effective speed, sense, age, generation, mating status); the selected blob shows a health bar. Return to the globe with the Globe control.
8. **Population history** charts world population over time, one coloured line per species, so booms, crashes, and takeovers are visible at a glance.
9. **Phylogeny** shows every significant species as a lifespan bar (founding → extinction), colour-coded by lineage, with connectors to the parent species it split from. Carnivorous lineages carry a red dot. Species get procedural names (herbivores like *Ryntaella*, carnivores like *Vilodon*).
10. **A connected world**: each region's side borders lead to its neighbours — crossing is chancy and costs energy, but species genuinely migrate, invade, and spread around the ring. The globe's outer **climate ring** shows each region's temperature (frozen blue → scorching red); regions have biomes (tundra, boreal forest, steppe, temperate forest, jungle, desert) with real metabolic effects — cold punishes small bodies, heat punishes large ones, and climate extremes grow less food.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build core, then the web app |
| `npm run dev` | Start the Vite web client |
| `npm run dev:desktop` | Run web + Electron together |

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
| Full 2D world map (WorldBox-style) | Planned |
| World events (droughts, disease, disasters) | Planned |

Feedback and contributions can wait until the core evolution model is further along; the public surface will keep changing.

## Author

**Gregory Dorfman** ([greger1012](https://github.com/greger1012))
