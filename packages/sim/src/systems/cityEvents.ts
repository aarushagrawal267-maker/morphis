/**
 * City events (scheduled happenings that attract citizens) and the city news
 * feed. Every news item is derived from simulation state: traffic jams come
 * from stopped vehicles, power warnings from demand vs supply, etc.
 */
import type { BuildingDef, CityEvent, NewsCategory, NewsItem } from '@morphis/shared';
import { DAY_SECONDS, ROAD_CLASSES, dayOf, formatCredits, hourOf, weekdayOf } from '@morphis/shared';
import type { CitySimulation } from '../engine';

interface EventTemplate {
  name: string;
  kind: CityEvent['kind'];
  landmark: string;
  days: number[];
  start: number;
  hours: number;
}

const TEMPLATES: EventTemplate[] = [
  { name: 'Neon Night Market', kind: 'market', landmark: 'market', days: [3, 4, 5], start: 19, hours: 4 },
  { name: 'Synthwave Live', kind: 'concert', landmark: 'arena', days: [4, 5], start: 20, hours: 3.5 },
  { name: 'Open Lecture: Machine Minds', kind: 'lecture', landmark: 'university', days: [0, 2], start: 18, hours: 2 },
  { name: 'Morphis Tech Summit', kind: 'conference', landmark: 'corporate', days: [2], start: 10, hours: 6 },
  { name: 'Prism Design Exhibition', kind: 'exhibition', landmark: 'studio', days: [5, 6], start: 12, hours: 6 },
  { name: 'Holo-Ball Finals', kind: 'sports', landmark: 'arena', days: [6], start: 15, hours: 3 },
  { name: 'Park Concert', kind: 'concert', landmark: 'lumen_park', days: [6], start: 17, hours: 2.5 },
];

export class CityEventSystem {
  constructor(private sim: CitySimulation) {}

  /** Generate today's events (called at midnight and at start). */
  scheduleDay(): void {
    const sim = this.sim;
    const day = dayOf(sim.time);
    const wd = weekdayOf(sim.time);
    const dayStart = (day - 1) * DAY_SECONDS;
    for (const t of TEMPLATES) {
      if (!t.days.includes(wd)) continue;
      const b = sim.landmark(t.landmark);
      if (!b) continue;
      const id = `event_${day}_${t.landmark}`;
      if (sim.state.cityEvents.some((e) => e.id === id)) continue;
      sim.state.cityEvents.push({
        id,
        name: t.name,
        kind: t.kind,
        buildingId: b.id,
        start: dayStart + t.start * 3600,
        end: dayStart + (t.start + t.hours) * 3600,
        attendees: 0,
        capacity: b.capacity,
        status: 'SCHEDULED',
      });
    }
    // keep the list short
    sim.state.cityEvents = sim.state.cityEvents.filter((e) => e.end > sim.time - DAY_SECONDS);
  }

  /** Per sim-minute: advance event lifecycles. */
  minute(): void {
    const sim = this.sim;
    for (const e of sim.state.cityEvents) {
      if (e.status === 'SCHEDULED' && sim.time >= e.start) {
        e.status = 'LIVE';
        sim.bus.emit('city.event', sim.time, { event: e });
        this.news('event', `${e.name} is now live`, `${e.name} has opened at ${sim.building(e.buildingId).name}.`, 'info', e.buildingId);
      } else if (e.status === 'LIVE') {
        const occ = sim.state.buildings[sim.bIndex(e.buildingId)].occupants.length;
        e.attendees = Math.max(e.attendees, occ);
        if (sim.time >= e.end) {
          e.status = 'ENDED';
          sim.bus.emit('city.event', sim.time, { event: e });
          this.news('event', `${e.name} wraps up`, `Peak attendance: ${e.attendees} citizens.`, 'info', e.buildingId);
        }
      }
    }
  }

  /** A live (or soon starting) event close enough to attract a citizen. */
  attractiveEvent(here: BuildingDef): CityEvent | null {
    const sim = this.sim;
    let best: CityEvent | null = null;
    let bd = Infinity;
    for (const e of sim.state.cityEvents) {
      if (e.status === 'ENDED' || e.start - sim.time > 3600 || e.end < sim.time + 1800) continue;
      const b = sim.building(e.buildingId);
      const d = Math.hypot(b.position.x - here.position.x, b.position.z - here.position.z);
      if (d < bd && d < 200) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- news

  news(category: NewsCategory, headline: string, body: string, severity: NewsItem['severity'] = 'info', buildingId?: string): void {
    const sim = this.sim;
    const item: NewsItem = { id: sim.newId('news'), time: sim.time, category, headline, body, severity };
    if (buildingId) {
      const b = sim.building(buildingId);
      item.buildingId = buildingId;
      item.location = { ...b.position };
    }
    sim.state.news.push(item);
    if (sim.state.news.length > 120) sim.state.news.shift();
    sim.bus.emit('city.news', sim.time, { item });
  }

  private cooldown(key: string, seconds: number): boolean {
    const cd = this.sim.state.cooldowns;
    if ((cd[key] ?? -Infinity) > this.sim.time) return false;
    cd[key] = this.sim.time + seconds;
    return true;
  }

  /** Every 15 sim minutes: derive news from the state of the city. */
  monitor(): void {
    const sim = this.sim;
    const t = sim.traffic;
    const worst = t.worstEdge();
    if (worst.edge >= 0 && worst.stopped >= 5) {
      const e = sim.world.roads.edges[worst.edge];
      if (this.cooldown(`jam:${e.name}`, 3 * 3600)) {
        const a = sim.world.roads.nodes[e.a];
        const b = sim.world.roads.nodes[e.b];
        const item: NewsItem = {
          id: sim.newId('news'),
          time: sim.time,
          category: 'traffic',
          headline: `Congestion on ${e.name}`,
          body: `${worst.stopped} vehicles queued on this ${ROAD_CLASSES[e.cls].label.toLowerCase()} segment.`,
          severity: 'notice',
          location: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        };
        sim.state.news.push(item);
        sim.bus.emit('city.news', sim.time, { item });
      }
    }
    const r = sim.state.economy.summary.resources;
    if (r.powerSupply > 0 && r.powerDemand / r.powerSupply > 0.92 && this.cooldown('power', 6 * 3600)) {
      this.news('infrastructure', 'Power grid under strain', `Demand at ${Math.round((100 * r.powerDemand) / r.powerSupply)}% of supply. Helios Fusion Plant ramping output.`, 'warning', sim.landmark('fusion')?.id);
    }
    const h = hourOf(sim.time);
    if (h > 8 && h < 8.3 && this.cooldown('rush', 20 * 3600)) {
      const moving = sim.traffic.moving;
      this.news('transit', 'Morning rush hour', `${moving} vehicles on the road and ${sim.citizens.walkingCount()} citizens walking.`, 'info');
    }
  }

  economyReport(day: number, gdp: number, net: number): void {
    this.news(
      'economy',
      `Day ${day} closes: city output ${formatCredits(gdp)}`,
      `City budget ${net >= 0 ? 'surplus' : 'deficit'} of ${formatCredits(Math.abs(net))}. All figures are simulated credits.`,
      'info',
    );
  }
}
