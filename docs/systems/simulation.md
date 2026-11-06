# Simulation systems (`packages/sim`)

| System | File | Responsibility |
|---|---|---|
| World generation | `gen/world.ts` | seed → districts → roads → buildings → transit → pedestrian network → props → skyline |
| Roads | `gen/roads.ts` | expressway ring, jittered avenue grid, plaza roundabout, diagonals, district-dependent streets (curved lanes in the west, large industrial blocks); planarisation; corners, setbacks, signals, signal groups |
| Buildings | `gen/buildings.ts` | frontage placement with block-depth sharing, growth and backfill passes; 23 landmarks; per-type massing (tiers, rooftops, neon, signs) |
| Pedestrian graph | `gen/pedestrian.ts` | sidewalk corners, sidewalks, crosswalks, entrances and bus stops spliced into sidewalks |
| Navigation | `nav/graphs.ts`, `nav/routes.ts` | A* on road and pedestrian graphs (congestion-aware for vehicles); lane-level drive routes with Bézier turns; walking routes with crosswalk legs |
| Clock | `engine.ts`, `runner.ts` | fixed 1 s ticks; minute/hour/day hooks; real-time runner with CPU budget |
| Citizens | `systems/citizens.ts`, `systems/population.ts` | schedules (day/early/late/night shifts, students, retirees, weekends), needs, destination choice, mode choice (walk/car/taxi/bus), building occupancy, signal-aware crossings |
| Traffic | `systems/traffic.ts` | IDM car following, signals (6-phase), unsignalised reservations, don't-block-the-box, pedestrian yielding, deadlock breaker; taxis (dispatch), buses (loops, stops, dwell, boarding), deliveries (restocking), external visitors via expressway gates |
| Economy | `systems/economy.ts` | businesses per building, purchases, wages, rent, fares, utilities, B2B deliveries, taxes, city budget, hiring/layoffs, company founding, power and water |
| Weather | `systems/weather.ts` | hourly Markov chain, intensity ramps, wetness |
| City events & news | `systems/cityEvents.ts` | weekly event schedule (markets, concerts, lectures, conferences), attendance, news derived from congestion, power, economy, weather |
| Workforce | `systems/workforce.ts` | projects, task dependency graphs, role assignment, progress only while working in place, activity stream, pluggable `TaskExecutor` |
| Planner | `systems/planner.ts` | template Master Planner (startup, software, research, marketing, security, education, finance), plan validation |

## Citizen day (example)

```
06:4x  wake (AT_HOME)          → 07:4x leave for work (WALKING / TRAVELING by car, taxi or bus)
08:xx  WORKING                  → 12:xx lunch at a nearby open café (EATING, pays § to the business)
13:xx  WORKING                  → 17:xx park / shop / leisure / event (RESTING, SHOPPING, SOCIALIZING)
19:xx  home (AT_HOME)           → 23:xx SLEEPING
```

Needs (energy, satiety, social, fun) override the schedule: a hungry citizen goes to eat, an exhausted one goes home.

## Traffic signal phases

`0` group-0 green · `1` group-0 yellow · `2` all red · `3` group-1 green · `4` group-1 yellow · `5` all red. Group 0 holds the approaches aligned with the highest-ranked road through the junction. Pedestrians cross an approach only while the *other* group has green.
