/**
 * The AI organisation behind the city:
 *  - LlmMasterPlanner: turns a JARVIS command into a validated task graph
 *  - LiveTaskExecutor: runs each task as a real LLM call in the role of the
 *    assigned core citizen, writes the deliverable to the shared workspace and
 *    reports progress back into the simulation (which drives the 3D city)
 *  - AgentController: owns provider, planner, executor, tools and memory
 * The final "review" task of each plan receives every upstream deliverable and
 * produces the synthesis, acting as reviewer.
 */
import { z } from 'zod';
import type { AiProviderInfo, CitizenProfile, CoreRole, ProjectPlan, SimProject, SimTask } from '@morphis/shared';
import { CORE_ROLES, CORE_ROLE_ORDER } from '@morphis/shared';
import type { CitySimulation, TaskExecutor } from '@morphis/sim';
import { templatePlan, validatePlan } from '@morphis/sim';
import type { ServerConfig } from '../config';
import { AgentMemory } from './memory';
import { createProvider, type AiProvider, type RateLimiter } from './provider';
import { ToolManager } from './tools';
import { Workspace } from './workspace';

const LANDMARK_KEYS = ['hq', 'ai_lab', 'university', 'orbital', 'corporate', 'bank', 'studio', 'datacenter', 'hospital', 'market', 'station'];

const planSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(600).default(''),
  foundsCompany: z.string().max(60).nullable().optional(),
  tasks: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z0-9_-]{1,32}$/),
        title: z.string().min(2).max(90),
        role: z.enum(CORE_ROLE_ORDER as [CoreRole, ...CoreRole[]]),
        work: z.coerce.number().min(30).max(600).default(150),
        dependsOn: z.array(z.string()).default([]),
        location: z.string().optional(),
        description: z.string().max(400).default(''),
      }),
    )
    .min(2)
    .max(16),
});

/** Extract the first JSON object from a model response (tolerates fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(body.slice(start, end + 1));
}

export class LlmMasterPlanner {
  constructor(private provider: AiProvider) {}

  async plan(command: string): Promise<{ plan: ProjectPlan; note: string }> {
    const roles = CORE_ROLE_ORDER.map((r) => `${r} (${CORE_ROLES[r].label}, ${CORE_ROLES[r].department})`).join('; ');
    const system = [
      'You are the Master Planner of MORPHIS, a city whose workforce is 25 specialised AI citizens coordinated by JARVIS.',
      'Turn the commander\'s request into a project plan: a dependency graph of 4 to 12 concrete tasks.',
      'Independent tasks must not depend on each other so they can run in parallel. Always end with a final review task by project_manager that depends on the other leaf tasks.',
      `Allowed roles: ${roles}.`,
      `Optional "location" values (landmark keys): ${LANDMARK_KEYS.join(', ')}.`,
      'If the request is to create a company or startup, set "foundsCompany" to a short company name, otherwise null.',
      'Respond with ONLY a JSON object: {"name": str, "description": str, "foundsCompany": str|null, "tasks": [{"key": "snake_case", "title": str, "role": role, "work": minutes 60-300, "dependsOn": [keys], "location"?: key, "description": str}]}',
    ].join('\n');
    const res = await this.provider.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Commander request: ${command}` },
      ],
      { temperature: 0.2, maxTokens: 1600 },
    );
    const parsed = planSchema.parse(extractJson(res.text));
    const plan: ProjectPlan = {
      name: parsed.name,
      kind: 'llm',
      description: parsed.description || `Requested: "${command}"`,
      planner: `llm:${this.provider.model}`,
      foundsCompany: parsed.foundsCompany ?? null,
      tasks: parsed.tasks.map((t) => ({
        key: t.key,
        title: t.title,
        role: t.role,
        work: t.work,
        dependsOn: t.dependsOn.filter((d) => parsed.tasks.some((x) => x.key === d)),
        location: t.location && LANDMARK_KEYS.includes(t.location) ? t.location : undefined,
        description: t.description || t.title,
        artifact: `${t.key}.md`,
      })),
    };
    const err = validatePlan(plan);
    if (err) throw new Error(`invalid plan from model: ${err}`);
    return { plan, note: `planned by ${this.provider.model}` };
  }
}

interface Job {
  sim: CitySimulation;
  task: SimTask;
  citizen: CitizenProfile;
  project: SimProject;
  inputs: SimTask[];
}

export class LiveTaskExecutor implements TaskExecutor {
  readonly mode = 'live' as const;
  readonly label: string;
  private queue: Job[] = [];
  private running = 0;
  private attempts = new Map<string, number>();
  inFlight = new Set<string>();

  constructor(
    private ctl: AgentController,
    private concurrency = 2,
  ) {
    this.label = `AI agents (${ctl.provider!.model})`;
  }

  begin(task: SimTask, citizen: CitizenProfile, project: SimProject, inputs: SimTask[]): void {
    const sim = this.ctl.sim();
    if (!sim) return;
    this.queue.push({ sim, task, citizen, project, inputs });
    this.inFlight.add(task.id);
    sim.workforce.reportProgress(task.id, 0.05);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.inFlight.delete(job.task.id);
        this.pump();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    const { sim, task, citizen, project } = job;
    const ctl = this.ctl;
    const role = CORE_ROLES[task.role];
    const isReview = /review|synthes/i.test(task.title);
    try {
      const inputs: string[] = [];
      const sources = isReview ? project.tasks.map((id) => sim.workforce.task(id)!).filter((t) => t && t.id !== task.id && t.status === 'COMPLETED') : job.inputs;
      for (const t of sources) {
        const content = t.artifact ? await ctl.tools.invoke(citizen.id, 'workspace.read', { path: t.artifact }) : '';
        inputs.push(`### ${t.title} (by ${CORE_ROLES[t.role].label})\n${(content || t.output || '').slice(0, isReview ? 1400 : 2200)}`);
      }
      const memory = ctl.memory.recent(citizen.id).map((m) => `- ${m.project}: ${m.task} — ${m.summary}`);
      sim.workforce.reportProgress(task.id, 0.25);
      const res = await ctl.provider!.complete([
        {
          role: 'system',
          content: [
            `You are ${citizen.name}, the ${role.label} (${role.department}) in MORPHIS, an AI organisation coordinated by JARVIS.`,
            `Your skills: ${Object.keys(citizen.skills).join(', ')}.`,
            'Produce the deliverable for your assigned task as a well-structured markdown document (headings, bullet points, concrete specifics).',
            'Work only from the information given; state assumptions explicitly. You cannot browse the web, run code or contact anyone, so never claim to have done so.',
            isReview ? 'You are the reviewer: assess the upstream deliverables for gaps and contradictions, then write the final synthesis and next steps.' : '',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Project: ${project.name}`,
            `Project brief: ${project.description}`,
            `Your task: ${task.title}`,
            inputs.length ? `\nInputs from teammates:\n${inputs.join('\n\n')}` : '\nNo upstream inputs: you are starting this work stream.',
            memory.length ? `\nYour recent work:\n${memory.join('\n')}` : '',
            '\nKeep it under 700 words.',
          ].join('\n'),
        },
      ]);
      if (ctl.sim() !== sim) return; // city was replaced while we worked
      sim.workforce.reportProgress(task.id, 0.85);
      const header = `<!-- ${task.title} · ${citizen.name} (${role.label}) · model ${ctl.provider!.model} · ${new Date().toISOString()} -->\n`;
      if (task.artifact) await ctl.tools.invoke(citizen.id, 'workspace.write', { path: task.artifact, content: header + res.text });
      const summary = res.text.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 260);
      ctl.memory.add(citizen.id, { time: new Date().toISOString(), project: project.name, task: task.title, summary: summary.slice(0, 160) });
      ctl.usage.input += res.inputTokens;
      ctl.usage.output += res.outputTokens;
      ctl.usage.tasks++;
      sim.workforce.complete(task.id, `[AI · ${ctl.provider!.model}] ${summary}${summary.length >= 260 ? '…' : ''}`);
      if (isReview) {
        const p = sim.workforce.project(project.id);
        if (p) p.report = `# ${p.name} — final synthesis (AI)\n\n${res.text}`;
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      ctl.lastError = reason;
      if (ctl.sim() !== sim) return;
      const n = (this.attempts.get(task.id) ?? 0) + 1;
      this.attempts.set(task.id, n);
      if (n >= 2) {
        sim.workforce.complete(task.id, `[SIMULATED FALLBACK] AI agent failed twice (${reason.slice(0, 120)}). No real work was produced for "${task.title}".`);
      } else {
        sim.workforce.reportFailure(task.id, `AI call failed: ${reason.slice(0, 100)}`);
      }
    }
  }
}

export class AgentController {
  readonly provider: AiProvider | null;
  readonly limiter: RateLimiter;
  readonly workspace: Workspace;
  readonly tools: ToolManager;
  readonly memory = new AgentMemory();
  readonly planner: LlmMasterPlanner | null;
  readonly executor: LiveTaskExecutor | null;
  info: AiProviderInfo;
  verified: 'unverified' | 'ok' | 'failed' = 'unverified';
  lastError: string | null = null;
  usage = { input: 0, output: 0, tasks: 0 };
  private getSim: () => CitySimulation | null = () => null;

  constructor(cfg: ServerConfig, audit?: (actor: string, action: string, detail: object, approved: boolean) => Promise<void>) {
    const { provider, info, limiter } = createProvider(cfg);
    this.provider = provider;
    this.info = info;
    this.limiter = limiter;
    this.workspace = new Workspace(cfg.DATA_DIR);
    this.tools = new ToolManager(this.workspace, cfg.DATA_DIR, audit);
    this.planner = provider ? new LlmMasterPlanner(provider) : null;
    this.executor = provider ? new LiveTaskExecutor(this) : null;
  }

  bindSimulation(get: () => CitySimulation | null): void {
    this.getSim = get;
  }

  sim(): CitySimulation | null {
    return this.getSim();
  }

  /** One tiny request to confirm the key and endpoint really work (honest status). */
  async verify(): Promise<void> {
    if (!this.provider) return;
    try {
      await this.provider.complete([{ role: 'user', content: 'Reply with the single word: ready' }], { maxTokens: 16, temperature: 0 });
      this.verified = 'ok';
      this.info = { ...this.info, connected: true, detail: this.info.detail.replace(/^/, 'Verified. ') };
    } catch (e) {
      this.verified = 'failed';
      this.lastError = e instanceof Error ? e.message : String(e);
      this.info = { connected: false, provider: this.info.provider, detail: `AI provider configured but the test call failed: ${this.lastError.slice(0, 160)}. Falling back to simulated work.` };
    }
  }

  get live(): boolean {
    return !!this.provider && this.verified !== 'failed';
  }

  async planCommand(text: string): Promise<{ plan: ProjectPlan; note: string }> {
    if (this.planner && this.live) {
      try {
        return await this.planner.plan(text);
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e);
        const plan = templatePlan(text);
        plan.planner = 'template-planner (LLM plan failed)';
        return { plan, note: `LLM planning failed (${this.lastError.slice(0, 80)}); used template planner` };
      }
    }
    return { plan: templatePlan(text), note: 'template planner (no AI provider)' };
  }

  status() {
    return {
      ...this.info,
      verified: this.verified,
      lastError: this.lastError,
      usage: this.usage,
      requestsToday: this.limiter.used,
      tools: this.tools.list(),
      pendingApprovals: this.tools.pending,
      inFlight: this.executor ? [...this.executor.inFlight] : [],
    };
  }
}
