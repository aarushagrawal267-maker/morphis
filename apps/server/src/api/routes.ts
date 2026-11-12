/** REST API (read access + commands). The same validation as the WebSocket channel. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { commandSchema } from '@morphis/shared';
import type { SimulationHost } from '../simulation/host';
import { LOCKED } from '../websocket/socket';

export function registerRoutes(app: FastifyInstance, host: SimulationHost): void {
  app.get('/api/health', async () => ({
    ok: true,
    mode: 'server',
    persistence: host.persistence.info,
    ai: host.agents.info,
    simTime: host.sim.time,
    population: host.sim.state.citizens.length,
    visitors: host.presence?.count ?? 0,
  }));

  app.get('/api/city', async () => {
    const s = host.sim;
    return {
      seed: s.world.seed,
      hash: s.world.hash,
      clock: s.state.clock,
      stats: s.stats(),
      economy: s.state.economy.summary,
      weather: s.state.weather,
      districts: s.world.districts.map((d) => ({ id: d.id, name: d.name, type: d.type })),
      buildings: s.world.buildings.length,
    };
  });

  app.get('/api/citizens', async () => host.sim.state.citizens.map((c) => ({ id: c.profile.id, name: c.profile.name, core: c.profile.core, role: c.profile.role, status: c.dyn.status })));

  app.get('/api/citizens/:id', async (req, reply) => {
    const c = host.sim.citizenById((req.params as { id: string }).id);
    if (!c) return reply.code(404).send({ error: 'not found' });
    return { profile: c.profile, state: c.dyn };
  });

  /** The 50 agents: persona, life (plan, venture, studies) and latest deeds. */
  app.get('/api/agents', async () =>
    host.sim.life.agents().map((c) => ({
      id: c.profile.id,
      name: c.profile.name,
      agent: c.profile.agent,
      status: c.dyn.status,
      life: host.sim.life.life(c.profile.id) ?? null,
    })),
  );

  app.get('/api/agents/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const c = host.sim.life.agents().find((x) => x.profile.agent?.slug === slug || x.profile.id === slug);
    if (!c) return reply.code(404).send({ error: 'not found' });
    const life = host.sim.life.life(c.profile.id) ?? null;
    return {
      profile: c.profile,
      state: c.dyn,
      life,
      venture: life?.ventureId ? host.sim.life.venture(life.ventureId) : null,
      deeds: host.sim.life.deedsOf(c.profile.id, 60),
    };
  });

  /** An agent's long-term memory: work, conversations and daily reflections (all from real town events). */
  app.get('/api/agents/:slug/memory', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const c = host.sim.life.agents().find((x) => x.profile.agent?.slug === slug || x.profile.id === slug);
    if (!c) return reply.code(404).send({ error: 'not found' });
    return { citizenId: c.profile.id, name: c.profile.name, memories: host.agents.memory.all(c.profile.id) };
  });

  app.get('/api/ventures', async () => host.sim.life.ventures);

  app.get('/api/buildings/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      const b = host.sim.building(id);
      const rt = host.sim.state.buildings[b.index];
      return { building: b, state: rt.dyn, occupants: rt.occupants, business: host.sim.economy.byBuilding(id) ?? null };
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
  });

  app.get('/api/projects', async () => ({ projects: host.sim.state.projects, tasks: host.sim.state.tasks }));

  app.get('/api/projects/:id/artifacts', async (req, reply) => {
    const p = host.sim.state.projects.find((x) => x.id === (req.params as { id: string }).id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    const files = await host.agents.workspace.list(p.workspace);
    const out: Record<string, string> = {};
    for (const f of files) out[f] = (await host.agents.workspace.read(`${p.workspace}/${f}`)) ?? '';
    return { workspace: p.workspace, files: out, report: p.report };
  });

  app.get('/api/ai/status', async () => host.agents.status());

  app.get('/api/saves', async () => host.persistence.list());

  app.post('/api/commands', async (req, reply) => {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') });
    if (!host.canRun(parsed.data, req.headers['x-admin-token'] as string | undefined)) return reply.code(403).send({ ok: false, error: LOCKED });
    const r = await host.command(parsed.data);
    return reply.code(r.ok ? 200 : 422).send(r);
  });

  app.post('/api/jarvis', async (req, reply) => {
    const body = z.object({ text: z.string().trim().min(3).max(500), urgent: z.boolean().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: 'text (3-500 chars) required' });
    if (!host.isAdmin(req.headers['x-admin-token'] as string | undefined)) return reply.code(403).send({ ok: false, error: LOCKED });
    const r = await host.command({ type: 'jarvis.command', text: body.data.text, urgent: body.data.urgent });
    return reply.code(r.ok ? 200 : 422).send(r);
  });
}
