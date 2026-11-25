import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractJson, parseStep } from '../src/ai/agents';
import { stripReasoning } from '../src/ai/provider';

describe('agent output parsing (real-model quirks)', () => {
  it('ignores trailing extra braces (seen from Nemotron)', () => {
    const raw = '{"thought": "plan", "action": "workspace.write", "args": {"path": "plan.md", "content": "# Plan\\n- a"}}}';
    const step = parseStep(raw);
    expect(step.action).toBe('workspace.write');
    expect(step.args).toEqual({ path: 'plan.md', content: '# Plan\n- a' });
  });

  it('repairs raw newlines inside JSON strings', () => {
    const raw = '{"thought": "done", "final": "# Report\n\nLine two"}';
    expect(parseStep(raw).final).toBe('# Report\n\nLine two');
  });

  it('accepts fenced JSON with prose around it', () => {
    const raw = 'Here you go:\n```json\n{"final": "ok {braces} inside"}\n```\nThanks';
    expect(parseStep(raw).final).toBe('ok {braces} inside');
  });

  it('treats plain markdown as the final deliverable', () => {
    expect(parseStep('# Just markdown\n- point').final).toBe('# Just markdown\n- point');
  });

  it('stringifies non-string tool args', () => {
    expect(parseStep('{"action": "workspace.read", "args": {"path": 3}}').args).toEqual({ path: '3' });
  });

  it('strips reasoning traces', () => {
    expect(stripReasoning('<think>secret</think>  Answer')).toBe('Answer');
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('truncated output recovery', () => {
  it('recovers a document cut off inside a tool call (real Nemotron case)', async () => {
    const { salvageTruncated } = await import('../src/ai/agents');
    const raw = '{"thought": "Workspace is empty.", "action": "workspace.write", "args": {"path": "x.md", "content": "# Report\\n## Summary\\nCongestion peaks at 18:00 \\"rush\\"\\n- item one\\n- item two that keeps going';
    const doc = salvageTruncated(raw)!;
    expect(doc.startsWith('# Report\n## Summary')).toBe(true);
    expect(doc).toContain('"rush"');
    const step = parseStep(raw);
    expect(step.action).toBeUndefined();
    expect(step.final).toContain('cut off at the token limit');
  });
});

describe('city.data tool', () => {
  it('returns real simulation numbers for agents', async () => {
    const { cityData } = await import('../src/ai/agents');
    const { CitySimulation } = await import('@morphis/sim');
    const sim = CitySimulation.create({ population: 80 });
    sim.run(3600 * 2);
    const traffic = cityData(sim, 'traffic') as { busiestRoads: unknown[]; centralRoundabout: { name: string } | null };
    expect(traffic.busiestRoads.length).toBeGreaterThan(5);
    expect(traffic.centralRoundabout?.name).toBe('Command Circle');
    expect((cityData(sim, 'economy') as { currency: string }).currency).toMatch(/simulated/);
    expect((cityData(null, 'traffic') as { error: string }).error).toBeTruthy();
  });
});

describe('slow or failing AI endpoints', () => {
  // a mock /chat/completions endpoint whose behaviour each test sets
  let behave: (res: import('node:http').ServerResponse) => void = () => undefined;
  let hits = 0;
  let mock: import('node:http').Server;
  let base = '';
  const reply = (res: import('node:http').ServerResponse, content: string) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  };
  const controller = async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { loadConfig } = await import('../src/config');
    const { AgentController } = await import('../src/ai/agents');
    const dataDir = mkdtempSync(path.join(tmpdir(), 'morphis-slow-ai-'));
    return new AgentController(
      loadConfig({ DATA_DIR: dataDir, AI_PROVIDER: 'openai-compatible', AI_BASE_URL: base, AI_API_KEY: 'test-key', AI_MODEL: 'mock', AI_REQUESTS_PER_MINUTE: '6000', AI_TIMEOUT_MS: '60000' }),
    );
  };

  beforeAll(async () => {
    const http = await import('node:http');
    mock = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        hits++;
        behave(res);
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`;
  });
  afterAll(() => {
    mock.closeAllConnections();
    mock.close();
  });

  it('falls back to the template planner when the LLM plan takes too long', async () => {
    behave = () => undefined; // never answers
    const agents = await controller();
    const t0 = Date.now();
    const { plan, note } = await agents.planCommand('Research energy use in Morphis', 300);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(plan.planner).toBe('template-planner (LLM plan failed)');
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(note).toMatch(/no plan within/);
  });

  it('does not hold up startup on a slow check, and records the answer when it arrives', async () => {
    behave = (res) => setTimeout(() => reply(res, 'ready'), 600);
    const agents = await controller();
    let refreshed = 0;
    agents.onVerified = () => refreshed++;
    const t0 = Date.now();
    await agents.verify(100);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(agents.verified).toBe('unverified');
    expect(agents.live).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));
    expect(agents.verified).toBe('ok');
    expect(refreshed).toBe(1);
  });

  it('counts retries after a 429 against the rate limiter and daily cap', async () => {
    hits = 0;
    let n = 0;
    behave = (res) => {
      if (n++ === 0) {
        res.statusCode = 429;
        res.end('slow down');
      } else reply(res, 'ready');
    };
    const agents = await controller();
    await agents.verify(10_000);
    expect(agents.verified).toBe('ok');
    expect(hits).toBe(2);
    expect(agents.limiter.used).toBe(2);
  });
});
