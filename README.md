# MORPHIS

**Emergent AI city • Year 2126 • The Complex**

MORPHIS is a browser-based 3D cyberpunk city simulation. A deterministic simulation engine runs the city: roads, traffic signals, buildings, about 400 citizens with homes, jobs and daily schedules, cars, taxis, buses and delivery vans, weather, a day/night cycle, an economy and city events. A Three.js renderer shows that state as it happens. Twenty-five *core citizens* make up the city's workforce, coordinated by **JARVIS**. When an AI provider is configured, they run projects as real LLM agents. Without one, the simulation does the work and labels every result as simulated.

> **Honesty rules built into the product:** all money is simulated credits (§). Deliverables made without an AI provider are marked `[SIMULATED]`. The UI always shows which authority (browser worker or server), which persistence backend and which AI provider is actually in use.

![Morphis at night](docs/screenshot-night.png)

| Street level | Interior (JARVIS HQ) |
|---|---|
| ![street](docs/screenshot-street.png) | ![interior](docs/screenshot-interior.png) |

## Quick start

```bash
npm install
npm run dev            # web client on http://localhost:5173 (local mode, no server needed)
```

Local mode runs the full simulation in a Web Worker and saves cities in the browser (IndexedDB).

Full stack (authoritative Node server, WebSockets, PostgreSQL):

```bash
docker compose up -d postgres                 # or use any PostgreSQL 14+
cp apps/server/.env.example apps/server/.env  # edit DATABASE_URL / AI settings
npm run db:generate && npm run db:push
npm run dev:all                               # server :8787 + web :5173
```

The web client connects to the server automatically when `http://<host>:8787/api/health` responds. Otherwise it falls back to local mode. Force a mode with `?mode=local` or `?mode=server`.

Useful URL parameters: `?hour=21` (start at 21:00), `?population=800`, `?seed=77`, `?quality=low|medium`.

## Real AI agents (optional)

The server talks to any OpenAI-compatible endpoint or to Anthropic. API keys stay on the server and never reach the browser.

| Provider | `AI_PROVIDER` | `AI_BASE_URL` | `AI_MODEL` example |
|---|---|---|---|
| NVIDIA NIM (free key at build.nvidia.com) | `openai-compatible` | `https://integrate.api.nvidia.com/v1` | `nvidia/nemotron-3-ultra-550b-a55b` |
| OpenRouter | `openai-compatible` | `https://openrouter.ai/api/v1` | any listed model |
| OpenAI | `openai-compatible` | `https://api.openai.com/v1` | `gpt-…` |
| Ollama / vLLM (no key) | `openai-compatible` | `http://localhost:11434/v1` | `qwen2.5-coder:32b` |
| Anthropic | `anthropic` | — | `claude-sonnet-5-5` |

Set `AI_API_KEY` (or `NVIDIA_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`). At startup the server makes **one** test call. If it succeeds, the UI shows `AI · <provider>`; if it fails, the UI says so and the city keeps running in simulated mode. Throughput is protected by `AI_REQUESTS_PER_MINUTE` (default 30, the NVIDIA free tier) and `AI_DAILY_REQUEST_CAP`.

With a provider connected, a JARVIS command flows like this:

1. The command is turned into a validated task graph by the **LLM Master Planner**. If planning fails, the template planner is used.
2. The **Task Manager** assigns each task to the core citizen with the matching role.
3. That citizen walks or drives to the task's building. The agent starts only when the citizen is *working there*, and the citizen stays at the desk until the agent finishes.
4. Each agent writes a markdown deliverable into the project workspace (`data/workspaces/<project>/`) through the permissioned tool manager. Tool use is recorded in the audit log.
5. The final review task receives every upstream deliverable and writes the synthesis report.

See [docs/systems/ai-agents.md](docs/systems/ai-agents.md).

## What is implemented

| Milestone | Status |
|---|---|
| 1–2 3D city & visual quality | Procedural seeded city: 14 districts, about 180 buildings with procedural facades and window lighting driven by real occupancy, JARVIS HQ landmark, roads with markings, sidewalks, crosswalks, live traffic lights, neon, signs, billboards, props, distant skyline, bloom |
| 3 Living city | 400 citizens (25 core) with homes, jobs, weekday/weekend schedules and needs. A* on road and sidewalk graphs, walk cycles, cars, taxis, buses on 3 lines, delivery vans, external traffic |
| 4 Simulation | Fixed 1 s ticks, speeds 1x–60x, day/night, Markov weather (clear/rain/fog/storm) with wet surfaces, signal-aware crossings, IDM car-following with emergent congestion, city events, news derived from state |
| 5–6 Interaction & interface | Raycast selection of buildings, citizens and vehicles. District pins, nav tabs, info HUD, agent stream, bottom feature bar, key features, minimap, clock & weather panel, settings, debug overlay, city story, save/load/new |
| 7 Interiors | JARVIS HQ, AI/research labs, university, offices and apartments, with rooms, furniture and live occupants placed by activity |
| 8 Economy | Salaries, rent, purchases, fares, business cash flow, inventory and deliveries, hiring and layoffs, taxes, city budget, power and water demand |
| 9 Backend | Fastify + Socket.IO authoritative server, REST API, PostgreSQL via Prisma (snapshots plus structured tables), file fallback |
| 10 JARVIS | Command console, template and LLM planners, task dependency graphs, task manager, shared workspace, reviewer, final synthesis |
| 11 Real AI citizens | Provider layer, live executor, tool manager with permission levels and audit log, agent memory. **Requires your API key**; the only tools enabled are workspace read/write (web and code-execution tools are defined but disabled until a sandbox exists) |
| 12 Autonomous city | Partially: completing a JARVIS startup plan founds a simulated company that moves into a construction site and hires citizens |

Not included: Blender/GLB assets (all geometry is procedural; drop GLB files into the renderer when you have them) and Redis (not needed until multiple agent worker processes exist; a compose profile is reserved).

## Project layout

```
packages/shared   types, event catalogue, wire protocol, zod schemas, constants
packages/sim      deterministic engine: world generation, navigation, citizens,
                  traffic, economy, weather, events, workforce, planner
apps/web          React + React Three Fiber client (scene/, components/, sim/ transports)
apps/server       Fastify + Socket.IO host, Prisma persistence, AI agent layer
e2e               Playwright browser tests
docs              architecture, systems and development guides
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Web client (local mode) |
| `npm run dev:server` / `npm run dev:all` | Server / server + client |
| `npm test` | Vitest: engine, server, PostgreSQL (`TEST_DATABASE_URL`), AI pipeline (mock provider) |
| `npm run test:e2e` | Playwright browser tests |
| `npm run typecheck` / `npm run lint` | Type-check / lint all packages |
| `npm run build` | Production build of the web client |
