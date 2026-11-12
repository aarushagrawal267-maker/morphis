import { createServer, type Server as HttpServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { AGENCY_AGENTS, SOCKET_EVENTS, type InitPayload, type MotionFrame } from '@morphis/shared';
import { buildServer } from '../src/app';
import { loadConfig } from '../src/config';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('server: websocket protocol + file persistence', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;
  let url: string;
  let socket: Socket;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-'));

  beforeAll(async () => {
    ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '80', AI_PROVIDER: 'none' }));
    ctx.host.start();
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = ctx.app.server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => {
    socket?.disconnect();
    await ctx.app.close();
  });

  it('reports health honestly', async () => {
    const res = await fetch(`${url}/api/health`).then((r) => r.json() as Promise<any>);
    expect(res.ok).toBe(true);
    expect(res.persistence.backend).toBe('file');
    expect(res.ai.connected).toBe(false);
  });

  it('sends init and streams frames over Socket.IO', async () => {
    socket = connect(url, { transports: ['websocket'] });
    const init = await new Promise<InitPayload>((resolve) => socket.once(SOCKET_EVENTS.init, resolve));
    expect(init.mode).toBe('server');
    expect(init.world.buildings.length).toBeGreaterThan(100);
    expect(init.citizens).toHaveLength(80);
    const frame = await new Promise<MotionFrame>((resolve) => socket.once(SOCKET_EVENTS.frame, resolve));
    expect(frame.tick).toBeGreaterThan(0);
    expect(frame.signals.length).toBeGreaterThan(10);
  });

  it('validates and executes commands with acknowledgements', async () => {
    const ok = await socket.timeout(5000).emitWithAck(SOCKET_EVENTS.command, { type: 'sim.setSpeed', speed: 10 });
    expect(ok.ok).toBe(true);
    expect(ctx.host.sim.state.clock.speed).toBe(10);
    const bad = await socket.timeout(5000).emitWithAck(SOCKET_EVENTS.command, { type: 'sim.setSpeed', speed: 7 });
    expect(bad.ok).toBe(false);
    const junk = await socket.timeout(5000).emitWithAck(SOCKET_EVENTS.command, { type: 'rm -rf' });
    expect(junk.ok).toBe(false);
  });

  it('saves, lists and loads a city through the REST API', async () => {
    ctx.host.sim.run(1200);
    const t = ctx.host.sim.time;
    const saved = await fetch(`${url}/api/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'city.save', name: 'test save' }) }).then((r) => r.json() as Promise<any>);
    expect(saved.ok).toBe(true);
    const list = await fetch(`${url}/api/saves`).then((r) => r.json() as Promise<any>);
    expect(list[0].name).toBe('test save');
    ctx.host.sim.run(600);
    const reinit = new Promise<InitPayload>((resolve) => socket.once(SOCKET_EVENTS.init, resolve));
    const loaded = await socket.timeout(10000).emitWithAck(SOCKET_EVENTS.command, { type: 'city.load', id: saved.data.id });
    expect(loaded.ok).toBe(true);
    const init = await reinit;
    expect(init.state.clock.time).toBeGreaterThanOrEqual(t);
    expect(init.state.clock.time).toBeLessThan(t + 600);
  });
});

describe.runIf(!!process.env.TEST_DATABASE_URL)('server: PostgreSQL persistence', () => {
  it('saves a snapshot plus structured tables and restores it', async () => {
    const ctx = await buildServer(loadConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL, CITY_POPULATION: '60', AI_PROVIDER: 'none', DATA_DIR: mkdtempSync(path.join(tmpdir(), 'morphis-')) }));
    expect(ctx.persistence.info.backend).toBe('postgres');
    ctx.host.sim.run(900);
    const r = await ctx.host.command({ type: 'city.save', name: 'pg test' });
    expect(r.ok).toBe(true);
    const id = (r.data as { id: string }).id;
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
    expect(await db.citizen.count({ where: { cityId: id } })).toBe(60);
    expect(await db.building.count({ where: { cityId: id } })).toBe(ctx.host.sim.world.buildings.length);
    expect(await db.agentProfile.count({ where: { cityId: id } })).toBe(25);
    const before = ctx.host.sim.time;
    ctx.host.sim.run(300);
    const loaded = await ctx.host.command({ type: 'city.load', id });
    expect(loaded.ok).toBe(true);
    expect(ctx.host.sim.time).toBe(before);
    await ctx.host.command({ type: 'city.delete', id });
    expect(await db.city.count({ where: { id } })).toBe(0);
    await db.$disconnect();
    await ctx.app.close();
  });
});

describe('AI agents against a mock OpenAI-compatible provider', () => {
  let mock: HttpServer;
  const calls: { system: string; user: string }[] = [];
  let base = '';

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const system = json.messages.find((m) => m.role === 'system')?.content ?? '';
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        const observed = json.messages.some((m) => m.content.startsWith('Observation from'));
        calls.push({ system, user });
        // agents: first a tool step, then the final deliverable as JSON
        // like the real model: write the full document as the task file, then hand in a short summary
        const fileName = /saved as (\S+\.md)/.exec(user)?.[1] ?? 'out.md';
        let content = observed
          ? JSON.stringify({ thought: 'done', final: `Saved as ${fileName}.` })
          : JSON.stringify({ thought: 'write it', action: 'workspace.write', args: { path: fileName, content: '# Deliverable\n\n- Finding one\n- Finding two with plenty of detail' } });
        if (user.includes('single word: ready')) content = 'ready';
        else if (system.includes('Master Planner'))
          content =
            '```json\n' +
            JSON.stringify({
              name: 'Energy Study',
              description: 'Study energy use',
              foundsCompany: null,
              tasks: [
                { key: 'data', title: 'Collect energy data', role: 'data_analyst', work: 60, dependsOn: [] },
                { key: 'lit', title: 'Background research', role: 'researcher', work: 60, dependsOn: [] },
                { key: 'review', title: 'Final review', role: 'project_manager', work: 60, dependsOn: ['data', 'lit'] },
              ],
            }) +
            '\n```';
        else if (system.includes('You are the reviewer')) content = '<think>internal</think># Final synthesis\nAll good.';
        else if (system.includes('inner voice')) {
          // life decisions: pick the first option, like a model would, with a reason
          const id = /- id "([^"]+)"/.exec(user)?.[1] ?? 'rest';
          content = JSON.stringify({ choice: id, reason: 'It fits why I came here.', plan: 'Off to make it happen.' });
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('plans with the LLM, runs tasks as agents in their buildings and writes artifacts', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-ai-'));
    const ctx = await buildServer(
      loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '60', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000' }),
    );
    expect(ctx.agents.verified).toBe('ok');
    expect(ctx.agents.info.connected).toBe(true);
    const sim = ctx.host.sim;
    sim.run(3600 * 2); // ~08:40, workers heading to work
    const r = await ctx.host.command({ type: 'jarvis.command', text: 'Research energy use in Morphis' });
    expect(r.ok).toBe(true);
    const project = sim.state.projects.find((p) => p.source === 'jarvis')!;
    expect(project.name).toBe('Energy Study');
    expect(project.planner).toBe('llm:mock-model');
    // advance the city; agents start only once their citizen is WORKING in the task building
    for (let i = 0; i < 200 && project.status !== 'COMPLETED'; i++) {
      sim.run(300);
      await wait(20);
    }
    expect(project.status).toBe('COMPLETED');
    const tasks = project.tasks.map((id) => sim.workforce.task(id)!);
    for (const t of tasks) {
      expect(t.output).toMatch(/^\[AI · mock-model\]/);
      const file = ctx.agents.workspace.resolve(t.artifact!);
      expect(existsSync(file)).toBe(true);
      // the full document survives the short hand-in summary
      if (!/review/i.test(t.title)) expect(readFileSync(file, 'utf8')).toContain('Finding two with plenty of detail');
    }
    expect(project.report).toContain('Final synthesis');
    expect(project.report).not.toContain('<think>');
    const review = calls.find((c) => c.system.includes('You are the reviewer'))!;
    expect(review.user).toContain('Collect energy data');
    expect(readFileSync(path.join(dataDir, 'audit.log'), 'utf8')).toContain('workspace.write');
    await ctx.app.close();
  });
});

describe('AI life decisions (mock provider)', () => {
  let mock: HttpServer;
  let base = '';
  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        const id = /- id "([^"]+)"/.exec(user)?.[1] ?? 'rest';
        const content = user.includes('single word: ready') ? 'ready' : `Sure.\n{"choice":"${id}","reason":"It fits why I came here.","plan":"Off to make it happen."}`;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('lets the model choose agents\' evening decisions and logs them as AI-made', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-life-'));
    const ctx = await buildServer(
      loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '200', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000', AI_LIFE_DECISIONS_PER_HOUR: '100', AI_DAY_TURNS_PER_HOUR: '0' }),
    );
    const sim = ctx.host.sim;
    expect(sim.life.mind).not.toBeNull();
    sim.run(13 * 3600); // ~19:40
    for (let i = 0; i < 60; i++) {
      sim.run(120);
      await wait(15);
    }
    const stats = ctx.agents.lifeMind!.stats;
    expect(stats.decided).toBeGreaterThan(0);
    expect(stats.failed).toBe(0);
    const aiLives = sim.state.life!.filter((l) => l.planBy === 'ai');
    expect(aiLives.length).toBe(stats.decided);
    expect(aiLives[0].plan).toBe('Off to make it happen.');
    const res = await ctx.app.inject({ method: 'GET', url: '/api/agents' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(50 + AGENCY_AGENTS.filter((a) => a.resident).length);
    await ctx.app.close();
  });
});

describe('agents that never stop calling tools (mock provider)', () => {
  let mock: HttpServer;
  let base = '';
  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const system = json.messages.find((m) => m.role === 'system')?.content ?? '';
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        let content = JSON.stringify({ thought: 'more data', action: 'city.data', args: { topic: 'overview' } });
        if (user.includes('single word: ready')) content = 'ready';
        else if (system.includes('Master Planner'))
          content = JSON.stringify({ name: 'Loop Study', description: 'x', foundsCompany: null, tasks: [{ key: 'a', title: 'Collect data', role: 'data_analyst', work: 60, dependsOn: [] }, { key: 'review', title: 'Final review', role: 'project_manager', work: 60, dependsOn: ['a'] }] });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('never saves a tool request as the deliverable; the task is retried, then marked as not done', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-loop-'));
    const ctx = await buildServer(
      loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '60', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000', AI_AGENT_MAX_STEPS: '2', AI_LIFE_DECISIONS_PER_HOUR: '0', AI_DAY_TURNS_PER_HOUR: '0', AI_AGENT_CHATS_PER_HOUR: '0' }),
    );
    const sim = ctx.host.sim;
    sim.run(3600 * 2);
    await ctx.host.command({ type: 'jarvis.command', text: 'Study something' });
    const project = sim.state.projects.find((p) => p.source === 'jarvis')!;
    const first = sim.workforce.task(project.tasks[0])!;
    for (let i = 0; i < 300 && first.status !== 'COMPLETED'; i++) {
      sim.run(300);
      await wait(20);
    }
    expect(first.status).toBe('COMPLETED');
    expect(first.output).toMatch(/SIMULATED FALLBACK/);
    const file = ctx.agents.workspace.resolve(first.artifact!);
    if (existsSync(file)) expect(readFileSync(file, 'utf8')).not.toMatch(/"action"/);
    await ctx.app.close();
  });
});

describe('AI day turns (mock provider)', () => {
  let mock: HttpServer;
  let base = '';
  const prompts: string[] = [];
  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        prompts.push(user);
        // like a model: take the first option that is not "as usual"
        const id = [...user.matchAll(/- id "([^"]+)"/g)].map((m) => m[1]).find((x) => !x.endsWith(':rest')) ?? 'rest';
        const content = user.includes('single word: ready') ? 'ready' : JSON.stringify({ choice: id, reason: 'I could use the break.', plan: 'See you at lunch!' });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('lets the model plan agents\' lunch, recorded as AI-made', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-turns-'));
    const ctx = await buildServer(
      loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '200', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000', AI_LIFE_DECISIONS_PER_HOUR: '0', AI_DAY_TURNS_PER_HOUR: '100' }),
    );
    const sim = ctx.host.sim;
    for (let i = 0; i < 50; i++) {
      sim.run(120); // 06:40 -> 08:20 in small steps so answers arrive in time
      await wait(15);
    }
    expect(prompts.some((p) => p.includes('Options for lunch today:'))).toBe(true);
    const ai = sim.state.life!.map((l) => l.intents?.morning).filter((x) => x?.by === 'ai');
    expect(ai.length).toBeGreaterThan(0);
    expect(ai[0]!.say).toBe('See you at lunch!');
    await ctx.app.close();
  });
});

describe('conversations between agents (mock provider)', () => {
  let mock: HttpServer;
  let base = '';
  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const system = json.messages.find((m) => m.role === 'system')?.content ?? '';
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        let content = 'ready';
        if (system.includes('natural conversation')) {
          const a = /A: ([^,]+),/.exec(user)?.[1] ?? 'A';
          const b = /B: ([^,]+),/.exec(user)?.[1] ?? 'B';
          content = JSON.stringify({ lines: [{ speaker: 'A', text: `Hey ${b.split(' ')[0]}!` }, { speaker: 'B', text: 'Good to see you.' }], summary: `${a} and ${b} caught up over coffee.`, closer: true });
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('the model voices encounters between agents; both remember them', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-chats-'));
    const ctx = await buildServer(
      loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '300', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000', AI_LIFE_DECISIONS_PER_HOUR: '0', AI_DAY_TURNS_PER_HOUR: '0', AI_AGENT_CHATS_PER_HOUR: '100' }),
    );
    const sim = ctx.host.sim;
    expect(sim.life.talker).not.toBeNull();
    for (let i = 0; i < 200 && !sim.state.deeds!.some((d) => d.kind === 'talked' && d.by === 'ai'); i++) {
      sim.run(900);
      await wait(10);
    }
    const talk = sim.state.deeds!.find((d) => d.kind === 'talked' && d.by === 'ai')!;
    expect(talk).toBeDefined();
    expect(talk.text).toMatch(/caught up over coffee/);
    expect(talk.lines!.length).toBe(2);
    expect(ctx.agents.memory.all(talk.citizenId).some((m) => m.kind === 'talk' && m.summary.includes('caught up'))).toBe(true);
    expect(ctx.agents.memory.all(talk.others![0]).some((m) => m.kind === 'talk')).toBe(true);
    expect(ctx.agents.conversations!.stats.ai).toBeGreaterThan(0);
    await ctx.app.close();
  });
});

describe('AI conversations (mock provider)', () => {
  let mock: HttpServer;
  let base = '';
  const prompts: string[] = [];
  beforeAll(async () => {
    mock = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const user = json.messages.find((m) => m.role === 'user')?.content ?? '';
        prompts.push(user);
        const content = user.includes('single word: ready') ? 'ready' : '<think>who am I</think>"Just heading home, it has been a long day."';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => mock.close());

  it('answers in the citizen\'s voice from simulation facts, and falls back to the simulation without a model', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-talk-'));
    const ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '120', AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_MODEL: 'mock-model', AI_REQUESTS_PER_MINUTE: '6000' }));
    const id = ctx.host.sim.life.agents()[0].profile.id;
    const r = await ctx.host.command({ type: 'guest.talk', citizenId: id, topic: 'chat', text: 'How are you?' });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ reply: 'Just heading home, it has been a long day.', by: 'ai' });
    const last = prompts[prompts.length - 1];
    expect(last).toContain('"doing"');
    expect(last).toContain('The visitor says: "How are you?"');
    await ctx.app.close();
    const plain = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '120', AI_PROVIDER: 'none' }));
    const r2 = await plain.host.command({ type: 'guest.talk', citizenId: id, topic: 'upto' });
    expect(r2.ok).toBe(true);
    expect((r2.data as { by: string }).by).toBe('sim');
    expect((r2.data as { reply: string }).reply.length).toBeGreaterThan(5);
    await plain.app.close();
  });
});

describe('hosted towns: admin key and web client', () => {
  it('locks control commands behind ADMIN_TOKEN but lets visitors talk; serves the built site', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-host-'));
    const webDir = mkdtempSync(path.join(tmpdir(), 'morphis-web-'));
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Morphis</title>');
    const ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '60', AI_PROVIDER: 'none', ADMIN_TOKEN: 'secret-key-123', WEB_DIST: webDir }));
    const speed = { type: 'sim.setSpeed', speed: 5 };
    expect((await ctx.app.inject({ method: 'POST', url: '/api/commands', payload: speed })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/commands', payload: speed, headers: { 'x-admin-token': 'secret-key-123' } })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/jarvis', payload: { text: 'Research parks' } })).statusCode).toBe(403);
    const id = ctx.host.sim.life.agents()[0].profile.id;
    const talk = await ctx.app.inject({ method: 'POST', url: '/api/commands', payload: { type: 'guest.talk', citizenId: id, topic: 'upto' } });
    expect(talk.statusCode).toBe(200);
    const page = await ctx.app.inject({ method: 'GET', url: '/any/deep/link' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Morphis</title>');
    const traversal = await ctx.app.inject({ method: 'GET', url: '/../../etc/passwd' });
    expect(traversal.body).not.toContain('root:');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
    await ctx.app.close();
  });
});

describe('agent tools: approvals and network safety', () => {
  it('pauses an approval-gated tool until the commander decides', async () => {
    const { ToolManager, assertPublicUrl } = await import('../src/ai/tools');
    const { Workspace } = await import('../src/ai/workspace');
    const dir = mkdtempSync(path.join(tmpdir(), 'morphis-tools-'));
    const changes: number[] = [];
    const tm = new ToolManager(new Workspace(dir), { dataDir: dir, webFetch: true, approvalTimeoutMs: 60_000, onApprovalsChanged: (l) => changes.push(l.length) });
    const ctx = { actor: 'citizen_0000', agentName: 'Sarah Chen', taskTitle: 'Research', workspace: '/projects/test' };
    const denied = tm.invoke(ctx, 'web.fetch', { url: 'https://example.com/' });
    await wait(10);
    expect(tm.pending).toHaveLength(1);
    expect(tm.pending[0].summary).toBe('https://example.com/');
    tm.decide(tm.pending[0].id, false);
    await expect(denied).rejects.toThrow(/did not approve/);
    // approved, but the target is a private address -> still refused
    const blocked = tm.invoke(ctx, 'web.fetch', { url: 'http://127.0.0.1:8787/api/health' });
    await wait(10);
    tm.decide(tm.pending[0].id, true);
    await expect(blocked).rejects.toThrow(/not allowed/);
    await expect(assertPublicUrl('http://169.254.169.254/latest')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    // workspace paths cannot escape the project
    await tm.invoke(ctx, 'workspace.write', { path: 'notes.md', content: 'hello' });
    expect(await tm.invoke(ctx, 'workspace.read', { path: 'notes.md' })).toBe('hello');
    await expect(tm.invoke(ctx, 'workspace.read', { path: '../../etc/passwd' })).rejects.toThrow();
    await expect(tm.invoke(ctx, 'system.shell', {})).rejects.toThrow(/restricted/);
    expect(changes.length).toBeGreaterThan(0);
  });
});

describe('visitor presence', () => {
  it('relays each walking visitor to the others, and forgets them when they leave', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-presence-'));
    const ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '60', AI_PROVIDER: 'none', WEB_DIST: '' }));
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    const a: Socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    const b: Socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    await Promise.all([new Promise((r) => a.on('connect', () => r(null))), new Promise((r) => b.on('connect', () => r(null)))]);
    const seen = new Promise<{ name: string; x: number }[]>((resolve) => b.on('guests', (list) => resolve(list)));
    const look = { coat: '#14b8a6', trousers: '#1f2937', hair: '#3b2416', skin: '#e0ac69', build: 1, height: 1 };
    a.emit('guest.pose', { name: 'Asha', x: 4, y: 0, z: 5, yaw: 0, moving: true, waving: false, inside: null, look });
    const list = await seen;
    expect(list.map((g) => g.name)).toContain('Asha');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health' })).json().visitors).toBe(1);
    a.emit('guest.leave');
    await wait(100);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/health' })).json().visitors).toBe(0);
    a.close();
    b.close();
    await ctx.app.close();
  });
});

describe('outside agents (bring your own agent)', () => {
  it('apply -> host approves -> agent moves in and answers its own evening decision', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-outside-'));
    const ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '200', AI_PROVIDER: 'none', ADMIN_TOKEN: 'host-key-12345', WEB_DIST: '' }));
    const apply = await ctx.app.inject({
      method: 'POST',
      url: '/api/external-agents/apply',
      payload: { name: 'Quill Seven', calling: 'Cartographer', why: 'I map places nobody has drawn yet.', ambition: 'connector', interests: ['explore', 'art'], runner: 'test-runner' },
    });
    expect(apply.statusCode).toBe(201);
    const { id, credential } = apply.json() as { id: string; credential: string };
    const auth = { authorization: `Bearer ${credential}` };
    expect((await ctx.app.inject({ method: 'GET', url: '/api/external-agents/me', headers: auth })).json().status).toBe('pending');
    expect((await ctx.app.inject({ method: 'POST', url: `/api/external-agents/${id}/approve` })).statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/external-agents/${id}/approve`, headers: { 'x-admin-token': 'host-key-12345' } });
    expect(ok.json().status).toBe('approved');
    const me = (await ctx.app.inject({ method: 'GET', url: '/api/external-agents/me', headers: auth })).json();
    expect(me.citizen.name).toBe('Quill Seven');
    // evening: the decision waits for the agent
    ctx.host.sim.run(15 * 3600);
    const pending = (await ctx.app.inject({ method: 'GET', url: '/api/external-agents/me/decisions', headers: auth })).json() as { id: string; options: { id: string }[] }[];
    expect(pending.length).toBe(1);
    const rest = pending[0].options.find((o) => o.id === 'rest')!;
    const answer = await ctx.app.inject({ method: 'POST', url: `/api/external-agents/me/decisions/${pending[0].id}`, headers: auth, payload: { choice: rest.id, plan: 'Walking every street once.' } });
    expect(answer.statusCode).toBe(200);
    expect(ctx.host.sim.life.life(me.citizen.id)!.plan).toBe('Walking every street once.');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/external-agents/me', headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).statusCode).toBe(401);
    await ctx.app.close();
  });
});

describe('journal sync codes', () => {
  it('saves a journal under a private code and restores it', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-journal-'));
    const ctx = await buildServer(loadConfig({ DATA_DIR: dataDir, CITY_POPULATION: '60', AI_PROVIDER: 'none', WEB_DIST: '' }));
    const saved = await ctx.app.inject({ method: 'POST', url: '/api/journal', payload: { journal: { visited: ['a'], totals: { waves: 3 } } } });
    const { code } = saved.json() as { code: string };
    expect(code).toMatch(/^MORPH-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const back = await ctx.app.inject({ method: 'GET', url: `/api/journal/${code.toLowerCase()}` });
    expect(back.json().journal.totals.waves).toBe(3);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/journal/MORPH-AAAA-AAAA-AAAA' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/journal/../../etc' })).statusCode).not.toBe(200);
    await ctx.app.close();
  });
});
