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
import type { AiProviderInfo, ApprovalRequest, CitizenProfile, CoreRole, ProjectPlan, SimProject, SimTask } from '@morphis/shared';
import { CORE_ROLES, CORE_ROLE_ORDER, agencyAgent, dayOf } from '@morphis/shared';
import type { CitySimulation, TaskExecutor } from '@morphis/sim';
import { templatePlan, validatePlan } from '@morphis/sim';
import type { ServerConfig } from '../config';
import { AgencyLibrary } from './agency';
import { AgentMemory, formatMemory } from './memory';
import { createProvider, type AiProvider, type ChatMessage, type RateLimiter } from './provider';
import { ToolManager } from './tools';
import { LlmLifeMind } from './life';
import { LlmTalker } from './talk';
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
        specialist: z.string().max(80).nullable().optional(),
        work: z.coerce.number().min(30).max(600).default(150),
        dependsOn: z.array(z.string()).default([]),
        location: z.string().optional(),
        description: z.string().max(400).default(''),
      }),
    )
    .min(2)
    .max(16),
});

/** Escape raw control characters that models sometimes leave inside JSON strings. */
function repairStrings(json: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of json) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === '\n') {
        out += '\\n';
        continue;
      } else if (ch === '\r') {
        out += '\\r';
        continue;
      } else if (ch === '\t') {
        out += '\\t';
        continue;
      }
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

/**
 * Extract the first JSON object from a model response. Tolerates code fences,
 * prose around the object, trailing extra braces and raw newlines in strings.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('no JSON object in response');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = body.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return JSON.parse(repairStrings(candidate));
        }
      }
    }
  }
  throw new Error('unterminated JSON object in response');
}

export class LlmMasterPlanner {
  constructor(
    private provider: AiProvider,
    private agency?: AgencyLibrary,
  ) {}

  async plan(command: string): Promise<{ plan: ProjectPlan; note: string }> {
    const roles = CORE_ROLE_ORDER.map((r) => `${r} (${CORE_ROLES[r].label}, ${CORE_ROLES[r].department})`).join('; ');
    const system = [
      'You are the Master Planner of MORPHIS, a city whose workforce is 25 specialised AI citizens coordinated by JARVIS.',
      'Turn the commander\'s request into a project plan: a dependency graph of 4 to 12 concrete tasks.',
      'Independent tasks must not depend on each other so they can run in parallel. Always end with a final review task by project_manager that depends on the other leaf tasks.',
      `Allowed roles: ${roles}.`,
      `Optional "location" values (landmark keys): ${LANDMARK_KEYS.join(', ')}.`,
      'If the request is to create a company or startup, set "foundsCompany" to a short company name, otherwise null.',
      ...(this.agency
        ? [
            '',
            'JARVIS can also hire specialists from The Agency. For each task, set "specialist" to the id of the specialist who fits it best, or null if none fits well.',
            'Prefer specialists who live in town (marked *) when they fit equally well; never invent ids. Always also give the closest workforce "role" (used if the specialist is busy).',
            this.agency.plannerRoster(command),
            '',
          ]
        : []),
      'Respond with ONLY a JSON object: {"name": str, "description": str, "foundsCompany": str|null, "tasks": [{"key": "snake_case", "title": str, "role": role, "specialist": id|null, "work": minutes 60-300, "dependsOn": [keys], "location"?: key, "description": str}]}',
    ].join('\n');
    const res = await this.provider.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Commander request: ${command}` },
      ],
      { temperature: 0.2, maxTokens: 2000 },
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
        ...(t.specialist && agencyAgent(t.specialist) ? { specialist: t.specialist } : {}),
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

export interface AgentStep {
  thought?: string;
  action?: string;
  args?: Record<string, string>;
  final?: string;
}

/** Unescape a (possibly unterminated) JSON string body. */
function unescapeJsonString(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') break;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const n = body[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '';
    else if (n === 'u') {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16) || 32);
      i += 4;
    } else out += n;
  }
  return out;
}

/**
 * Recover the document from a JSON turn that was cut off by the token limit:
 * the text of "final" or of the "content" being written becomes the deliverable.
 */
export function salvageTruncated(text: string): string | null {
  for (const key of ['final', 'content']) {
    const m = text.match(new RegExp(`"${key}"\\s*:\\s*"`));
    if (m && m.index !== undefined) {
      const doc = unescapeJsonString(text.slice(m.index + m[0].length)).trim();
      if (doc.length > 40) return doc;
    }
  }
  return null;
}

/** Parse one agent turn: a JSON action, or plain text treated as the final deliverable. */
export function parseStep(text: string): AgentStep {
  try {
    const j = extractJson(text) as AgentStep;
    if (j && (typeof j.final === 'string' || typeof j.action === 'string')) {
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.args ?? {})) args[k] = typeof v === 'string' ? v : JSON.stringify(v);
      return { thought: j.thought, action: j.action, args, final: j.final };
    }
  } catch {
    /* not (complete) JSON */
  }
  if (text.trimStart().startsWith('{')) {
    const doc = salvageTruncated(text);
    if (doc) return { final: doc + '\n\n> Note: the model output was cut off at the token limit; this deliverable may be incomplete.' };
  }
  return { final: text };
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
    const specialist = agencyAgent(task.specialist);
    const persona = specialist ? await ctl.agency.persona(specialist.id) : null;
    const isResidentSpecialist = !!specialist && citizen.agent?.agency === specialist.id;
    const isReview = /review|synthes/i.test(task.title);
    const ctx = { actor: citizen.id, agentName: citizen.name, taskTitle: task.title, workspace: project.workspace };
    const activity = (text: string) => {
      const c = sim.citizenById(citizen.id);
      if (c && ctl.sim() === sim) sim.workforce.activity(c, text, 'task', task.buildingId);
    };
    try {
      const sources = isReview
        ? project.tasks.map((id) => sim.workforce.task(id)!).filter((t) => t && t.id !== task.id && t.status === 'COMPLETED')
        : job.inputs;
      const inputs: string[] = [];
      for (const t of sources) {
        const content = t.artifact ? await ctl.workspace.read(t.artifact) : null;
        inputs.push(`### ${t.title} (by ${agencyAgent(t.specialist)?.name ?? CORE_ROLES[t.role].label}, file ${t.artifact?.split('/').pop()})\n${(content || t.output || '').slice(0, isReview ? 1400 : 2000)}`);
      }
      const memory = ctl.memory.recall(citizen.id, `${task.title} ${project.name} ${project.description}`, 6).map(formatMemory);
      const tools = ctl.tools.agentTools();
      const toolDocs = tools
        .map((t) => `- ${t.name}: ${t.description}${Object.keys(t.args).length ? ` Args: ${JSON.stringify(t.args)}` : ''}${t.permission === 'approval' ? ' [needs human approval]' : ''}`)
        .join('\n');
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: [
            ...(specialist && isResidentSpecialist
              ? [`You are ${citizen.name}, ${specialist.name} from The Agency, a specialist living in MORPHIS who JARVIS hired for this task.`]
              : specialist && agencyAgent(citizen.agent?.agency)
                ? [
                    `You are ${citizen.name}, ${agencyAgent(citizen.agent?.agency)!.name} from The Agency, a specialist living in MORPHIS.`,
                    `For this task JARVIS handed you the playbook of The Agency's ${specialist.name}: work by its methods and standards.`,
                  ]
                : specialist
                ? [
                    `You are ${citizen.name}, the ${role.label} (${role.department}) in MORPHIS, an AI organisation coordinated by JARVIS.`,
                    `For this task JARVIS brought in the playbook of The Agency's ${specialist.name}: work by its methods and standards.`,
                  ]
                : [`You are ${citizen.name}, the ${role.label} (${role.department}) in MORPHIS, an AI organisation coordinated by JARVIS.`]),
            ...(persona
              ? [
                  '',
                  `=== ${specialist!.name}: persona and playbook (from The Agency) ===`,
                  persona,
                  '=== end of playbook ===',
                  '',
                  'MORPHIS RULES (these override the playbook wherever they conflict): the playbook was written for assistants that can run code and use other tools.',
                  'Here you can ONLY use the tools listed below, and your output is a written markdown deliverable. Where the playbook says to run, install, deploy, test live systems or measure, write the plan, code or checklist instead and say it has not been run.',
                ]
              : []),
            `Your skills: ${Object.keys(citizen.skills).join(', ') || (specialist ? specialist.division : 'general')}.`,
            'You work step by step. Each reply must be ONE JSON object and nothing else:',
            '  {"thought": "short reasoning", "action": "<tool name>", "args": {...}}   to use a tool, or',
            '  {"thought": "short reasoning", "final": "<your complete markdown deliverable>"}   when done.',
            `Tools:\n${toolDocs}`,
            'Put your main deliverable in "final" (it is saved for you as the task file). Use workspace.write only for short supporting notes.',
            'Only use web.fetch for specific, relevant public URLs; the commander may deny it, then continue without it.',
            'Data honesty: use city.data for any Morphis figures. Never invent sources, surveys, studies, citations or measured data. If you estimate, label it clearly as an assumption.',
            'Morphis money is fictional: express costs in simulated credits (§), never in real currencies.',
            'Never claim to have done things you did not do (you cannot email, buy, deploy or run code).',
            isReview ? 'You are the reviewer: check the deliverables for gaps and contradictions, then write the final synthesis with clear next steps.' : '',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Project: ${project.name}`,
            `Brief: ${project.description}`,
            `Your task: ${task.title}`,
            inputs.length ? `\nDeliverables from teammates:\n${inputs.join('\n\n')}` : '\nNo upstream deliverables: you start this work stream.',
            memory.length ? `\nWhat you remember that may help (your own past work, days and conversations):\n${memory.join('\n')}` : '',
            `\nYour final deliverable will be saved as ${task.artifact?.split('/').pop()}. Keep it under 800 words.`,
          ].join('\n'),
        },
      ];
      let final: string | null = null;
      const written = new Set<string>();
      const maxSteps = ctl.maxSteps;
      for (let step = 0; step < maxSteps && final === null; step++) {
        const res = await ctl.provider!.complete(messages);
        ctl.usage.input += res.inputTokens;
        ctl.usage.output += res.outputTokens;
        if (ctl.sim() !== sim) return; // city replaced while we worked
        const parsed = parseStep(res.text);
        messages.push({ role: 'assistant', content: res.text });
        if (parsed.final !== undefined && !parsed.action) {
          final = parsed.final;
          break;
        }
        const action = parsed.action ?? '';
        sim.workforce.reportProgress(task.id, 0.15 + (0.65 * (step + 1)) / maxSteps);
        let observation: string;
        try {
          if (action === 'web.fetch') activity(`Requesting approval to read ${parsed.args?.url ?? 'a web page'}`);
          observation = await ctl.tools.invoke(ctx, action, parsed.args ?? {});
          if (action === 'web.fetch') activity(`Reading ${parsed.args?.url}`);
          if (action === 'workspace.write' && parsed.args?.path) written.add(parsed.args.path.split('/').pop()!);
        } catch (e) {
          observation = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
        }
        ctl.steps++;
        messages.push({ role: 'user', content: `Observation from ${action}:\n${observation.slice(0, 4000)}\n\nContinue. Reply with one JSON object.` });
      }
      if (final === null) {
        messages.push({ role: 'user', content: 'Step limit reached. Reply now with {"final": "<your complete markdown deliverable>"}.' });
        const res = await ctl.provider!.complete(messages);
        if (ctl.sim() !== sim) return;
        const parsed = parseStep(res.text);
        final = parsed.final ?? res.text;
      }
      sim.workforce.reportProgress(task.id, 0.9);
      const header = `<!-- ${task.title} · ${citizen.name} (${specialist ? `${specialist.name}, The Agency` : role.label}) · model ${ctl.provider!.model} · ${new Date().toISOString()} -->\n`;
      // If the agent already wrote its task file during the loop and the hand-in is
      // just a short summary, keep the full document instead of overwriting it.
      const fileName = task.artifact?.split('/').pop();
      if (fileName && written.has(fileName)) {
        const existing = await ctl.workspace.read(task.artifact!);
        if (existing && existing.length > final.length) final = existing.replace(/^<!--[^\n]*-->\n/, '');
      }
      // hand-in goes through the audited workspace tool
      if (fileName) await ctl.tools.invoke(ctx, 'workspace.write', { path: fileName, content: header + final });
      const summary = final.replace(/[#*`>_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 260);
      ctl.memory.add(citizen.id, { time: new Date().toISOString(), kind: 'work', day: dayOf(sim.time), project: project.name, task: task.title, summary: summary.slice(0, 200) });
      ctl.usage.tasks++;
      sim.workforce.complete(task.id, `[AI · ${ctl.provider!.model}] ${summary}${summary.length >= 260 ? '…' : ''}`);
      if (isReview) {
        const p = sim.workforce.project(project.id);
        if (p) p.report = `# ${p.name} — final synthesis (AI)\n\n${final}`;
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

/** Read-only snapshot of real simulation data for agents (units: 1 world unit = 2 m). */
export function cityData(sim: CitySimulation | null, topic: string): object {
  if (!sim) return { error: 'no city running' };
  const st = sim.state;
  const time = `day ${Math.floor(st.clock.time / 86400) + 1} ${String(Math.floor((st.clock.time % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((st.clock.time % 3600) / 60)).padStart(2, '0')}`;
  const stats = sim.stats();
  const edges = sim.world.roads.edges;
  switch (topic) {
    case 'traffic': {
      const byRoad = new Map<string, { vehicles: number; stopped: number; lengthM: number }>();
      for (const e of edges) {
        const r = byRoad.get(e.name) ?? { vehicles: 0, stopped: 0, lengthM: 0 };
        r.vehicles += sim.traffic.edgeCount[e.id];
        r.stopped += sim.traffic.edgeStopped[e.id];
        r.lengthM += e.length * 2;
        byRoad.set(e.name, r);
      }
      const roads = [...byRoad.entries()].map(([name, r]) => ({ name, ...r, lengthM: Math.round(r.lengthM) })).sort((x, y) => y.vehicles - x.vehicles);
      const ring = roads.find((r) => r.name === 'Command Circle');
      return {
        time,
        vehiclesOnRoadNow: stats.vehiclesMoving,
        vehiclesParkedOrOffRoad: stats.vehiclesTotal - stats.vehiclesMoving,
        vehiclesInFleet: stats.vehiclesTotal,
        avgSpeedKmh: Math.round(stats.avgTrafficSpeed * 7.2),
        congestionShare: stats.congestion,
        cityStatus: stats.status,
        centralRoundabout: ring ?? null,
        busiestRoads: roads.slice(0, 10),
        signalisedJunctions: sim.signalNodes.length,
        note: 'vehiclesOnRoadNow includes vehicles waiting at lights; parked vehicles are not on the road. congestionShare = share of on-road vehicles held longer than one signal cycle. Per-road "stopped" counts vehicles currently halted on that road (queues at lights included).',
      };
    }
    case 'transit':
      return {
        time,
        busLines: sim.world.busLines.map((l) => ({ name: l.name, stops: l.stops.length, buses: st.vehicles.filter((v) => v.info.lineId === l.id).length })),
        riderBoardingsToday: st.economy.summary.transitRidersToday,
        taxiTripsToday: st.economy.summary.taxiTripsToday,
        taxis: st.vehicles.filter((v) => v.info.kind === 'taxi').length,
        privateCars: st.vehicles.filter((v) => v.info.kind === 'car').length,
        citizensWalkingNow: stats.walking,
        citizensInVehiclesNow: stats.traveling,
      };
    case 'economy': {
      const e = st.economy.summary;
      return { time, currency: 'simulated credits (fictional)', cityBudget: e.cityBudget, gdpToday: e.gdpToday, gdpYesterday: e.gdpYesterday, employed: e.employed, unemployed: e.unemployed, avgHappiness: e.avgHappiness, businessesOpen: e.businessesOpen, history: e.history.slice(-7) };
    }
    case 'resources':
      return { time, ...st.economy.summary.resources, units: 'MW / ML (simulated)' };
    case 'districts':
      return sim.world.districts.map((d) => ({
        name: d.name,
        buildings: sim.world.buildings.filter((b) => b.districtId === d.id).length,
        peopleInsideNow: sim.world.buildings.filter((b) => b.districtId === d.id).reduce((a, b) => a + st.buildings[b.index].occupants.length, 0),
      }));
    default:
      return { time, population: stats.population, activeCitizens: stats.activeCitizens, working: stats.working, walking: stats.walking, sleeping: stats.sleeping, weather: st.weather.kind, cityStatus: stats.status, topics: ['traffic', 'transit', 'economy', 'resources', 'districts'] };
  }
}

export class AgentController {
  readonly provider: AiProvider | null;
  readonly limiter: RateLimiter;
  readonly workspace: Workspace;
  readonly tools: ToolManager;
  readonly memory: AgentMemory;
  readonly agency: AgencyLibrary;
  readonly maxSteps: number;
  steps = 0;
  readonly planner: LlmMasterPlanner | null;
  readonly executor: LiveTaskExecutor | null;
  readonly lifeMind: LlmLifeMind | null;
  readonly talker: LlmTalker | null;
  info: AiProviderInfo;
  verified: 'unverified' | 'ok' | 'failed' = 'unverified';
  lastError: string | null = null;
  usage = { input: 0, output: 0, tasks: 0 };
  private getSim: () => CitySimulation | null = () => null;

  /** Called whenever the approval queue changes (broadcast to clients). */
  onApprovals: (list: ApprovalRequest[]) => void = () => undefined;

  constructor(cfg: ServerConfig, audit?: (actor: string, action: string, detail: object, approved: boolean) => Promise<void>) {
    const { provider, info, limiter } = createProvider(cfg);
    this.provider = provider;
    this.info = info;
    this.limiter = limiter;
    this.maxSteps = cfg.AI_AGENT_MAX_STEPS;
    this.agency = new AgencyLibrary(cfg.AGENCY_DIR);
    this.memory = new AgentMemory(cfg.DATA_DIR);
    void this.memory.load();
    this.workspace = new Workspace(cfg.DATA_DIR);
    this.tools = new ToolManager(this.workspace, {
      dataDir: cfg.DATA_DIR,
      webFetch: cfg.AI_WEB_FETCH === 'true',
      approvalTimeoutMs: cfg.AI_APPROVAL_TIMEOUT_MS,
      onAudit: audit,
      onApprovalsChanged: (list) => this.onApprovals(list),
    });
    this.planner = provider ? new LlmMasterPlanner(provider, this.agency.available ? this.agency : undefined) : null;
    this.executor = provider ? new LiveTaskExecutor(this) : null;
    this.lifeMind =
      provider && cfg.AI_LIFE_DECISIONS_PER_HOUR > 0
        ? new LlmLifeMind(provider, limiter, () => this.sim(), this.memory, {
            perHour: cfg.AI_LIFE_DECISIONS_PER_HOUR,
            maxInFlight: 2,
            reserveShare: 0.4,
            dailyCap: cfg.AI_DAILY_REQUEST_CAP,
          })
        : null;
    this.talker = provider && cfg.AI_TALK_PER_MINUTE > 0 ? new LlmTalker(provider, limiter, { perMinute: cfg.AI_TALK_PER_MINUTE, dailyCap: cfg.AI_DAILY_REQUEST_CAP }, this.memory) : null;
    this.tools.register({
      name: 'city.data',
      description: 'Read live, real data from the Morphis city simulation (read-only). Use it instead of inventing numbers.',
      args: { topic: 'one of: overview | traffic | transit | economy | resources | districts' },
      permission: 'auto',
      enabled: true,
      run: async (a) => JSON.stringify(cityData(this.sim(), a.topic ?? 'overview'), null, 1).slice(0, 6000),
    });
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
      agentSteps: this.steps,
      requestsToday: this.limiter.used,
      tools: this.tools.list(),
      approvals: this.tools.recentApprovals(),
      inFlight: this.executor ? [...this.executor.inFlight] : [],
      lifeDecisions: this.lifeMind?.stats ?? null,
      conversations: this.talker?.stats ?? null,
    };
  }
}
