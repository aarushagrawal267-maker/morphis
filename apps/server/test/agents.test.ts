import { describe, expect, it } from 'vitest';
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
