# Development setup

## Requirements
- Node.js 20+ (22 recommended), npm 10+
- Optional: PostgreSQL 14+ (or `docker compose up -d postgres`)
- Optional: an AI provider key (see README)

## Install & run
```bash
npm install
npm run dev                  # http://localhost:5173 — local mode
npm run dev:all              # server :8787 + web :5173 — server mode
```

## Database
```bash
cp apps/server/.env.example apps/server/.env
npm run db:generate          # prisma generate
npm run db:push              # create tables
```
Without `DATABASE_URL`, saves go to `apps/server/data/saves/*.json`. If the database is configured but unreachable, the server says so in `/api/health` and in the Settings panel, and falls back to files.

## Tests
```bash
npm test                                         # engine + server + AI pipeline (mock provider)
TEST_DATABASE_URL=postgresql://... npm test      # also the PostgreSQL round-trip
npm run test:e2e                                 # Playwright (starts Vite automatically)
```
In environments without a GPU, Playwright uses SwiftShader. Frame rates are low there but every interaction is tested. Use `?quality=low` for faster runs.

## Debugging
- Settings → *Developer debug overlay*: FPS, draw calls, triangles, entity counts, tick, tick cost, active paths, events, transport status, and layers (road graph, pedestrian paths, district bounds, building bounds, citizen destinations, collision boxes).
- `window.__morphis` exposes the stores and a `project(x, y, z)` helper (used by the e2e tests). `window.__morphisCamera` is the camera controller.

## Conventions
- Strict TypeScript everywhere; zod validates every command crossing a trust boundary.
- The renderer never mutates simulation state. All changes go through commands to the authority.
- Fictional money is always rendered with the § credit sign.
