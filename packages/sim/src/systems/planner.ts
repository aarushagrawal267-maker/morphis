/**
 * Template Master Planner: turns a high-level command into a task dependency
 * graph without any AI provider. Independent tasks run in parallel; dependent
 * tasks wait for their inputs. An LLM planner (server side) produces the same
 * ProjectPlan shape and can replace this one.
 */
import type { CoreRole, PlanTask, ProjectPlan } from '@morphis/shared';

type T = [key: string, title: string, role: CoreRole, work: number, deps: string[], location?: string];

const PLANS: Record<string, { match: RegExp; describe: string; tasks: T[]; company?: boolean }> = {
  startup: {
    match: /\b(startup|start-up|company|business|venture)\b/i,
    describe: 'Found a new company: research, business model, MVP, brand and launch.',
    company: true,
    tasks: [
      ['research', 'Market research', 'researcher', 180, []],
      ['model', 'Business model', 'business_strategist', 160, ['research'], 'corporate'],
      ['finance', 'Financial plan', 'finance_analyst', 150, ['model']],
      ['legal', 'Incorporation & compliance', 'legal_researcher', 120, ['model']],
      ['spec', 'MVP product specification', 'product_manager', 150, ['model']],
      ['brand', 'Brand identity', 'ui_designer', 160, ['spec']],
      ['backend', 'MVP backend', 'backend_developer', 260, ['spec']],
      ['frontend', 'MVP frontend', 'frontend_developer', 240, ['spec', 'brand']],
      ['qa', 'MVP testing', 'qa_engineer', 150, ['backend', 'frontend']],
      ['launch', 'Launch marketing plan', 'marketing_strategist', 140, ['brand']],
      ['sales', 'First customer outreach', 'sales_specialist', 120, ['launch']],
      ['hiring', 'Hiring plan', 'hr_coordinator', 100, ['finance']],
      ['review', 'Final review', 'project_manager', 90, ['qa', 'sales', 'legal', 'hiring'], 'hq'],
    ],
  },
  software: {
    match: /\b(app|platform|software|website|tool|api|system|dashboard|build|develop)\b/i,
    describe: 'Build a software product: research, spec, design, implementation, testing and review.',
    tasks: [
      ['research', 'Market & user research', 'researcher', 180, []],
      ['spec', 'Product requirements', 'product_manager', 150, ['research']],
      ['ux', 'UX flows', 'ux_researcher', 150, ['spec']],
      ['ui', 'UI design', 'ui_designer', 180, ['ux']],
      ['arch', 'System architecture', 'backend_developer', 150, ['spec']],
      ['backend', 'Backend implementation', 'backend_developer', 300, ['arch']],
      ['frontend', 'Frontend implementation', 'frontend_developer', 300, ['ui', 'arch']],
      ['ai', 'AI integration', 'ai_engineer', 240, ['arch']],
      ['qa', 'Testing', 'qa_engineer', 200, ['backend', 'frontend', 'ai']],
      ['docs', 'Documentation', 'documentation_specialist', 150, ['backend', 'frontend']],
      ['review', 'Final review', 'project_manager', 90, ['qa', 'docs'], 'hq'],
    ],
  },
  research: {
    match: /\b(research|study|analy[sz]e|analysis|investigate|report)\b/i,
    describe: 'Research programme: literature, data, modelling and a written report.',
    tasks: [
      ['lit', 'Literature review', 'researcher', 180, []],
      ['data', 'Data collection & analysis', 'data_analyst', 220, []],
      ['model', 'Modelling', 'ai_engineer', 200, ['data']],
      ['draft', 'Report draft', 'content_writer', 160, ['lit', 'model']],
      ['edit', 'Editing & citations', 'documentation_specialist', 100, ['draft']],
      ['review', 'Final review', 'project_manager', 80, ['edit'], 'hq'],
    ],
  },
  marketing: {
    match: /\b(market|marketing|campaign|brand|promot|advert)/i,
    describe: 'Marketing campaign: audience, strategy, content, assets and outreach.',
    tasks: [
      ['audience', 'Audience research', 'ux_researcher', 150, []],
      ['strategy', 'Campaign strategy', 'marketing_strategist', 150, ['audience']],
      ['copy', 'Campaign copy', 'content_writer', 150, ['strategy']],
      ['visual', 'Campaign visuals', 'ui_designer', 160, ['strategy']],
      ['media', 'Video & media assets', 'media_specialist', 200, ['copy', 'visual']],
      ['outreach', 'Sales outreach', 'sales_specialist', 120, ['media']],
      ['review', 'Final review', 'project_manager', 80, ['outreach'], 'hq'],
    ],
  },
  security: {
    match: /\b(secur|audit|pentest|vulnerab|threat)/i,
    describe: 'Security review: threat model, audits, testing and a report.',
    tasks: [
      ['threat', 'Threat model', 'security_analyst', 160, []],
      ['infra', 'Infrastructure audit', 'devops_engineer', 180, ['threat']],
      ['code', 'Code review', 'backend_developer', 180, ['threat']],
      ['pentest', 'Penetration tests', 'qa_engineer', 200, ['infra', 'code']],
      ['compliance', 'Compliance check', 'legal_researcher', 120, ['threat']],
      ['report', 'Security report', 'documentation_specialist', 120, ['pentest', 'compliance']],
      ['review', 'Final review', 'project_manager', 80, ['report'], 'hq'],
    ],
  },
  education: {
    match: /\b(course|teach|train|training|curriculum|tutorial|lesson|tutor)/i,
    describe: 'Education programme: curriculum, materials, media and a pilot.',
    tasks: [
      ['curriculum', 'Curriculum design', 'educator', 180, []],
      ['materials', 'Learning materials', 'content_writer', 180, ['curriculum']],
      ['video', 'Video lessons', 'media_specialist', 200, ['materials']],
      ['ui', 'Learning experience design', 'ui_designer', 150, ['curriculum']],
      ['pilot', 'Pilot test', 'qa_engineer', 120, ['video', 'ui']],
      ['review', 'Final review', 'project_manager', 80, ['pilot'], 'hq'],
    ],
  },
  finance: {
    match: /\b(budget|forecast|financ|revenue|cost|pricing)/i,
    describe: 'Financial analysis: data, model, scenarios and recommendations.',
    tasks: [
      ['data', 'Financial data gathering', 'finance_analyst', 150, []],
      ['model', 'Financial model', 'data_analyst', 180, ['data']],
      ['scenarios', 'Scenario analysis', 'business_strategist', 150, ['model']],
      ['review', 'Final review', 'project_manager', 80, ['scenarios'], 'hq'],
    ],
  },
  general: {
    match: /.*/,
    describe: 'General initiative: scoping, planning, research and a write-up.',
    tasks: [
      ['scope', 'Scoping', 'innovation_lead', 120, []],
      ['plan', 'Project plan', 'project_manager', 120, ['scope']],
      ['research', 'Background research', 'researcher', 160, ['scope']],
      ['writeup', 'Write-up', 'documentation_specialist', 120, ['plan', 'research']],
      ['review', 'Final review', 'operations_manager', 80, ['writeup'], 'hq'],
    ],
  },
};

const ORDER = ['startup', 'security', 'education', 'marketing', 'finance', 'research', 'software', 'general'];
const STOP = /^(please\s+)?(build|create|make|launch|start|design|develop|research|write|plan|run|do|set up|setup|prepare|organi[sz]e)\s+/i;

export function projectNameFrom(text: string): string {
  let t = text.trim().replace(STOP, '');
  t = t.replace(/^(an?|the|our|new)\s+/i, '').replace(/[.!?]+$/, '');
  const words = t.split(/\s+/).slice(0, 6);
  const name = words.map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0]?.toUpperCase() + w.slice(1))).join(' ');
  return name || 'New Initiative';
}

export function templatePlan(text: string): ProjectPlan {
  const kind = ORDER.find((k) => PLANS[k].match.test(text)) ?? 'general';
  const p = PLANS[kind];
  const name = projectNameFrom(text);
  const tasks: PlanTask[] = p.tasks.map(([key, title, role, work, deps, location]) => ({
    key,
    title,
    role,
    work,
    dependsOn: deps,
    location,
    description: `${title} for "${name}"`,
    artifact: `${key}.md`,
  }));
  return {
    name,
    kind,
    description: `${p.describe} Requested: "${text.trim()}"`,
    tasks,
    planner: 'template-planner',
    foundsCompany: p.company ? name.replace(/\b(startup|start-up|company|business|venture)\b/gi, '').trim() || name : null,
  };
}

/** Validate a plan's dependency graph (unique keys, known deps, acyclic). */
export function validatePlan(plan: ProjectPlan): string | null {
  const keys = new Set<string>();
  for (const t of plan.tasks) {
    if (keys.has(t.key)) return `duplicate task key ${t.key}`;
    keys.add(t.key);
  }
  for (const t of plan.tasks) for (const d of t.dependsOn) if (!keys.has(d)) return `unknown dependency ${d}`;
  const state = new Map<string, number>();
  const byKey = new Map(plan.tasks.map((t) => [t.key, t]));
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return false;
    if (state.get(k) === 2) return true;
    state.set(k, 1);
    for (const d of byKey.get(k)!.dependsOn) if (!visit(d)) return false;
    state.set(k, 2);
    return true;
  };
  for (const t of plan.tasks) if (!visit(t.key)) return 'dependency cycle';
  if (!plan.tasks.length) return 'empty plan';
  return null;
}
