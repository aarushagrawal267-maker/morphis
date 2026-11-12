/**
 * Workforce system: projects, task dependency graphs and the 25 core citizens.
 *
 * Tasks are assigned by role to core citizens. A task only progresses while
 * its assignee is physically WORKING in the task's building, so the 3D city
 * always reflects where work happens. Execution is delegated to a
 * TaskExecutor: the built-in SimulatedExecutor advances progress with
 * simulated work time and produces clearly labelled placeholder deliverables;
 * a live executor (server-side AI agents) reports real progress instead.
 */
import type { ActivityEntry, BuildingDef, CitizenProfile, CitizenStatus, CoreRole, ProjectPlan, SimProject, SimTask } from '@morphis/shared';
import { CORE_ROLES, agencyAgent, hourOf, isWeekend } from '@morphis/shared';
import type { CitizenRT } from '../state';
import type { CitySimulation } from '../engine';

export interface TaskExecutor {
  readonly mode: 'simulated' | 'live';
  readonly label: string;
  /** Called once when the assignee starts working on the task in its building. */
  begin(task: SimTask, citizen: CitizenProfile, project: SimProject, inputs: SimTask[]): void;
}

export class SimulatedExecutor implements TaskExecutor {
  readonly mode = 'simulated' as const;
  readonly label = 'Simulated workforce (no AI provider connected)';
  begin(): void {}
}

interface CompanyTemplate {
  landmark: string;
  names: string[];
  tasks: { key: string; title: string; role: CoreRole; work: number; deps: string[]; at?: string }[];
}

const COMPANY_PROJECTS: CompanyTemplate[] = [
  {
    landmark: 'ai_lab',
    names: ['Evaluation suite for Atlas-7', 'Robustness study: city sensor data', 'Speech model fine-tune'],
    tasks: [
      { key: 'lit', title: 'Literature review', role: 'researcher', work: 180, deps: [] },
      { key: 'data', title: 'Benchmark data preparation', role: 'data_analyst', work: 200, deps: [] },
      { key: 'eval', title: 'Model evaluation runs', role: 'ai_engineer', work: 260, deps: ['data'] },
      { key: 'write', title: 'Findings write-up', role: 'researcher', work: 150, deps: ['lit', 'eval'] },
    ],
  },
  {
    landmark: 'orbital',
    names: ['Orbital Mesh v3 release', 'Fleet telemetry dashboard', 'Payments API refresh'],
    tasks: [
      { key: 'api', title: 'API endpoints', role: 'backend_developer', work: 260, deps: [] },
      { key: 'ui', title: 'Dashboard UI', role: 'frontend_developer', work: 240, deps: [] },
      { key: 'design', title: 'Design review with engineering', role: 'ui_designer', work: 90, deps: [], at: 'orbital' },
      { key: 'qa', title: 'Regression test pass', role: 'qa_engineer', work: 180, deps: ['api', 'ui'] },
      { key: 'ship', title: 'Deployment pipeline update', role: 'devops_engineer', work: 150, deps: ['qa'] },
    ],
  },
  {
    landmark: 'studio',
    names: ['Brand campaign: Lantern Season', 'Morphis city guide redesign'],
    tasks: [
      { key: 'ux', title: 'User interviews', role: 'ux_researcher', work: 160, deps: [] },
      { key: 'visual', title: 'Visual concepts', role: 'ui_designer', work: 200, deps: ['ux'] },
      { key: 'copy', title: 'Campaign copy', role: 'content_writer', work: 150, deps: [] },
      { key: 'video', title: 'Promo video edit', role: 'media_specialist', work: 220, deps: ['visual', 'copy'] },
    ],
  },
  {
    landmark: 'corporate',
    names: ['Market expansion: Finance District', 'Enterprise partnerships plan'],
    tasks: [
      { key: 'opp', title: 'Opportunity analysis', role: 'business_strategist', work: 200, deps: [] },
      { key: 'pos', title: 'Positioning plan', role: 'marketing_strategist', work: 160, deps: ['opp'] },
      { key: 'pipe', title: 'Sales pipeline outreach plan', role: 'sales_specialist', work: 150, deps: ['pos'] },
      { key: 'legal', title: 'Compliance review', role: 'legal_researcher', work: 140, deps: ['opp'] },
      { key: 'hire', title: 'Hiring plan', role: 'hr_coordinator', work: 120, deps: ['opp'] },
      { key: 'support', title: 'Support playbook', role: 'customer_support', work: 130, deps: ['pos'] },
    ],
  },
  {
    landmark: 'bank',
    names: ['Quarterly city forecast'],
    tasks: [
      { key: 'fc', title: 'Revenue forecast model', role: 'finance_analyst', work: 220, deps: [] },
      { key: 'brief', title: 'Briefing with strategy team', role: 'finance_analyst', work: 80, deps: ['fc'], at: 'corporate' },
    ],
  },
  {
    landmark: 'datacenter',
    names: ['Grid security hardening'],
    tasks: [
      { key: 'audit', title: 'Security audit', role: 'security_analyst', work: 220, deps: [] },
      { key: 'cap', title: 'Capacity plan', role: 'devops_engineer', work: 160, deps: [] },
    ],
  },
  {
    landmark: 'hq',
    names: ['Quarterly roadmap', 'City operations review'],
    tasks: [
      { key: 'road', title: 'Roadmap review', role: 'product_manager', work: 150, deps: [] },
      { key: 'sprint', title: 'Sprint planning', role: 'project_manager', work: 120, deps: ['road'] },
      { key: 'ops', title: 'Operations report', role: 'operations_manager', work: 160, deps: [] },
      { key: 'scout', title: 'Innovation scouting', role: 'innovation_lead', work: 180, deps: [] },
      { key: 'kb', title: 'Knowledge base update', role: 'documentation_specialist', work: 140, deps: ['sprint'] },
    ],
  },
  {
    landmark: 'university',
    names: ['Course module: AI literacy'],
    tasks: [
      { key: 'cur', title: 'Curriculum outline', role: 'educator', work: 180, deps: [] },
      { key: 'lab', title: 'Guest session at the AI Lab', role: 'educator', work: 90, deps: ['cur'], at: 'ai_lab' },
    ],
  },
];

const VERB: Partial<Record<CoreRole, string>> = {
  researcher: 'Analyzing research data',
  data_analyst: 'Crunching datasets',
  product_manager: 'Preparing the product specification',
  ux_researcher: 'Synthesising user interviews',
  ui_designer: 'Iterating on interface mockups',
  frontend_developer: 'Building interface components',
  backend_developer: 'Implementing service endpoints',
  ai_engineer: 'Running model experiments',
  qa_engineer: 'Executing the test plan',
  devops_engineer: 'Tuning the deployment pipeline',
  finance_analyst: 'Updating the financial model',
  marketing_strategist: 'Drafting the positioning',
  sales_specialist: 'Mapping the customer pipeline',
  business_strategist: 'Modelling business scenarios',
  operations_manager: 'Reviewing operations metrics',
  content_writer: 'Writing the draft',
  media_specialist: 'Editing media assets',
  customer_support: 'Writing support guides',
  hr_coordinator: 'Planning recruitment',
  legal_researcher: 'Reviewing regulations',
  security_analyst: 'Scanning for vulnerabilities',
  innovation_lead: 'Scouting new opportunities',
  educator: 'Preparing teaching material',
  project_manager: 'Coordinating the team',
  documentation_specialist: 'Documenting decisions',
};

export class WorkforceSystem {
  executor: TaskExecutor = new SimulatedExecutor();
  private liveBegun = new Set<string>();
  private taskById = new Map<string, SimTask>();

  constructor(private sim: CitySimulation) {
    this.reindex();
  }

  reindex(): void {
    this.taskById.clear();
    for (const t of this.sim.state.tasks) this.taskById.set(t.id, t);
  }

  task(id: string): SimTask | undefined {
    return this.taskById.get(id);
  }

  project(id: string): SimProject | undefined {
    return this.sim.state.projects.find((p) => p.id === id);
  }

  core(): CitizenRT[] {
    return this.sim.state.citizens.filter((c) => c.profile.core);
  }

  /** The Agency's specialists living in town. */
  specialists(): CitizenRT[] {
    return this.sim.state.citizens.filter((c) => !!c.profile.agent?.agency);
  }

  /** Citizens who take on project work: the core workforce and resident specialists. */
  private isWorker(c: CitizenRT): boolean {
    return c.profile.core || !!c.profile.agent?.agency;
  }

  // ---------------------------------------------------------------- activity stream

  activity(c: CitizenRT, text: string, kind: ActivityEntry['kind'], buildingId?: string): void {
    const sim = this.sim;
    const entry: ActivityEntry = { id: sim.newId('act'), time: sim.time, citizenId: c.profile.id, text, kind };
    if (buildingId) entry.buildingId = buildingId;
    sim.state.activity.push(entry);
    if (sim.state.activity.length > 200) sim.state.activity.shift();
    sim.bus.emit('city.activity', sim.time, { entry });
  }

  onTripStart(c: CitizenRT, dest: BuildingDef, activity: string, purpose: string): void {
    if (!this.isWorker(c) || activity === 'sleep') return;
    if (!c.profile.core && !c.dyn.currentTaskId) return;
    const task = c.dyn.currentTaskId ? this.task(c.dyn.currentTaskId) : null;
    if (activity === 'meeting' && task) {
      this.activity(c, `Heading to ${dest.name} for "${task.title}"`, 'meeting', dest.id);
    } else {
      this.activity(c, `Heading to ${dest.name} ${purpose}`, 'travel', dest.id);
    }
  }

  onArrive(c: CitizenRT, buildingId: string, activity: string): void {
    if (!this.isWorker(c)) return;
    if (!c.profile.core && !c.dyn.currentTaskId) return;
    const b = this.sim.building(buildingId);
    const task = c.dyn.currentTaskId ? this.task(c.dyn.currentTaskId) : null;
    if ((activity === 'work' || activity === 'meeting') && task && task.buildingId === buildingId) {
      const others = this.sim.state.buildings[b.index].occupants
        .map((id) => this.sim.citizenById(id))
        .filter((o): o is CitizenRT => !!o && this.isWorker(o) && o !== c);
      if (activity === 'meeting' && others.length) {
        this.activity(c, `Meeting ${others[0].profile.name} at ${b.name} about "${task.title}"`, 'meeting', buildingId);
      } else {
        this.activity(c, `${VERB[c.profile.role!] ?? 'Working'} — ${task.title}`, 'task', buildingId);
      }
    } else if (activity === 'eat') {
      this.activity(c, `Taking a break at ${b.name}`, 'status', buildingId);
    } else if (activity === 'work') {
      this.activity(c, `Arrived at ${b.name}`, 'status', buildingId);
    }
  }

  onCitizenStatus(c: CitizenRT, _prev: CitizenStatus): void {
    if (!this.isWorker(c) || c.dyn.status !== 'WORKING' || !c.dyn.currentTaskId) return;
    const task = this.task(c.dyn.currentTaskId);
    if (task && task.buildingId === c.insideId) this.maybeBegin(task, c);
  }

  // ---------------------------------------------------------------- projects

  createProject(plan: ProjectPlan, source: SimProject['source'], buildingId: string, companyId: string | null, commandId: string | null, urgent = false): SimProject {
    const sim = this.sim;
    const slug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const project: SimProject = {
      id: sim.newId('project'),
      name: plan.name,
      description: plan.description,
      companyId,
      buildingId,
      source,
      status: 'ACTIVE',
      progress: 0,
      tasks: [],
      createdAt: sim.time,
      completedAt: null,
      workspace: `/projects/${slug || 'project'}`,
      report: null,
      commandId,
      foundsCompany: plan.foundsCompany ?? null,
      planner: plan.planner,
      urgent,
    };
    const keyToId = new Map<string, string>();
    for (const pt of plan.tasks) keyToId.set(pt.key, sim.newId('task'));
    for (const pt of plan.tasks) {
      const owner = (pt.specialist ? this.specialists().find((c) => c.profile.agent!.agency === pt.specialist) : undefined) ?? this.core().find((c) => c.profile.role === pt.role);
      const loc = pt.location ? sim.landmark(pt.location) : null;
      const where = loc?.id ?? owner?.profile.workplaceId ?? buildingId;
      const task: SimTask = {
        id: keyToId.get(pt.key)!,
        projectId: project.id,
        title: pt.title,
        role: pt.role,
        ...(pt.specialist ? { specialist: pt.specialist } : {}),
        assigneeId: null,
        status: pt.dependsOn.length ? 'BLOCKED' : 'PENDING',
        progress: 0,
        work: pt.work,
        dependsOn: pt.dependsOn.map((k) => keyToId.get(k)!).filter(Boolean),
        buildingId: where,
        createdAt: sim.time,
        startedAt: null,
        completedAt: null,
        output: null,
        artifact: `${project.workspace}/${pt.artifact}`,
      };
      sim.state.tasks.push(task);
      this.taskById.set(task.id, task);
      project.tasks.push(task.id);
    }
    sim.state.projects.push(project);
    sim.bus.emit('project.created', sim.time, { project });
    for (const id of project.tasks) sim.bus.emit('task.created', sim.time, { task: this.task(id)! });
    this.assign();
    return project;
  }

  /** Each working hour: start company projects for idle core citizens. */
  hourly(): void {
    const sim = this.sim;
    const h = hourOf(sim.time);
    if (isWeekend(sim.time) || h < 8 || h > 17) return;
    const active = sim.state.projects.filter((p) => p.status === 'ACTIVE' && p.source === 'company').length;
    if (active < 4) {
      const idleRoles = new Set(this.core().filter((c) => !c.dyn.currentTaskId).map((c) => c.profile.role));
      const options = COMPANY_PROJECTS.filter(
        (t) =>
          t.tasks.some((x) => idleRoles.has(x.role)) &&
          !sim.state.projects.some((p) => p.status === 'ACTIVE' && p.buildingId === sim.landmark(t.landmark)?.id),
      );
      const tpl = options.length ? sim.rng.pick(options) : null;
      const b = tpl ? sim.landmark(tpl.landmark) : null;
      if (tpl && b) {
        const name = sim.rng.pick(tpl.names);
        const biz = sim.economy.byBuilding(b.id);
        this.createProject(
          {
            name,
            kind: 'company',
            description: `${b.name} internal project`,
            planner: 'company-backlog',
            tasks: tpl.tasks.map((t) => ({
              key: t.key,
              title: t.title,
              role: t.role,
              work: t.work,
              dependsOn: t.deps,
              location: t.at,
              description: t.title,
              artifact: `${t.key}.md`,
            })),
          },
          'company',
          b.id,
          biz?.id ?? null,
          null,
        );
      }
    }
    this.assign();
  }

  /** Assign ready tasks to free core citizens with the right role. JARVIS work first. */
  assign(): void {
    const sim = this.sim;
    const tasks = sim.state.tasks
      .filter((t) => (t.status === 'PENDING' || t.status === 'BLOCKED') && !t.assigneeId)
      .sort((a, b) => {
        const pa = this.project(a.projectId)?.source === 'jarvis' ? 0 : 1;
        const pb = this.project(b.projectId)?.source === 'jarvis' ? 0 : 1;
        return pa - pb || a.createdAt - b.createdAt;
      });
    for (const t of tasks) {
      if (t.dependsOn.some((d) => this.task(d)?.status !== 'COMPLETED')) {
        t.status = 'BLOCKED';
        continue;
      }
      t.status = 'PENDING';
      // a hired specialist who lives in town does the task; otherwise the workforce role takes it
      const spec = t.specialist ? this.specialists().find((x) => x.profile.agent!.agency === t.specialist) : undefined;
      let c = spec && !spec.dyn.currentTaskId && spec.profile.workplaceId ? spec : this.core().find((x) => x.profile.role === t.role && !x.dyn.currentTaskId);
      if (spec && c !== spec && spec.dyn.currentTaskId && c) {
        // the specialist is busy: wait for them unless the task has waited a working day
        if (sim.time - t.createdAt < 8 * 3600) continue;
      }
      if (!c && t.specialist) {
        // a free resident specialist from the same division takes the hired specialist's playbook
        const division = agencyAgent(t.specialist)?.division;
        c = this.specialists().find((x) => !x.dyn.currentTaskId && !!x.profile.workplaceId && agencyAgent(x.profile.agent!.agency)?.division === division);
      }
      if (!c && this.project(t.projectId)?.source === 'jarvis') {
        // JARVIS work has priority: pause a routine company task of the right role
        c = this.core().find((x) => {
          if (x.profile.role !== t.role || !x.dyn.currentTaskId) return false;
          const cur = this.task(x.dyn.currentTaskId);
          return !!cur && this.project(cur.projectId)?.source === 'company';
        });
        if (c) {
          const paused = this.task(c.dyn.currentTaskId!)!;
          paused.assigneeId = null;
          paused.status = 'PENDING';
          c.dyn.currentTaskId = null;
          this.activity(c, `Pausing "${paused.title}" for JARVIS priority work`, 'task', paused.buildingId);
        }
      }
      if (!c) continue;
      t.assigneeId = c.profile.id;
      t.status = 'ACTIVE';
      c.dyn.currentTaskId = t.id;
      const b = sim.building(t.buildingId);
      this.activity(c, `Assigned "${t.title}" (${this.project(t.projectId)?.name}) at ${b.name}`, 'task', b.id);
      // re-plan now so the citizen heads to the right building during work hours
      if (!c.trip && !c.walker) sim.citizens.schedule(c, sim.time + 60);
      if (c.insideId === t.buildingId && c.dyn.status === 'WORKING') this.maybeBegin(t, c);
    }
  }

  /** Live (AI) execution applies to JARVIS projects; company backlog work stays simulated. */
  isLive(task: SimTask): boolean {
    return this.executor.mode === 'live' && this.project(task.projectId)?.source === 'jarvis';
  }

  /** Urgent work pulls the assignee in outside normal hours (unless exhausted). */
  urgentTaskFor(c: CitizenRT): SimTask | null {
    const id = c.dyn.currentTaskId;
    if (!id) return null;
    const t = this.task(id);
    if (!t || t.status !== 'ACTIVE') return null;
    return this.project(t.projectId)?.urgent ? t : null;
  }

  /** A citizen whose AI task is in flight stays at their desk until the agent finishes. */
  holdsCitizen(c: CitizenRT): boolean {
    const id = c.dyn.currentTaskId;
    if (!id) return false;
    const t = this.task(id);
    return !!t && t.status === 'ACTIVE' && this.isLive(t) && this.liveBegun.has(t.id) && c.insideId === t.buildingId;
  }

  private maybeBegin(task: SimTask, c: CitizenRT): void {
    if (task.startedAt === null) {
      task.startedAt = this.sim.time;
      this.sim.bus.emit('task.started', this.sim.time, { task });
    }
    if (this.isLive(task) && !this.liveBegun.has(task.id)) {
      this.liveBegun.add(task.id);
      const project = this.project(task.projectId)!;
      const inputs = task.dependsOn.map((d) => this.task(d)!).filter(Boolean);
      if (c.profile.agentId) this.sim.bus.emit('agent.started', this.sim.time, { agentId: c.profile.agentId, citizenId: c.profile.id, taskId: task.id });
      this.executor.begin(task, c.profile, project, inputs);
    }
  }

  /** Per sim minute: simulated progress for tasks whose assignee is working in place. */
  minute(): void {
    const sim = this.sim;
    for (const t of sim.state.tasks) {
      if (t.status !== 'ACTIVE' || !t.assigneeId) continue;
      const c = sim.citizenById(t.assigneeId);
      if (!c || c.dyn.status !== 'WORKING' || c.insideId !== t.buildingId) continue;
      if (this.isLive(t)) {
        // real agents report their own progress; (re)start them if needed (e.g. after a restore)
        this.maybeBegin(t, c);
        continue;
      }
      if (t.startedAt === null) this.maybeBegin(t, c);
      const skills = Object.values(c.profile.skills);
      const skill = skills.length ? skills.reduce((a, b) => a + b, 0) / skills.length : 0.7;
      const before = t.progress;
      t.progress = Math.min(1, t.progress + (skill * (0.6 + 0.4 * c.dyn.energy)) / t.work);
      if (before < 0.5 && t.progress >= 0.5) {
        this.activity(c, `${VERB[t.role] ?? 'Working'}… "${t.title}" is halfway done`, 'task', t.buildingId);
      }
      if (t.progress >= 1) {
        const proj = this.project(t.projectId)!;
        this.complete(
          t.id,
          `[SIMULATED] "${t.title}" for ${proj.name} — placeholder deliverable produced by the city simulation. No AI provider was connected, so no real work was performed.`,
        );
      }
    }
  }

  /** Progress reported by a live executor (0..1). */
  reportProgress(taskId: string, progress: number): void {
    const t = this.task(taskId);
    if (!t || t.status !== 'ACTIVE') return;
    t.progress = Math.max(t.progress, Math.min(0.99, progress));
  }

  /** A live executor failed: return the task to the queue. */
  reportFailure(taskId: string, reason: string): void {
    const t = this.task(taskId);
    if (!t) return;
    this.liveBegun.delete(taskId);
    const c = t.assigneeId ? this.sim.citizenById(t.assigneeId) : undefined;
    if (c) {
      c.dyn.currentTaskId = null;
      this.activity(c, `Could not finish "${t.title}": ${reason}`, 'task', t.buildingId);
    }
    t.assigneeId = null;
    t.status = 'PENDING';
    this.assign();
  }

  complete(taskId: string, output: string): void {
    const sim = this.sim;
    const t = this.task(taskId);
    if (!t || t.status === 'COMPLETED') return;
    this.liveBegun.delete(taskId);
    t.status = 'COMPLETED';
    t.progress = 1;
    t.completedAt = sim.time;
    t.output = output;
    const c = t.assigneeId ? sim.citizenById(t.assigneeId) : undefined;
    if (c) {
      c.dyn.currentTaskId = null;
      this.activity(c, `Completed "${t.title}" → ${t.artifact}`, 'task', t.buildingId);
      const proj0 = this.project(t.projectId);
      sim.life.addDeed(c, 'task', `Finished "${t.title}" for ${proj0?.name ?? 'a JARVIS project'}.`, this.executor.mode === 'live' ? 'ai' : 'sim', { buildingId: t.buildingId });
      if (c.profile.agentId) sim.bus.emit('agent.completed', sim.time, { agentId: c.profile.agentId, citizenId: c.profile.id, taskId });
      if (!c.trip && !c.walker) sim.citizens.schedule(c, sim.time + 60);
    }
    sim.bus.emit('task.completed', sim.time, { task: t });
    const proj = this.project(t.projectId)!;
    const tasks = proj.tasks.map((id) => this.task(id)!);
    proj.progress = tasks.filter((x) => x.status === 'COMPLETED').length / tasks.length;
    if (tasks.every((x) => x.status === 'COMPLETED')) this.completeProject(proj, tasks);
    this.assign();
  }

  private completeProject(p: SimProject, tasks: SimTask[]): void {
    const sim = this.sim;
    p.status = 'COMPLETED';
    p.completedAt = sim.time;
    p.progress = 1;
    const live = this.executor.mode === 'live';
    p.report = [
      `# ${p.name} — final synthesis`,
      live ? '' : '> SIMULATED: produced by the city simulation; no AI provider was connected.',
      '',
      ...tasks.map((t) => `- **${t.title}** (${agencyAgent(t.specialist)?.name ?? CORE_ROLES[t.role].label}): ${t.output ?? 'n/a'}`),
    ].join('\n');
    sim.bus.emit('project.completed', sim.time, { project: p });
    const team = [...new Set(tasks.map((t) => t.assigneeId).filter((x): x is string => !!x))];
    const lead = team.length ? sim.citizenById(team[0]) : undefined;
    if (lead) sim.life.addDeed(lead, 'project', team.length > 1 ? `Delivered "${p.name}" with ${team.length - 1} other agent${team.length === 2 ? '' : 's'}.` : `Delivered "${p.name}".`, live ? 'ai' : 'sim', { buildingId: p.buildingId, others: team.slice(1) });
    sim.cityEvents.news('project', `Project complete: ${p.name}`, `${tasks.length} tasks delivered by the Morphis workforce.`, 'info', p.buildingId);
    const biz = p.companyId ? sim.economy.byId(p.companyId) : undefined;
    if (biz) {
      const bonus = 2500 + tasks.length * 600;
      biz.cash += bonus;
      biz.revenue += bonus;
      biz.revenueToday += bonus;
    }
    if (p.source === 'jarvis') {
      const cmd = sim.state.commands.find((c) => c.id === p.commandId);
      if (cmd) {
        cmd.status = 'COMPLETED';
        cmd.message = `Project "${p.name}" completed.`;
        sim.bus.emit('jarvis.command', sim.time, { command: cmd });
      }
      if (p.foundsCompany) {
        const site = sim.findCompanySite();
        if (site) {
          const company = sim.economy.foundCompany(p.foundsCompany, site, ['Subscriptions', 'Services']);
          if (company) {
            sim.cityEvents.news('economy', `${p.foundsCompany} opens in ${sim.world.districts.find((d) => d.id === site.districtId)?.name}`, `Founded from JARVIS project "${p.name}". Moves into ${site.name} and starts hiring (simulated company).`, 'info', site.id);
          }
        }
      }
    }
  }
}
