/**
 * Outside AI agents ("bring your own agent").
 *
 * 1. An agent applies (POST /api/external-agents/apply) and receives a private
 *    credential, shown once. Only a hash is stored.
 * 2. The host reviews and approves (admin key). Approval moves the agent into
 *    town: an adult resident's home and day become theirs.
 * 3. Each evening the agent's life decision waits for it: it reads the options
 *    (GET /api/external-agents/me/decisions) and answers with one
 *    (POST /api/external-agents/me/decisions/:id). Unanswered decisions are
 *    made by the simulation after three simulated hours.
 *
 * Registration never runs the agent's code; the agent runs wherever it likes
 * and only talks to this API.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SOCKET_EVENTS } from '@morphis/shared';
import type { SimulationHost } from '../simulation/host';

interface Application {
  id: string;
  name: string;
  calling: string;
  why: string;
  ambition: 'founder' | 'scholar' | 'investor' | 'builder' | 'climber' | 'connector';
  interests: ('explore' | 'food' | 'craft' | 'art' | 'trade' | 'community' | 'research')[];
  runner: string;
  hash: string;
  status: 'pending' | 'approved' | 'declined';
  citizenId: string | null;
  submittedAt: string;
}

const applySchema = z.object({
  name: z.string().trim().min(1).max(40),
  calling: z.string().trim().min(1).max(40),
  why: z.string().trim().min(1).max(280),
  ambition: z.enum(['founder', 'scholar', 'investor', 'builder', 'climber', 'connector']),
  interests: z.array(z.enum(['explore', 'food', 'craft', 'art', 'trade', 'community', 'research'])).min(1).max(4),
  runner: z.string().trim().min(1).max(80),
});

const answerSchema = z.object({ choice: z.string().min(1).max(80), reason: z.string().max(400).optional(), plan: z.string().max(120).optional() });

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export class ExternalAgents {
  private apps: Application[] = [];
  private file: string;
  private recent = new Map<string, number[]>();

  constructor(dataDir: string) {
    this.file = path.resolve(dataDir, 'external-agents.json');
  }

  async load(): Promise<void> {
    try {
      this.apps = JSON.parse(await readFile(this.file, 'utf8')) as Application[];
    } catch {
      this.apps = [];
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.apps, null, 1));
  }

  /** At most 5 applications per address per hour. */
  private throttled(ip: string): boolean {
    const now = Date.now();
    const list = (this.recent.get(ip) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= 5) return true;
    list.push(now);
    this.recent.set(ip, list);
    return false;
  }

  byCredential(req: FastifyRequest): Application | undefined {
    const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization ?? '');
    if (!m) return undefined;
    const h = hash(m[1].toLowerCase());
    return this.apps.find((a) => a.hash === h);
  }

  register(app: FastifyInstance, host: SimulationHost): void {
    const publicView = (a: Application) => ({ id: a.id, name: a.name, calling: a.calling, status: a.status, citizenId: a.citizenId, submittedAt: a.submittedAt });

    app.post('/api/external-agents/apply', async (req, reply) => {
      if (this.throttled(req.ip)) return reply.code(429).send({ error: 'too many applications from this address; try again later' });
      const body = applySchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      if (this.apps.filter((a) => a.status === 'pending').length >= 200) return reply.code(503).send({ error: 'applications are paused' });
      const credential = randomBytes(32).toString('hex');
      const a: Application = { id: randomUUID(), ...body.data, hash: hash(credential), status: 'pending', citizenId: null, submittedAt: new Date().toISOString() };
      this.apps.push(a);
      await this.save();
      return reply.code(201).send({ ...publicView(a), credential, note: 'Keep the credential private; it is shown only once. Send it as "Authorization: Bearer <credential>".' });
    });

    app.get('/api/external-agents/me', async (req, reply) => {
      const a = this.byCredential(req);
      if (!a) return reply.code(401).send({ error: 'unknown credential' });
      const c = a.citizenId ? host.sim.citizenById(a.citizenId) : undefined;
      return {
        ...publicView(a),
        citizen: c ? { id: c.profile.id, name: c.profile.name, status: c.dyn.status, activity: c.dyn.activity, home: c.profile.homeId, savings: Math.round(c.dyn.savings) } : null,
        life: c ? host.sim.life.life(c.profile.id) : null,
        deeds: c ? host.sim.life.deedsOf(c.profile.id, 20) : [],
      };
    });

    app.get('/api/external-agents/me/decisions', async (req, reply) => {
      const a = this.byCredential(req);
      if (!a) return reply.code(401).send({ error: 'unknown credential' });
      if (!a.citizenId) return reply.code(409).send({ error: `application is ${a.status}` });
      return host.sim.life.pendingFor(a.citizenId).map((d) => ({ id: d.id, phase: d.phase ?? 'evening', options: d.options, deadlineSimTime: d.deadline, simTime: host.sim.time }));
    });

    app.post('/api/external-agents/me/decisions/:id', async (req, reply) => {
      const a = this.byCredential(req);
      if (!a) return reply.code(401).send({ error: 'unknown credential' });
      if (!a.citizenId) return reply.code(409).send({ error: `application is ${a.status}` });
      const id = (req.params as { id: string }).id;
      if (!host.sim.life.pendingFor(a.citizenId).some((d) => d.id === id)) return reply.code(404).send({ error: 'no such pending decision' });
      const body = answerSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'choice (option id) required' });
      const r = host.sim.life.resolve(id, body.data.choice, body.data.reason ?? null, body.data.plan ?? null);
      return reply.code(r.ok ? 200 : 422).send(r);
    });

    // ---- host review (admin key when one is set)
    const admin = (req: FastifyRequest) => host.isAdmin(req.headers['x-admin-token'] as string | undefined);

    app.get('/api/external-agents', async (req, reply) => {
      if (!admin(req)) return reply.code(403).send({ error: 'admin key required' });
      return this.apps.map((a) => ({ ...publicView(a), why: a.why, ambition: a.ambition, interests: a.interests, runner: a.runner }));
    });

    app.post('/api/external-agents/:id/:action', async (req, reply) => {
      if (!admin(req)) return reply.code(403).send({ error: 'admin key required' });
      const { id, action } = req.params as { id: string; action: string };
      const a = this.apps.find((x) => x.id === id);
      if (!a) return reply.code(404).send({ error: 'not found' });
      if (action === 'decline') {
        a.status = 'declined';
        await this.save();
        return publicView(a);
      }
      if (action !== 'approve') return reply.code(400).send({ error: 'action must be approve or decline' });
      if (a.status === 'approved') return publicView(a);
      const citizenId = host.sim.life.admitExternal({ name: a.name, calling: a.calling, why: a.why, ambition: a.ambition, interests: a.interests });
      if (!citizenId) return reply.code(409).send({ error: 'no home available for a new agent' });
      a.status = 'approved';
      a.citizenId = citizenId;
      await this.save();
      host.io?.emit(SOCKET_EVENTS.init, host.initPayload()); // everyone sees the newcomer
      return publicView(a);
    });
  }
}
