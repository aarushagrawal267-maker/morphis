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
