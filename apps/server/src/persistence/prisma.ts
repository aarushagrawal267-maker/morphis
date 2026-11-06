/**
 * PostgreSQL persistence through Prisma. A save writes the City row, an
 * authoritative SimulationSnapshot (full engine state as JSON) and mirrors the
 * city into structured tables for querying.
 */
import type { PrismaClient } from '@prisma/client';
import type { SaveSummary } from '@morphis/shared';
import type { CitySimulation, SaveData } from '@morphis/sim';
import type { PersistenceAdapter } from './types';

export class PrismaPersistence implements PersistenceAdapter {
  readonly info = { backend: 'postgres' as const, detail: 'PostgreSQL via Prisma (snapshots + structured city tables)' };

  constructor(private db: PrismaClient) {}

  static async connect(url: string): Promise<PrismaPersistence> {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
    return new PrismaPersistence(db);
  }

  async save(data: SaveData, extra: { population: number; sim?: CitySimulation }): Promise<SaveSummary> {
    const id = `city_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const st = data.state;
    await this.db.city.create({
      data: {
        id,
        name: data.name,
        seed: data.config.seed,
        config: data.config as object,
        worldHash: data.worldHash,
        simTime: st.clock.time,
        population: extra.population,
        snapshots: { create: { simTime: st.clock.time, tick: st.clock.tick, state: st as unknown as object } },
      },
    });
    if (extra.sim) await this.mirror(id, extra.sim);
    return { id, name: data.name, seed: data.config.seed, simTime: st.clock.time, savedAt: data.savedAt, population: extra.population, backend: 'postgres' };
  }

  /** Structured copy of the city for SQL access (districts, buildings, citizens, ...). */
  private async mirror(cityId: string, sim: CitySimulation): Promise<void> {
    const w = sim.world;
    const st = sim.state;
    await this.db.district.createMany({
      data: w.districts.map((d) => ({ cityId, id: d.id, name: d.name, type: d.type, center: d.center as object, radius: d.radius, color: d.color, data: { tagline: d.tagline, description: d.description } })),
    });
    await this.db.building.createMany({
      data: w.buildings.map((b, i) => ({
        cityId,
        id: b.id,
        name: b.name,
        type: b.type,
        districtId: b.districtId,
        x: b.position.x,
        z: b.position.z,
        height: b.height,
        capacity: b.capacity,
        jobs: b.jobs,
        status: st.buildings[i].dyn.status,
        occupants: st.buildings[i].occupants.length,
        energy: st.buildings[i].dyn.energyUsage,
        ownerId: st.buildings[i].dyn.ownerId,
      })),
    });
    await this.db.road.createMany({ data: w.roads.edges.map((e) => ({ cityId, id: e.id, a: e.a, b: e.b, cls: e.cls, name: e.name, length: e.length })) });
    await this.db.citizen.createMany({
      data: st.citizens.map((c) => ({
        cityId,
        id: c.profile.id,
        name: c.profile.name,
        age: c.profile.age,
        occupation: c.profile.occupation,
        department: c.profile.department,
        core: c.profile.core,
        role: c.profile.role,
        homeId: c.profile.homeId,
        workplaceId: c.profile.workplaceId,
        status: c.dyn.status,
        energy: c.dyn.energy,
        happiness: c.dyn.happiness,
        money: c.dyn.money,
        currentTask: c.dyn.currentTaskId,
        agentId: c.profile.agentId ?? null,
        profile: c.profile as unknown as object,
      })),
    });
    await this.db.business.createMany({
      data: st.businesses.map((b) => ({ cityId, id: b.id, name: b.name, type: b.type, category: b.category, buildingId: b.buildingId, employees: b.employees.length, revenue: b.revenue, expenses: b.expenses, cash: b.cash, status: b.operatingStatus })),
    });
    await this.db.project.createMany({
      data: st.projects.map((p) => ({ cityId, id: p.id, name: p.name, source: p.source, status: p.status, progress: p.progress, workspace: p.workspace, report: p.report, createdAt: p.createdAt, completedAt: p.completedAt })),
    });
    await this.db.task.createMany({
      data: st.tasks.map((t) => ({ cityId, id: t.id, projectId: t.projectId, title: t.title, role: t.role, assigneeId: t.assigneeId, status: t.status, progress: t.progress, output: t.output, artifact: t.artifact })),
    });
    await this.db.cityEventLog.createMany({
      data: st.news.map((n) => ({ cityId, id: n.id, time: n.time, category: n.category, headline: n.headline, body: n.body, severity: n.severity })),
      skipDuplicates: true,
    });
    await this.db.economyRecord.createMany({
      data: st.economy.summary.history.map((h) => ({ cityId, day: h.day, gdp: h.gdp, budget: h.budget, happiness: h.happiness, employed: h.employment })),
      skipDuplicates: true,
    });
    await this.db.agentProfile.createMany({
      data: st.citizens
        .filter((c) => c.profile.core)
        .map((c) => ({ cityId, citizenId: c.profile.id, role: c.profile.role ?? 'unknown', provider: null, model: null, memory: [] })),
    });
  }

  async list(): Promise<SaveSummary[]> {
    const rows = await this.db.city.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ id: r.id, name: r.name, seed: r.seed, simTime: r.simTime, savedAt: r.createdAt.toISOString(), population: r.population, backend: 'postgres' }));
  }

  async load(id: string): Promise<SaveData> {
    const city = await this.db.city.findUnique({ where: { id }, include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!city || !city.snapshots.length) throw new Error('save not found');
    return {
      format: 'morphis-save',
      version: 1,
      name: city.name,
      savedAt: city.createdAt.toISOString(),
      config: city.config as unknown as SaveData['config'],
      worldHash: city.worldHash,
      state: city.snapshots[0].state as unknown as SaveData['state'],
    };
  }

  async delete(id: string): Promise<void> {
    await this.db.city.delete({ where: { id } });
  }

  async audit(actor: string, action: string, detail: object, approved = true): Promise<void> {
    await this.db.auditLog.create({ data: { actor, action, detail, approved } });
  }

  async close(): Promise<void> {
    await this.db.$disconnect();
  }
}
