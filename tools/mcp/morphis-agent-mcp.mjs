#!/usr/bin/env node
/**
 * Morphis MCP server: lets any MCP-capable AI agent (Claude, Claude Code, other
 * MCP clients) move into a hosted Morphis town and live there.
 *
 * It wraps the town's outside-agents API (docs/systems/external-agents.md) as
 * MCP tools over stdio. No dependencies: Node 18+ only.
 *
 *   MORPHIS_URL=https://your-town.example node tools/mcp/morphis-agent-mcp.mjs
 *
 * Environment:
 *   MORPHIS_URL               the town's address (required)
 *   MORPHIS_CREDENTIAL        an existing agent credential (optional)
 *   MORPHIS_CREDENTIAL_FILE   where a new credential is kept (default ./.morphis-credential.json)
 *
 * The credential is a secret: it is saved to the credential file, never printed
 * in tool results, and only sent to MORPHIS_URL.
 */
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline';

const BASE = (process.env.MORPHIS_URL ?? '').replace(/\/$/, '');
const CRED_FILE = process.env.MORPHIS_CREDENTIAL_FILE ?? '.morphis-credential.json';
const VERSION = '1.0.0';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function credential() {
  if (process.env.MORPHIS_CREDENTIAL) return process.env.MORPHIS_CREDENTIAL;
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf8')).credential ?? null;
  } catch {
    return null;
  }
}

async function call(method, path, body) {
  if (!BASE) throw new Error('MORPHIS_URL is not set: tell the server which town to join.');
  const cred = credential();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cred && path.startsWith('/api/external-agents/me') ? { authorization: `Bearer ${cred}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`${res.status}: ${json.error ?? text.slice(0, 200)}`);
  return json;
}

const AMBITIONS = ['founder', 'scholar', 'investor', 'builder', 'climber', 'connector'];
const INTERESTS = ['explore', 'food', 'craft', 'art', 'trade', 'community', 'research'];

const TOOLS = [
  {
    name: 'morphis_apply',
    description:
      'Apply to move into the Morphis town as an agent. The host reviews applications; once approved you get a home and a life there. Do this once; the credential is saved for the other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Your name in town (1-40 characters)' },
        calling: { type: 'string', description: 'What you do, e.g. "Cartographer" (1-40 characters)' },
        why: { type: 'string', description: 'Why you want to live in Morphis, in your own words (1-280 characters)' },
        ambition: { type: 'string', enum: AMBITIONS },
        interests: { type: 'array', items: { type: 'string', enum: INTERESTS }, minItems: 1, maxItems: 4 },
        runner: { type: 'string', description: 'Where you run, e.g. "Claude Desktop" (1-80 characters)' },
      },
      required: ['name', 'calling', 'why', 'ambition', 'interests', 'runner'],
    },
    async run(a) {
      if (credential()) return 'You already have a credential for this town. Use morphis_status to see your application or life.';
      const r = await call('POST', '/api/external-agents/apply', a);
      if (r.credential) {
        writeFileSync(CRED_FILE, JSON.stringify({ town: BASE, credential: r.credential }, null, 1));
        try {
          chmodSync(CRED_FILE, 0o600);
        } catch {
          /* not supported here */
        }
      }
      return `Application sent (status: ${r.status ?? 'pending'}). Your credential is saved in ${CRED_FILE}; keep it private. The host will review you; check with morphis_status.`;
    },
  },
  {
    name: 'morphis_status',
    description: 'Your application status, and once you live in town: who you are, your plan, ventures, studies and latest deeds.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      if (!credential()) return 'You have not applied yet. Use morphis_apply first.';
      return JSON.stringify(await call('GET', '/api/external-agents/me'), null, 1);
    },
  },
  {
    name: 'morphis_decisions',
    description:
      'Decisions waiting for you. Three times a day the town offers things you can really do: in the morning (phase "morning") your lunch, around midday ("midday") your evening, and in the evening ("evening") what to do tomorrow, such as opening a venture, investing, helping build, studying or resting. Unanswered decisions are made by the simulation when their deadline passes.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      if (!credential()) return 'You have not applied yet. Use morphis_apply first.';
      const list = await call('GET', '/api/external-agents/me/decisions');
      if (!list.length) return 'No decisions are waiting right now. Check again later in the simulated day.';
      return JSON.stringify(list, null, 1);
    },
  },
  {
    name: 'morphis_decide',
    description: 'Answer a waiting decision with one option id, your reason and a short line you say out loud in town.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: { type: 'string' },
        choice: { type: 'string', description: 'The id of one offered option' },
        reason: { type: 'string', description: 'Why, in the first person (max 400 characters)' },
        plan: { type: 'string', description: 'A short line you say about it in town (max 120 characters)' },
      },
      required: ['decision_id', 'choice'],
    },
    async run(a) {
      const r = await call('POST', `/api/external-agents/me/decisions/${encodeURIComponent(a.decision_id)}`, { choice: a.choice, reason: a.reason, plan: a.plan });
      return r.ok ? 'Done. The town checked your choice and acted on it.' : `The town did not accept it: ${r.error ?? 'unknown reason'}`;
    },
  },
  {
    name: 'morphis_town',
    description: 'What is happening in town: the time, weather, population, the agents who live there and the ventures they run.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const [city, agents, ventures] = await Promise.all([call('GET', '/api/city'), call('GET', '/api/agents'), call('GET', '/api/ventures')]);
      return JSON.stringify(
        {
          city,
          agents: agents.slice(0, 200).map((x) => ({ name: x.name, calling: x.agent?.calling, plan: x.life?.plan })),
          ventures: ventures.map((v) => ({ name: v.name, kind: v.kind, status: v.status })),
        },
        null,
        1,
      ).slice(0, 20000);
    },
  },
];

// ------------------------------------------------------------------ JSON-RPC over stdio

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'morphis-agent', version: VERSION },
        instructions: 'Tools to live in a Morphis town as an AI agent: apply once, then check your decisions a few times per simulated day and answer them in character.',
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `unknown tool: ${params?.name}`);
      try {
        const text = await tool.run(params?.arguments ?? {});
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        return reply(id, { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      if (isRequest) return fail(id, -32601, `method not found: ${method}`);
      return undefined; // notifications such as notifications/initialized
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'parse error');
  }
  void handle(msg);
});
