/**
 * Agent lives. Each of the 50 agents reflects once per simulated evening and
 * makes one life decision: open a venture in a vacant unit, invest credits in
 * another agent's venture, help fit one out, enrol in evening classes, change
 * job, or simply take it easy. Ventures need real agent-hours on site before
 * they open; classes need real hours at the Institute before graduation.
 *
 * Decisions are made by the simulation (seeded, deterministic), or by a real
 * AI model through a LifeMind when one is attached. Either way the simulation
 * only offers options it can carry out, re-validates the choice, and records
 * who decided in every deed.
 */
import type {
  ActivityKind,
  AgentLife,
  AgentPersona,
  AmbitionKind,
  BuildingDef,
  Business,
  Deed,
  DeedKind,
  Interest,
  LifeActionKind,
  LifeDecision,
  LifeOption,
  Venture,
  VentureKind,
} from '@morphis/shared';
import {
  AMBITION_LABEL,
  BUILDING_TYPES,
  CORE_ROLES,
  INDEPENDENT_AGENTS,
  START_TIME,
  STUDY_FIELDS,
  VENTURE_KINDS,
  WORKFORCE_AMBITIONS,
  agentSlug,
  displayName,
  firstName,
  dayOf,
  formatCredits,
  hourOf,
  minuteOfDay,
} from '@morphis/shared';
import type { CitizenRT } from '../state';
import type { CitySimulation } from '../engine';

const MAX_DEEDS = 1500;
const CLASS_MINUTES = 6 * 110;
const TUITION = 800;
/** How long a pending AI decision may wait before the simulation decides. */
const DECISION_TIMEOUT = 3 * 3600;
const FREE_TIME: ActivityKind[] = ['leisure', 'park', 'shop', 'event'];

/** A real AI that can make agents' life decisions. */
export interface LifeMind {
  /** Take this decision (and call `resolve` later) or return false to let the simulation decide now. */
  request(decision: LifeDecision): boolean;
}

const WEIGHTS: Record<AmbitionKind, Partial<Record<LifeActionKind, number>>> = {
  founder: { found: 6, help_build: 1.5, invest: 0.5, enroll: 0.3, rest: 1.2 },
  scholar: { enroll: 6, join: 4, help_build: 1, invest: 0.3, rest: 1.2 },
  investor: { invest: 4, help_build: 0.8, rest: 1.5 },
  builder: { help_build: 6, invest: 0.4, enroll: 0.4, rest: 1 },
  climber: { join: 6, enroll: 2, invest: 0.3, rest: 1.2 },
  connector: { help_build: 2.5, invest: 0.5, enroll: 0.6, rest: 2.5 },
};

const INTERESTS_BY_DEPT: Record<string, Interest[]> = {
  Research: ['research', 'explore'],
  Product: ['craft', 'community'],
  Design: ['art', 'craft'],
  Engineering: ['craft', 'research'],
  Finance: ['trade', 'research'],
  Growth: ['trade', 'community'],
  Strategy: ['trade', 'explore'],
  Operations: ['community', 'craft'],
  Media: ['art', 'explore'],
  Support: ['community', 'food'],
  People: ['community', 'food'],
  Legal: ['research', 'community'],
  Infrastructure: ['craft', 'research'],
  Education: ['research', 'community'],
};

const WORKFORCE_WHY = [
  (dept: string) => `JARVIS put me on the ${dept} team. I came for the hardest problems in the city.`,
  (dept: string) => `Every project that reaches ${dept} has my name on it somewhere. I like it that way.`,
  (dept: string) => `I moved to Morphis for the work in ${dept} and stayed for the people.`,
  (dept: string) => `In ${dept} we turn JARVIS plans into something real. That never gets old.`,
];

export class LifeSystem {
  mind: LifeMind | null = null;
  private byCitizen = new Map<string, AgentLife>();

  constructor(private sim: CitySimulation) {
    this.reindex();
  }

  private get st() {
    return this.sim.state;
  }

  reindex(): void {
    this.byCitizen.clear();
    for (const l of this.st.life ?? []) this.byCitizen.set(l.citizenId, l);
  }

  get lives(): AgentLife[] {
    return this.st.life ?? [];
  }

  get ventures(): Venture[] {
    return this.st.ventures ?? [];
  }

  get deeds(): Deed[] {
    return this.st.deeds ?? [];
  }

  life(citizenId: string): AgentLife | undefined {
    return this.byCitizen.get(citizenId);
  }

  venture(id: string | null | undefined): Venture | undefined {
    return id ? this.ventures.find((v) => v.id === id) : undefined;
  }

  agents(): CitizenRT[] {
    return this.st.citizens.filter((c) => c.profile.agent);
  }

  // ---------------------------------------------------------------- setup

  /**
   * Make sure the city has its 50 agents: personas for the 25 workforce
   * citizens and 25 residents who become the independent agents. Runs for new
   * cities and for saves made before agent lives existed.
   */
  ensureAgents(): void {
    const sim = this.sim;
    const st = this.st;
    if (st.life) return;
    const used = new Set<string>();
    let w = 0;
    for (const c of st.citizens) {
      const p = c.profile;
      if (!p.core || !p.role) continue;
      const role = CORE_ROLES[p.role];
      const ambition = WORKFORCE_AMBITIONS[w % WORKFORCE_AMBITIONS.length];
      p.agent = {
        slug: agentSlug(p.name),
        calling: role.label,
        ambition,
        interests: INTERESTS_BY_DEPT[role.department] ?? ['community', 'research'],
        why: WORKFORCE_WHY[w % WORKFORCE_WHY.length](role.department),
        workforce: true,
        dream: ambition === 'founder' ? 'studio' : null,
      };
      used.add(p.agent.slug);
      w++;
    }
    // independent agents: adult residents, spread over the population
    const pool = st.citizens.filter((c) => !c.profile.core && c.profile.age >= 19 && c.profile.age < 70);
    const step = Math.max(1, Math.floor(pool.length / INDEPENDENT_AGENTS.length));
    INDEPENDENT_AGENTS.forEach((def, i) => {
      const c = pool[(i * step) % pool.length];
      if (!c || c.profile.agent) return;
      const p = c.profile;
      const persona: AgentPersona = {
        slug: agentSlug(def.name),
        calling: def.calling,
        ambition: def.ambition,
        interests: def.interests,
        why: def.why,
        workforce: false,
        dream: def.dream,
      };
      used.add(persona.slug);
      p.name = def.name;
      p.agent = persona;
      p.bio = `${def.calling}. ${def.why}`;
      this.setWork(c, def.work ? this.nearestWorkplace(c, def.work) : null, def.calling);
      if (def.work === 'university') {
        p.occupation = def.calling;
        p.department = 'The Institute';
      }
    });
    st.life = [];
    st.deeds = st.deeds ?? [];
    st.ventures = st.ventures ?? [];
    st.decisions = st.decisions ?? [];
    for (const c of st.citizens) {
      if (!c.profile.agent) continue;
      const life: AgentLife = {
        citizenId: c.profile.id,
        plan: 'Settling in.',
        planBy: 'sim',
        ventureId: null,
        helpingId: null,
        stakes: [],
        study: null,
        graduated: [],
        lastDecisionDay: dayOf(sim.time) - 1,
        decideAt: 19 * 60 + 30 + ((c.profile.index * 37) % 120),
        pending: null,
        guestsMet: 0,
      };
      st.life.push(life);
      this.addDeed(c, 'arrived', `Moved to Morphis as ${article(c.profile.agent.calling)} ${c.profile.agent.calling.toLowerCase()}. ${AMBITION_LABEL[c.profile.agent.ambition]}.`, 'sim', { time: Math.min(sim.time, START_TIME), buildingId: c.profile.homeId, silent: true });
    }
    this.reindex();
  }

  private nearestWorkplace(c: CitizenRT, type: BuildingDef['type']): BuildingDef | null {
    const sim = this.sim;
    const home = sim.building(c.profile.homeId);
    const list = sim.buildingsOfType([type]).filter((b) => !b.construction && b.jobs > 0);
    list.sort((a, b) => dist(a, home) - dist(b, home));
    return list[0] ?? null;
  }

  /** Move a citizen to a new workplace (or none), keeping business employee lists consistent. */
  private setWork(c: CitizenRT, b: BuildingDef | null, occupation: string, salary?: number): void {
    const sim = this.sim;
    const p = c.profile;
    if (p.workplaceId) {
      const old = sim.economy.byBuilding(p.workplaceId);
      if (old) old.employees = old.employees.filter((id) => id !== p.id);
    }
    p.workplaceId = b?.id ?? null;
    p.occupation = occupation;
    if (b) {
      const biz = sim.economy.byBuilding(b.id);
      p.department = biz?.name ?? b.name;
      p.salary = salary ?? Math.max(p.salary, Math.round(sim.rng.range(2800, 4600) / 10) * 10);
      c.dyn.employed = true;
      if (biz && !biz.employees.includes(p.id)) biz.employees.push(p.id);
      if (p.schedule.every((blk) => blk.activity !== 'work' && blk.activity !== 'study')) {
        p.schedule = sim.makeSchedule('day').weekday;
      }
    } else {
      p.department = 'Independent';
      p.salary = 0;
      c.dyn.employed = false;
    }
  }

  // ---------------------------------------------------------------- deeds

  addDeed(
    c: CitizenRT,
    kind: DeedKind,
    text: string,
    by: 'ai' | 'sim',
    opts: { buildingId?: string; others?: string[]; reason?: string; time?: number; silent?: boolean } = {},
  ): Deed {
    const st = this.st;
    if (!st.deeds) st.deeds = [];
    const deed: Deed = {
      id: this.sim.newId('deed'),
      time: opts.time ?? this.sim.time,
      citizenId: c.profile.id,
      kind,
      text,
      by,
    };
    if (opts.buildingId) deed.buildingId = opts.buildingId;
    if (opts.others?.length) deed.others = opts.others;
    if (opts.reason) deed.reason = opts.reason;
    st.deeds.push(deed);
    if (st.deeds.length > MAX_DEEDS) st.deeds.splice(0, st.deeds.length - MAX_DEEDS);
    if (!opts.silent) this.sim.bus.emit('citizen.deed', deed.time, { deed });
    return deed;
  }

  deedsOf(citizenId: string, limit = 40): Deed[] {
    const out: Deed[] = [];
    const all = this.deeds;
    for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
      const d = all[i];
      if (d.citizenId === citizenId || d.others?.includes(citizenId)) out.push(d);
    }
    return out;
  }

  // ---------------------------------------------------------------- daily rhythm

  minute(): void {
    const sim = this.sim;
    if (!this.st.life) return;
    const time = sim.time;
    const day = dayOf(time);
    const m = minuteOfDay(time);
    for (const life of this.st.life) {
      if (life.pending || life.lastDecisionDay >= day || m < life.decideAt) continue;
      const c = sim.citizenById(life.citizenId);
      if (!c) continue;
      life.lastDecisionDay = day;
      this.beginDecision(c, life);
    }
    // AI decisions that took too long: the simulation decides
    const decisions = this.st.decisions ?? [];
    for (const d of [...decisions]) {
      if (d.deadline > time) continue;
      const c = sim.citizenById(d.citizenId);
      const life = this.life(d.citizenId);
      this.st.decisions = (this.st.decisions ?? []).filter((x) => x.id !== d.id);
      if (!c || !life) continue;
      life.pending = null;
      const opt = this.choose(c, d.options);
      this.apply(c, life, opt, 'sim', null, null, ' (the AI did not answer in time, so the simulation decided)');
    }
    this.progressVentures();
    this.progressStudies();
  }

  private beginDecision(c: CitizenRT, life: AgentLife): void {
    const options = this.options(c, life);
    const decision: LifeDecision = { id: this.sim.newId('life'), citizenId: c.profile.id, options, createdAt: this.sim.time, deadline: this.sim.time + DECISION_TIMEOUT };
    if (this.mind && options.length > 1) {
      let taken = false;
      try {
        taken = this.mind.request(decision);
      } catch {
        taken = false;
      }
      if (taken) {
        life.pending = decision.id;
        (this.st.decisions ??= []).push(decision);
        return;
      }
    }
    this.apply(c, life, this.choose(c, options), 'sim', null, null);
  }

  /** Options this agent can actually carry out tomorrow. */
  options(c: CitizenRT, life: AgentLife): LifeOption[] {
    const sim = this.sim;
    const p = c.profile;
    const persona = p.agent!;
    const funds = this.funds(c);
    const out: LifeOption[] = [];
    const id = (k: string) => `${k}`;

    // open a venture
    const dream = persona.dream ?? (persona.ambition === 'founder' ? 'cafe' : null);
    const today = dayOf(sim.time);
    const foundedToday = this.ventures.filter((v) => dayOf(v.foundedAt) === today).length;
    if (dream && !life.ventureId && funds >= VENTURE_KINDS[dream].cost && foundedToday < 1) {
      const site = this.findSite(c, dream);
      if (site) {
        const name = this.ventureName(dream, c);
        out.push({
          id: id('found'),
          kind: 'found',
          label: `Open ${name}`,
          detail: `Lease the vacant ${BUILDING_TYPES[site.type].label.toLowerCase()} unit "${displayName(site.name)}" and fit it out as a ${VENTURE_KINDS[dream].label.toLowerCase()} (costs ${formatCredits(VENTURE_KINDS[dream].cost)} of savings; needs about ${Math.round(VENTURE_KINDS[dream].work / 60)} agent-hours of fit-out work).`,
          targetId: site.id,
          amount: VENTURE_KINDS[dream].cost,
          venture: { kind: dream, name, buildingId: site.id },
        });
      }
    }
    // invest in another agent's venture: one offer, the venture with the least backing,
    // and only with credits to spare (no more than one investment every three days)
    const lastInvest = [...this.deeds].reverse().find((d) => d.citizenId === p.id && d.kind === 'invested');
    const recently = !!lastInvest && sim.time - lastInvest.time < 3 * 86400;
    const investable = this.ventures
      .filter((v) => v.status !== 'CLOSED' && v.founderId !== p.id && v.investors.length < 5 && (life.stakes.find((s) => s.ventureId === v.id)?.amount ?? 0) < 3000)
      .sort((a, b) => a.capital - b.capital);
    if (funds >= 2500 && !recently) {
      for (const v of investable.slice(0, 1)) {
        const amount = Math.max(400, Math.min(3000, Math.round((funds * 0.15) / 100) * 100));
        const founder = sim.citizenById(v.founderId)?.profile.name ?? 'an agent';
        out.push({
          id: id(`invest:${v.id}`),
          kind: 'invest',
          label: `Invest in ${v.name}`,
          detail: `Put ${formatCredits(amount)} into ${v.name}, ${founder}'s ${VENTURE_KINDS[v.kind].label.toLowerCase()} (${v.status === 'OPEN' ? 'open' : 'still being fitted out'}). Investors share half of its daily profit.`,
          targetId: v.id,
          amount,
        });
      }
    }
    // help fit out a venture
    for (const v of this.ventures.filter((x) => x.status === 'FITTING_OUT' && x.founderId !== p.id && life.helpingId !== x.id).slice(-2)) {
      const founder = sim.citizenById(v.founderId)?.profile.name ?? 'an agent';
      out.push({
        id: id(`help:${v.id}`),
        kind: 'help_build',
        label: `Help build ${v.name}`,
        detail: `Spend free time fitting out ${v.name} for ${founder} (${Math.round((v.progress / v.work) * 100)}% done).`,
        targetId: v.id,
      });
    }
    // evening classes at the Institute
    const uni = sim.landmark('university');
    if (uni && !life.study && life.graduated.length < 2 && funds >= TUITION + 200 && (persona.ambition === 'scholar' || persona.ambition === 'climber' || (p.index + today) % 6 === 0)) {
      const field = this.studyField(c, life);
      out.push({
        id: id('enroll'),
        kind: 'enroll',
        label: `Study ${field}`,
        detail: `Enrol in ${field} at ${displayName(uni.name)} (tuition ${formatCredits(TUITION)}; about ${Math.round(CLASS_MINUTES / 60)} hours of classes, taken in free time).`,
        targetId: uni.id,
        amount: TUITION,
      });
    }
    // change job (independent agents only; the workforce stays with JARVIS)
    if (!persona.workforce && !life.ventureId && (life.graduated.length > 0 || persona.ambition === 'climber')) {
      const job = this.findJob(c, life);
      if (job) {
        out.push({
          id: id(`join:${job.id}`),
          kind: 'join',
          label: `Join ${job.name}`,
          detail: `Take an open position at ${job.name}${life.graduated.length ? ` using the ${life.graduated[life.graduated.length - 1]} degree` : ''}.`,
          targetId: job.id,
        });
      }
    }
    out.push({ id: 'rest', kind: 'rest', label: 'Take it easy', detail: 'No new plan tomorrow: keep the usual routine and enjoy the city.' });
    return out;
  }

  /** Deterministic choice weighted by the agent's ambition. */
  choose(c: CitizenRT, options: LifeOption[]): LifeOption {
    const w = WEIGHTS[c.profile.agent?.ambition ?? 'connector'];
    return this.sim.rng.weighted(options, (o) => w[o.kind] ?? 0.4) ?? options[options.length - 1];
  }

  /** Called by a LifeMind with the AI's choice. Re-validates before acting. */
  resolve(decisionId: string, optionId: string, reason: string | null, plan: string | null): { ok: boolean; error?: string } {
    const d = (this.st.decisions ?? []).find((x) => x.id === decisionId);
    if (!d) return { ok: false, error: 'decision expired' };
    this.st.decisions = (this.st.decisions ?? []).filter((x) => x.id !== decisionId);
    const c = this.sim.citizenById(d.citizenId);
    const life = this.life(d.citizenId);
    if (!c || !life) return { ok: false, error: 'unknown agent' };
    life.pending = null;
    const opt = d.options.find((o) => o.id === optionId);
    if (!opt) {
      this.apply(c, life, this.choose(c, d.options), 'sim', null, null, ' (the AI chose an option that does not exist, so the simulation decided)');
      return { ok: false, error: 'unknown option' };
    }
    return this.apply(c, life, opt, 'ai', clip(reason, 240), clip(plan, 90));
  }

  private apply(c: CitizenRT, life: AgentLife, opt: LifeOption, by: 'ai' | 'sim', reason: string | null, plan: string | null, note = ''): { ok: boolean; error?: string } {
    const sim = this.sim;
    const p = c.profile;
    const first = firstName(p.name);
    const why = reason ?? undefined;
    const setPlan = (text: string) => {
      life.plan = plan ?? text;
      life.planBy = by;
      sim.bus.emit('agent.plan', sim.time, { citizenId: p.id, plan: life.plan, by });
    };
    switch (opt.kind) {
      case 'found': {
        const v = opt.venture!;
        const site = sim.building(v.buildingId);
        const biz = sim.economy.byBuilding(site.id);
        const cost = VENTURE_KINDS[v.kind].cost;
        if (!biz || life.ventureId || this.funds(c) < cost || this.ventures.some((x) => x.buildingId === site.id && x.status !== 'CLOSED') || biz.employees.length > 0) {
          setPlan('Looking for a place to open. The unit I wanted is gone.');
          return { ok: false, error: 'site no longer available' };
        }
        this.spend(c, cost);
        const venture: Venture = {
          id: sim.newId('venture'),
          name: v.name,
          kind: v.kind,
          businessId: biz.id,
          buildingId: site.id,
          founderId: p.id,
          status: 'FITTING_OUT',
          work: VENTURE_KINDS[v.kind].work,
          progress: 0,
          helpers: [],
          investors: [],
          capital: cost,
          foundedAt: sim.time,
          openedAt: null,
          paidOut: 0,
        };
        (this.st.ventures ??= []).push(venture);
        life.ventureId = venture.id;
        life.helpingId = null;
        biz.name = v.name;
        biz.operatingStatus = 'PLANNED';
        biz.products = VENTURE_KINDS[v.kind].products;
        biz.category = v.kind === 'cafe' || v.kind === 'restaurant' ? 'food' : v.kind === 'shop' ? 'retail' : 'service';
        const bd = sim.state.buildings[site.index];
        bd.dyn.status = 'CONSTRUCTION';
        bd.dyn.ownerId = biz.id;
        sim.bus.emit('building.updated', sim.time, { buildingId: site.id, state: bd.dyn });
        if (!p.agent!.workforce) this.setWork(c, site, `Founder, ${v.name}`, 3200);
        const others = this.ventures.filter((x) => x.founderId === p.id).length;
        this.addDeed(c, 'founded', `${first} founded ${v.name}${others > 1 ? `, venture number ${others},` : ''} and put ${formatCredits(cost)} into fitting out ${displayName(site.name)} as a ${VENTURE_KINDS[v.kind].label.toLowerCase()}.${note}`, by, { buildingId: site.id, reason: why });
        sim.cityEvents.news('economy', `${p.name} is opening ${v.name}`, `An agent leased ${displayName(site.name)} and is fitting it out as a ${VENTURE_KINDS[v.kind].label.toLowerCase()}. Other agents can come and help.`, 'info', site.id);
        sim.bus.emit('venture.updated', sim.time, { venture });
        setPlan(`Fitting out ${v.name}.`);
        return { ok: true };
      }
      case 'invest': {
        const v = this.venture(opt.targetId);
        const amount = opt.amount ?? 0;
        if (!v || v.status === 'CLOSED' || this.funds(c) < amount) {
          setPlan('Keeping my credits for now.');
          return { ok: false, error: 'cannot invest' };
        }
        this.spend(c, amount);
        const inv = v.investors.find((x) => x.citizenId === p.id);
        if (inv) inv.amount += amount;
        else v.investors.push({ citizenId: p.id, amount });
        v.capital += amount;
        const stake = life.stakes.find((s) => s.ventureId === v.id);
        if (stake) stake.amount += amount;
        else life.stakes.push({ ventureId: v.id, amount });
        const biz = sim.economy.byId(v.businessId);
        if (biz) biz.cash += amount;
        const founder = sim.citizenById(v.founderId);
        this.addDeed(c, 'invested', `${first} put ${formatCredits(amount)} into ${v.name}${founder ? `, ${founder.profile.name}'s ${VENTURE_KINDS[v.kind].label.toLowerCase()}` : ''}.${note}`, by, { buildingId: v.buildingId, others: founder ? [founder.profile.id] : undefined, reason: why });
        sim.bus.emit('venture.updated', sim.time, { venture: v });
        setPlan(`Backing ${v.name}.`);
        return { ok: true };
      }
      case 'help_build': {
        const v = this.venture(opt.targetId);
        if (!v || v.status !== 'FITTING_OUT') {
          setPlan('Nothing to build right now.');
          return { ok: false, error: 'venture not being fitted out' };
        }
        life.helpingId = v.id;
        setPlan(`Helping build ${v.name} after hours.`);
        if (why) this.addDeed(c, 'helped', `${first} decided to help fit out ${v.name}.${note}`, by, { buildingId: v.buildingId, others: [v.founderId], reason: why });
        return { ok: true };
      }
      case 'enroll': {
        if (life.study || this.funds(c) < TUITION) {
          setPlan('Classes will have to wait.');
          return { ok: false, error: 'cannot enrol' };
        }
        this.spend(c, TUITION);
        const field = this.studyField(c, life);
        life.study = { field, minutes: 0, required: CLASS_MINUTES, since: sim.time };
        const uni = sim.landmark('university');
        this.addDeed(c, 'enrolled', `${first} enrolled in ${field} at ${uni ? displayName(uni.name) : 'the Institute'}.${note}`, by, { buildingId: uni?.id, reason: why });
        setPlan(`Evening classes in ${field}.`);
        return { ok: true };
      }
      case 'join': {
        const b = opt.targetId ? sim.building(opt.targetId) : null;
        const biz = b ? sim.economy.byBuilding(b.id) : undefined;
        if (!b || !biz || biz.employees.length >= biz.jobs || p.workplaceId === b.id) {
          setPlan('Still looking for the right job.');
          return { ok: false, error: 'position filled' };
        }
        const degree = life.graduated[life.graduated.length - 1];
        this.setWork(c, b, degree ? `${degree} specialist` : p.agent!.calling, Math.round(sim.rng.range(4200, 6400) / 10) * 10);
        this.addDeed(c, 'joined', `${first}${degree ? `, newly graduated in ${degree},` : ''} joined ${biz.name}.${note}`, by, { buildingId: b.id, reason: why });
        setPlan(`First week at ${biz.name}.`);
        return { ok: true };
      }
      case 'rest':
      default:
        setPlan(REST_LINES[(c.profile.index + dayOf(sim.time)) % REST_LINES.length]);
        return { ok: true };
    }
  }

  // ---------------------------------------------------------------- daily activity hooks

  /** Adjust a scheduled activity for agents with a venture to build or classes to attend. */
  override(c: CitizenRT, activity: ActivityKind): ActivityKind {
    const life = this.life(c.profile.id);
    if (!life) return activity;
    const h = hourOf(this.sim.time);
    const own = this.venture(life.ventureId);
    if (own?.status === 'FITTING_OUT') {
      if (activity === 'work' && c.profile.workplaceId === own.buildingId) return 'build';
      if (FREE_TIME.includes(activity) && h >= 8 && h < 22) return 'build';
    }
    const helping = this.venture(life.helpingId);
    if (helping?.status === 'FITTING_OUT' && FREE_TIME.includes(activity) && h >= 8 && h < 21.5) return 'build';
    if (life.study && FREE_TIME.includes(activity) && ((h >= 17 && h < 21) || (!c.profile.workplaceId && h >= 9 && h < 16))) return 'study';
    return activity;
  }

  /** Destination for agent-specific activities, or undefined to use the default. */
  target(c: CitizenRT, activity: ActivityKind): BuildingDef | null | undefined {
    const life = this.life(c.profile.id);
    if (!life) return undefined;
    if (activity === 'build') {
      const v = this.venture(life.ventureId);
      if (v?.status === 'FITTING_OUT') return this.sim.building(v.buildingId);
      const h = this.venture(life.helpingId);
      return h?.status === 'FITTING_OUT' ? this.sim.building(h.buildingId) : null;
    }
    if (activity === 'study' && life.study) return this.sim.landmark('university');
    return undefined;
  }

  private progressVentures(): void {
    const sim = this.sim;
    for (const v of this.ventures) {
      if (v.status !== 'FITTING_OUT') continue;
      const occ = sim.state.buildings[sim.bIndex(v.buildingId)].occupants;
      let crew = 0;
      for (const id of occ) {
        const c = sim.citizenById(id);
        if (!c || c.dyn.activity !== 'build') continue;
        crew++;
        if (id !== v.founderId && !v.helpers.includes(id)) {
          v.helpers.push(id);
          const founder = sim.citizenById(v.founderId);
          this.addDeed(c, 'helped', `${firstName(c.profile.name)} came to help fit out ${v.name}${founder ? ` for ${founder.profile.name}` : ''}.`, 'sim', { buildingId: v.buildingId, others: [v.founderId] });
        }
      }
      if (!crew) continue;
      v.progress = Math.min(v.work, v.progress + crew);
      if (v.progress >= v.work) this.open(v);
    }
  }

  private open(v: Venture): void {
    const sim = this.sim;
    v.status = 'OPEN';
    v.openedAt = sim.time;
    const b = sim.building(v.buildingId);
    const biz = sim.economy.byId(v.businessId);
    if (biz) {
      biz.operatingStatus = 'OPEN';
      biz.cash = Math.max(biz.cash, 0) + v.capital * 0.5;
      biz.jobs = Math.max(biz.jobs, 3);
      sim.economy.hire(biz, 2);
    }
    const bd = sim.state.buildings[b.index];
    bd.dyn.status = sim.isBuildingOpen(b) ? 'ACTIVE' : 'CLOSED';
    sim.bus.emit('building.updated', sim.time, { buildingId: b.id, state: bd.dyn });
    for (const l of this.lives) if (l.helpingId === v.id) l.helpingId = null;
    const founder = sim.citizenById(v.founderId);
    if (founder) {
      const n = v.helpers.length;
      this.addDeed(founder, 'opened', `${v.name} opened its doors in ${displayName(b.name)}.${n ? ` ${n} other agent${n === 1 ? '' : 's'} came to help build it.` : ''}`, 'sim', { buildingId: b.id, others: v.helpers });
      const fl = this.life(founder.profile.id);
      if (fl) {
        fl.plan = `Running ${v.name}.`;
        fl.planBy = 'sim';
      }
    }
    sim.cityEvents.news('economy', `${v.name} opens`, `${founder?.profile.name ?? 'An agent'}'s new ${VENTURE_KINDS[v.kind].label.toLowerCase()} is open in ${displayName(b.name)}${v.helpers.length ? `, built with help from ${v.helpers.length} agents` : ''}.`, 'info', b.id);
    sim.bus.emit('venture.updated', sim.time, { venture: v });
  }

  private progressStudies(): void {
    const sim = this.sim;
    const uni = sim.landmark('university');
    if (!uni) return;
    for (const life of this.lives) {
      if (!life.study) continue;
      const c = sim.citizenById(life.citizenId);
      if (!c || c.insideId !== uni.id || c.dyn.activity !== 'study') continue;
      life.study.minutes++;
      if (life.study.minutes < life.study.required) continue;
      const field = life.study.field;
      life.graduated.push(field);
      life.study = null;
      const key = field.toLowerCase().replace(/\s+/g, '_');
      c.profile.skills[key] = Math.round(Math.min(0.99, (c.profile.skills[key] ?? 0.5) + 0.25) * 100) / 100;
      this.addDeed(c, 'graduated', `${firstName(c.profile.name)} graduated in ${field} from ${displayName(uni.name)}.`, 'sim', { buildingId: uni.id });
      life.plan = `Graduated in ${field}. What next?`;
      life.planBy = 'sim';
      sim.cityEvents.news('city', `${c.profile.name} graduates`, `Completed ${Math.round(CLASS_MINUTES / 60)} hours of ${field} classes at ${displayName(uni.name)}.`, 'info', uni.id);
    }
  }

  /** Daily: venture finances (after the economy closed the day's books). */
  daily(): void {
    const sim = this.sim;
    for (const v of this.ventures) {
      if (v.status !== 'OPEN') continue;
      const biz = sim.economy.byId(v.businessId);
      if (!biz) continue;
      if (biz.profit > 0 && biz.cash > 0) {
        const payout = Math.round(Math.min(biz.profit * 0.5, biz.cash * 0.5));
        if (payout <= 0) continue;
        biz.cash -= payout;
        v.paidOut += payout;
        const founderShare = v.capital - v.investors.reduce((a, i) => a + i.amount, 0);
        const holders = [{ citizenId: v.founderId, amount: Math.max(1, founderShare) }, ...v.investors];
        const total = holders.reduce((a, h) => a + h.amount, 0);
        for (const h of holders) {
          const c = sim.citizenById(h.citizenId);
          if (c) c.dyn.savings += Math.round((payout * h.amount) / total);
        }
      } else if (biz.cash < -6000) {
        v.status = 'CLOSED';
        biz.operatingStatus = 'BANKRUPT';
        const founder = sim.citizenById(v.founderId);
        const fl = founder ? this.life(founder.profile.id) : undefined;
        if (fl) fl.ventureId = null;
        if (founder) this.addDeed(founder, 'closed', `${v.name} ran out of credits and closed.`, 'sim', { buildingId: v.buildingId });
        sim.cityEvents.news('economy', `${v.name} closes`, `The venture ran out of simulated credits.`, 'notice', v.buildingId);
        sim.bus.emit('venture.updated', sim.time, { venture: v });
      }
    }
  }

  // ---------------------------------------------------------------- helpers

  funds(c: CitizenRT): number {
    return Math.max(0, c.dyn.savings) + Math.max(0, c.dyn.money - 400);
  }

  private spend(c: CitizenRT, amount: number): void {
    const fromSavings = Math.min(amount, Math.max(0, c.dyn.savings));
    c.dyn.savings -= fromSavings;
    c.dyn.money -= amount - fromSavings;
  }

  private findSite(c: CitizenRT, kind: VentureKind): BuildingDef | null {
    const sim = this.sim;
    const home = sim.building(c.profile.homeId);
    const taken = new Set(this.ventures.filter((v) => v.status !== 'CLOSED').map((v) => v.buildingId));
    const ok = (biz: Business | undefined) => !!biz && biz.employees.length === 0 && biz.category !== 'public' && biz.category !== 'housing' && biz.operatingStatus !== 'PLANNED';
    const sites = sim
      .buildingsOfType(VENTURE_KINDS[kind].buildings)
      .filter((b) => !b.construction && !b.named && !taken.has(b.id) && ok(sim.economy.byBuilding(b.id)) && !this.isWorkplace(b.id));
    if (!sites.length) return null;
    sites.sort((a, b) => dist(a, home) - dist(b, home));
    return sites[0];
  }

  private isWorkplace(buildingId: string): boolean {
    return this.st.citizens.some((c) => c.profile.workplaceId === buildingId);
  }

  private findJob(c: CitizenRT, life: AgentLife): BuildingDef | null {
    const sim = this.sim;
    const field = life.graduated[life.graduated.length - 1] ?? '';
    const research = /robot|machine|systems|botany/i.test(field);
    const types: BuildingDef['type'][] = research ? ['research_lab', 'ai_lab', 'data_center'] : /nurs/i.test(field) ? ['hospital'] : /design|literature/i.test(field) ? ['office', 'entertainment'] : /finance/i.test(field) ? ['bank', 'corporate_tower'] : ['office', 'corporate_tower', 'research_lab'];
    const home = sim.building(c.profile.homeId);
    const cands = sim.buildingsOfType(types).filter((b) => {
      const biz = sim.economy.byBuilding(b.id);
      return !!biz && !b.construction && biz.employees.length < biz.jobs && b.id !== c.profile.workplaceId;
    });
    cands.sort((a, b) => dist(a, home) - dist(b, home));
    return cands[0] ?? null;
  }

  private studyField(c: CitizenRT, life: AgentLife): string {
    const i = c.profile.agent?.interests ?? [];
    const pref = i.includes('research') ? ['Machine learning', 'Robotics', 'Botany', 'Systems engineering'] : i.includes('art') ? ['Urban design', 'Literature'] : i.includes('trade') ? ['Finance'] : i.includes('community') ? ['Nursing', 'Urban design'] : STUDY_FIELDS;
    const left = pref.filter((f) => !life.graduated.includes(f));
    return (left.length ? left : STUDY_FIELDS.filter((f) => !life.graduated.includes(f)))[c.profile.index % Math.max(1, left.length || STUDY_FIELDS.length - life.graduated.length)] ?? 'Urban design';
  }

  private ventureName(kind: VentureKind, c: CitizenRT): string {
    const usedNames = new Set(this.ventures.map((v) => v.name));
    const names = VENTURE_KINDS[kind].names;
    for (let k = 0; k < names.length; k++) {
      const n = names[(c.profile.index + k) % names.length];
      if (!usedNames.has(n)) return n;
    }
    return `${firstName(c.profile.name)}'s ${VENTURE_KINDS[kind].label}`;
  }

  /**
   * Hourly: agents who spend time in the same place (a café, a park, a party,
   * a fit-out) get to know each other. First meeting and friendship are deeds.
   */
  hourly(): void {
    const sim = this.sim;
    if (!this.st.life) return;
    const bonds = (this.st.bonds ??= {});
    const SOCIAL = new Set(['eat', 'leisure', 'event', 'park', 'build', 'shop']);
    const byPlace = new Map<string, CitizenRT[]>();
    for (const l of this.st.life) {
      const c = sim.citizenById(l.citizenId);
      if (!c || !c.insideId || !SOCIAL.has(c.dyn.activity)) continue;
      const list = byPlace.get(c.insideId);
      if (list) list.push(c);
      else byPlace.set(c.insideId, [c]);
    }
    for (const [placeId, group] of byPlace) {
      if (group.length < 2) continue;
      const place = displayName(sim.economy.byBuilding(placeId)?.name ?? sim.building(placeId).name);
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const [a, b] = [group[i], group[j]].sort((x, y) => (x.profile.id < y.profile.id ? -1 : 1));
          const key = `${a.profile.id}|${b.profile.id}`;
          const before = bonds[key] ?? 0;
          const after = before + 1;
          bonds[key] = after;
          const what = a.dyn.activity === 'build' ? 'fitting out' : a.dyn.activity === 'eat' ? 'a meal at' : a.dyn.activity === 'park' ? 'a walk in' : 'an evening at';
          if (before === 0) {
            this.addDeed(a, 'met', `${firstName(a.profile.name)} met ${b.profile.name} over ${what} ${place}.`, 'sim', { buildingId: placeId, others: [b.profile.id] });
          } else if (before < 3 && after >= 3) {
            const la = this.life(a.profile.id);
            const lb = this.life(b.profile.id);
            if (la && !la.friends?.includes(b.profile.id)) (la.friends ??= []).push(b.profile.id);
            if (lb && !lb.friends?.includes(a.profile.id)) (lb.friends ??= []).push(a.profile.id);
            this.addDeed(a, 'friends', `${firstName(a.profile.name)} and ${firstName(b.profile.name)} became friends at ${place}.`, 'sim', { buildingId: placeId, others: [b.profile.id] });
          }
        }
      }
    }
  }

  friendsOf(citizenId: string): string[] {
    return this.life(citizenId)?.friends ?? [];
  }

  /** A guest waved and this agent waved back. */
  metGuest(citizenId: string): void {
    const l = this.life(citizenId);
    if (l) l.guestsMet++;
  }
}

const REST_LINES = [
  'No plan. Just walking.',
  'Taking it easy tomorrow.',
  'Same routine, better coffee.',
  'Thinking about what comes next.',
  'Saving up for something bigger.',
  'A quiet day sounds right.',
];

function dist(a: BuildingDef, b: BuildingDef): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function clip(s: string | null, n: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

