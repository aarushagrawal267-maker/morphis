# Architecture

```
            USER / COMMANDER
                  │
       ┌──────────▼───────────┐        React HUD (2D)  ◄─ zustand UI store
       │   apps/web (browser) │        R3F / Three.js scene (3D)
       │  SimClient + motion  │◄─────── interpolation of route-based frames
       └──────────┬───────────┘
        Transport │ (same messages either way)
     ┌────────────┴─────────────┐
     │ WorkerTransport          │ SocketTransport (Socket.IO)
     ▼                          ▼
 Web Worker (local mode)    apps/server (authoritative)
  CitySimulation              SimulationHost ─ CitySimulation
  IndexedDB saves             REST API (Fastify)
                              Persistence: PostgreSQL (Prisma) │ JSON files
                              AgentController: provider · planner · executor
                                               · tools · memory · workspace
```

## Principles

- **Simulation and rendering are separate.** `packages/sim` has no rendering dependencies and runs identically in Node and in a browser worker. The client only ever *displays* state that the authority sends.
- **Fixed timestep.** One tick is one simulated second (`TICK_SECONDS`). `SimulationRunner` turns wall-clock time into ticks: speed × 60 sim-seconds per real second at 1x, with a CPU budget so slow machines degrade gracefully.
- **Motion time compression.** Street-level motion (walking, driving, signal cycles) runs at 1/18 of clock time (`MOTION_SECONDS_PER_TICK`). At 1x a pedestrian moves at a natural pace on screen, while a cross-town walk still takes a realistic 30–60 clock minutes. The city is a compressed model of a metropolis.
- **Route-based motion frames.** When an entity starts moving, its full polyline route is sent once as an event (`citizen.moved` / `vehicle.moved`). Motion frames then carry only `(entity, routeId, s)` triples at 20 Hz. The client interpolates `s` and samples the polyline, so movement is smooth and never cuts corners, and bandwidth stays tiny.
- **Determinism.** All randomness goes through seeded, serialisable `Rng` streams. The same seed gives the same world (verified by `world.hash`), and save → restore produces an identical future (tested).
- **Typed event bus.** Systems emit typed events (`SimEventMap`). The host forwards them to clients and the UI derives its feeds from them.

## Message protocol (`packages/shared/src/protocol.ts`)

| Message | Rate | Content |
|---|---|---|
| `world.init` | on connect / load / new | static world, profiles, state, active routes, projects, news, persistence & AI status |
| `sim.frame` | 20 Hz | movers as `(index, routeId, s[, speed])`, signal phases |
| `sim.state` | 2 Hz (full every 5 s) | citizen & vehicle dynamics, occupancy, stats, economy, weather, perf |
| `sim.events` | as they happen | typed `SimEvent` batch |
| `sim.command` | client → authority | zod-validated `SimCommand`, acknowledged with `{ ok, data \| error }` |

## Scaling notes

- Buildings, props, citizens and vehicles are instanced (≈ 220 draw calls for the whole city including post-processing passes).
- Citizens indoors cost nothing per tick: decisions are scheduled in a min-heap keyed by decision time. Only walkers and moving vehicles update every tick.
- Tick cost is about 20–60 µs for 400 citizens. 60x speed runs 3,600 ticks per real second, inside the server's budget. For 5,000+ citizens, state frames should switch to deltas and walkers to analytic motion; the protocol already allows this.
