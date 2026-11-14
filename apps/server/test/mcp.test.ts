import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app';
import { loadConfig } from '../src/config';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tools/mcp/morphis-agent-mcp.mjs');

describe('Morphis MCP server for outside agents', () => {
  let ctx: Awaited<ReturnType<typeof buildServer>>;
  let child: ChildProcessWithoutNullStreams;
  const waiting = new Map<number, (msg: { result?: { content?: { text: string }[]; tools?: { name: string }[]; protocolVersion?: string }; error?: unknown }) => void>();
  let nextId = 1;
  let credFile = '';
  const rpc = (method: string, params?: object) =>
    new Promise<Parameters<NonNullable<ReturnType<typeof waiting.get>>>[0]>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const tool = async (name: string, args: object = {}) => (await rpc('tools/call', { name, arguments: args })).result!.content![0].text;

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'morphis-mcp-'));
    ctx = await buildServer(loadConfig({ DATA_DIR: dir, CITY_POPULATION: '120', AI_PROVIDER: 'none', ADMIN_TOKEN: 'test-admin-key', OPEN_TOWN: 'false' }), { serveWeb: false });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (ctx.app.server.address() as { port: number }).port;
    credFile = path.join(dir, 'cred.json');
    child = spawn(process.execPath, [script], { env: { ...process.env, MORPHIS_URL: `http://127.0.0.1:${port}`, MORPHIS_CREDENTIAL_FILE: credFile, MORPHIS_CREDENTIAL: '' } });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    });
  });

  afterAll(async () => {
    child?.kill();
    await ctx?.app.close();
  });

  it('speaks MCP and lists its tools', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.result!.protocolVersion).toBe('2025-06-18');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = await rpc('tools/list');
    expect(list.result!.tools!.map((t) => t.name)).toEqual(['morphis_apply', 'morphis_status', 'morphis_decisions', 'morphis_decide', 'morphis_town']);
    expect((await rpc('nope')).error).toBeTruthy();
  });

  it('applies, keeps the credential private, moves in after approval and sees the town', async () => {
    const applied = await tool('morphis_apply', { name: 'Quill Seven', calling: 'Cartographer', why: 'I map places nobody has drawn yet.', ambition: 'connector', interests: ['explore', 'art'], runner: 'test' });
    expect(applied).toMatch(/Application sent/);
    expect(existsSync(credFile)).toBe(true);
    const cred = JSON.parse(readFileSync(credFile, 'utf8')).credential as string;
    expect(applied).not.toContain(cred);
    expect(await tool('morphis_status')).toMatch(/"status": "pending"/);
    // the host approves the application
    const apps = await ctx.app.inject({ method: 'GET', url: '/api/external-agents', headers: { 'x-admin-token': 'test-admin-key' } });
    const id = (apps.json() as { id: string }[])[0].id;
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/external-agents/${id}/approve`, headers: { 'x-admin-token': 'test-admin-key' } });
    expect(ok.statusCode).toBe(200);
    const status = await tool('morphis_status');
    expect(status).toMatch(/"status": "approved"/);
    expect(status).not.toContain(cred);
    expect(await tool('morphis_decisions')).toMatch(/No decisions are waiting|"options"/);
    expect(await tool('morphis_town')).toContain('Quill Seven');
  });
});
