import { describe, expect, it } from 'vitest';
import { AGENCY_AGENTS, rankAgency } from '@morphis/shared';
import { AgencyLibrary, PERSONA_MAX_CHARS, trimPersona } from '../src/ai/agency';
import { LlmMasterPlanner } from '../src/ai/agents';
import type { AiProvider, ChatMessage } from '../src/ai/provider';

describe('The Agency library', () => {
  const lib = new AgencyLibrary();

  it('finds the vendored persona files and their licence', () => {
    expect(lib.available).toBe(true);
    expect(AGENCY_AGENTS.length).toBeGreaterThan(250);
  });

  it('loads a persona without frontmatter and within the prompt budget', async () => {
    const id = 'engineering-frontend-developer';
    const text = (await lib.persona(id))!;
    expect(text).toBeTruthy();
    expect(text.startsWith('---')).toBe(false);
    expect(text).toMatch(/Frontend Developer/);
    expect(text.length).toBeLessThanOrEqual(PERSONA_MAX_CHARS + 80);
    expect(await lib.persona('not-a-real-agent')).toBeNull();
  });

  it('every catalogue entry has a readable persona file', async () => {
    for (const a of AGENCY_AGENTS) expect(await lib.persona(a.id), a.id).toBeTruthy();
  });

  it('cuts long playbooks at a heading', () => {
    const long = `---\nname: X\n---\n# X\n${'word '.repeat(900)}\n## Part two\n${'more '.repeat(900)}`;
    const t = trimPersona(long, 6000);
    expect(t.startsWith('# X')).toBe(true);
    expect(t).not.toContain('Part two');
    expect(t).toContain('omitted for length');
  });

  it('ranks clearly matching specialists first', () => {
    expect(rankAgency('Penetration tests of the payment system')[0].agent.id).toBe('security-penetration-tester');
    expect(rankAgency('Financial plan and cash flow forecast')[0].agent.id).toBe('finance-financial-analyst');
  });

  it('gives the planner every id, marking residents', () => {
    const roster = lib.plannerRoster('Run a marketing campaign');
    for (const a of AGENCY_AGENTS) expect(roster).toContain(a.resident ? `${a.id}*` : a.id);
    expect(roster).toContain('Best matches for this request');
  });
});

describe('planner hires specialists', () => {
  it('keeps known specialist ids from the model and drops invented ones', async () => {
    let prompt = '';
    const provider: AiProvider = {
      name: 'fake',
      model: 'fake-model',
      async complete(messages: ChatMessage[]) {
        prompt = messages[0].content;
        const text = JSON.stringify({
          name: 'Security audit',
          description: 'Audit',
          foundsCompany: null,
          tasks: [
            { key: 'pentest', title: 'Penetration test', role: 'security_analyst', specialist: 'security-penetration-tester', work: 120, dependsOn: [], description: 'x' },
            { key: 'made_up', title: 'Something', role: 'researcher', specialist: 'definitely-not-real', work: 90, dependsOn: [], description: 'y' },
            { key: 'review', title: 'Final review', role: 'project_manager', specialist: null, work: 60, dependsOn: ['pentest', 'made_up'], description: 'z' },
          ],
        });
        return { text, inputTokens: 1, outputTokens: 1, truncated: false };
      },
    };
    const { plan } = await new LlmMasterPlanner(provider, new AgencyLibrary()).plan('Audit the payment system security');
    expect(prompt).toContain('The Agency');
    expect(prompt).toContain('security-penetration-tester');
    expect(plan.tasks[0].specialist).toBe('security-penetration-tester');
    expect(plan.tasks[1].specialist).toBeUndefined();
    expect(plan.tasks[2].specialist).toBeUndefined();
  });
});

describe('cost controls', () => {
  it('counts requests and tokens per kind of AI work', async () => {
    const { UsageMeter } = await import('../src/ai/provider');
    const meter = new UsageMeter();
    const fake: AiProvider = { name: 'fake', model: 'm', complete: async () => ({ text: 'ok', inputTokens: 7, outputTokens: 3, truncated: false }) };
    const broken: AiProvider = { name: 'fake', model: 'm', complete: async () => Promise.reject(new Error('down')) };
    await meter.wrap(fake, 'chats').complete([]);
    await meter.wrap(fake, 'chats').complete([]);
    await expect(meter.wrap(broken, 'turns').complete([])).rejects.toThrow('down');
    expect(meter.byCategory.chats).toEqual({ requests: 2, inputTokens: 14, outputTokens: 6, failed: 0 });
    expect(meter.byCategory.turns.failed).toBe(1);
  });

  it('uses a lighter model for routine calls only when one is configured', async () => {
    const { createLightProvider, createProvider } = await import('../src/ai/provider');
    const { loadConfig } = await import('../src/config');
    const base = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://127.0.0.1:9/v1', AI_MODEL: 'big-model' };
    const a = loadConfig(base);
    const pa = createProvider(a);
    expect(createLightProvider(a, pa.provider, pa.limiter)).toBe(pa.provider);
    const b = loadConfig({ ...base, AI_MODEL_LIGHT: 'small-model' });
    const pb = createProvider(b);
    expect(createLightProvider(b, pb.provider, pb.limiter)!.model).toBe('small-model');
  });
});

describe('restarts keep the town', () => {
  it('saves on shutdown and continues the latest save on start', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { buildServer } = await import('../src/app');
    const { loadConfig } = await import('../src/config');
    const dir = mkdtempSync(path.join(tmpdir(), 'morphis-resume-'));
    const env = { DATA_DIR: dir, CITY_POPULATION: '80', AI_PROVIDER: 'none', AUTOSAVE_MINUTES: '10', RESUME_LATEST_SAVE: 'true' };
    const a = await buildServer(loadConfig(env), { serveWeb: false });
    a.host.sim.run(3 * 3600);
    const time = a.host.sim.time;
    await a.app.close();
    const b = await buildServer(loadConfig(env), { serveWeb: false });
    expect(b.host.sim.time).toBe(time);
    await b.app.close();
  });
});
