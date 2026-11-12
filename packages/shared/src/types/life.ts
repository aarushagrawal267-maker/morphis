/**
 * Agent lives: the 50 agents of Morphis (25 JARVIS workforce + 25 independent
 * agents) keep a persona, make one life decision per simulated day and leave a
 * logged trail of deeds. Every deed is produced by the simulation (or chosen by
 * a real AI model when one is connected) and recorded with who decided it.
 */

export type AmbitionKind = 'founder' | 'scholar' | 'investor' | 'builder' | 'climber' | 'connector';

export type Interest = 'explore' | 'food' | 'craft' | 'art' | 'trade' | 'community' | 'research';

export interface AgentPersona {
  /** URL-friendly handle, e.g. "sarah-chen". */
  slug: string;
  /** What the agent does or wants to do, e.g. "Barista", "Painter". */
  calling: string;
  ambition: AmbitionKind;
  interests: Interest[];
  /** "Why I'm here": the agent's own reason for living in Morphis. */
  why: string;
  /** Member of the JARVIS workforce (the 25 core citizens). */
  workforce: boolean;
  /** An outside AI agent that moved in through the agent API and makes its own decisions. */
  external?: boolean;
  /** Venture kind this agent dreams of opening (founders). */
  dream: VentureKind | null;
  /** Specialist from The Agency (agency-agents): id of its persona in the catalogue. */
  agency?: string;
}

export type VentureKind = 'cafe' | 'restaurant' | 'shop' | 'studio' | 'workshop';

export interface Venture {
  id: string;
  name: string;
  kind: VentureKind;
  /** Business record the venture took over (in an existing, vacant unit). */
  businessId: string;
  buildingId: string;
  founderId: string;
  status: 'FITTING_OUT' | 'OPEN' | 'CLOSED';
  /** Fit-out work needed / done, in agent-minutes on site. */
  work: number;
  progress: number;
  /** Agents who came to help with the fit-out. */
  helpers: string[];
  investors: { citizenId: string; amount: number }[];
  capital: number;
  foundedAt: number;
  openedAt: number | null;
  /** Total dividends paid out to founder and investors (simulated credits). */
  paidOut: number;
}

export type LifeActionKind = 'found' | 'invest' | 'help_build' | 'enroll' | 'join' | 'rest' | 'visit' | 'meet' | 'work';

/** When a decision is made: the evening life decision, or a turn during the day. */
export type DecisionPhase = 'evening' | 'morning' | 'midday';

/** What an agent decided to do in a window of today (from a morning or midday turn). */
export interface AgentIntent {
  phase: 'morning' | 'midday';
  kind: LifeActionKind;
  /** Activity the agent does in the window (eat, park, event, leisure, build, work, study). */
  activity: string;
  buildingId: string | null;
  /** Sim time window in which the intent applies. */
  from: number;
  until: number;
  label: string;
  /** What the agent says about it (written by the AI when it chose). */
  say: string | null;
  by: 'ai' | 'sim';
  /** Friend met (for meet intents). */
  withId?: string;
}

export interface LifeOption {
  id: string;
  kind: LifeActionKind;
  label: string;
  detail: string;
  targetId?: string;
  amount?: number;
  venture?: { kind: VentureKind; name: string; buildingId: string };
  /** Day turns: the activity this option leads to, and the friend it involves. */
  activity?: string;
  withId?: string;
}

export interface LifeDecision {
  id: string;
  citizenId: string;
  options: LifeOption[];
  createdAt: number;
  /** Sim time after which the simulation decides by itself. */
  deadline: number;
  /** Evening life decision (default) or a turn during the day. */
  phase?: DecisionPhase;
}

export interface AgentLife {
  citizenId: string;
  /** Today's plan / thought, shown as chatter and on the agent card. */
  plan: string;
  /** Who produced the latest plan: a real AI model or the simulation. */
  planBy: 'ai' | 'sim';
  ventureId: string | null;
  helpingId: string | null;
  stakes: { ventureId: string; amount: number }[];
  study: { field: string; minutes: number; required: number; since: number } | null;
  graduated: string[];
  /** Day of the last life decision. */
  lastDecisionDay: number;
  /** Minute of day this agent reflects and decides. */
  decideAt: number;
  pending: string | null;
  guestsMet: number;
  /** Other agents this agent has become friends with. */
  friends?: string[];
  /** Day of the last morning / midday turn. */
  turns?: { morning: number; midday: number };
  /** Today's plans from the day turns: lunch (morning turn) and evening (midday turn). */
  intents?: { morning?: AgentIntent | null; midday?: AgentIntent | null };
}

export type DeedKind =
  | 'arrived'
  | 'founded'
  | 'opened'
  | 'closed'
  | 'invested'
  | 'helped'
  | 'enrolled'
  | 'graduated'
  | 'joined'
  | 'task'
  | 'project'
  | 'hired'
  | 'dividend'
  | 'rest'
  | 'met'
  | 'friends'
  | 'talked';

export interface Deed {
  id: string;
  time: number;
  citizenId: string;
  kind: DeedKind;
  text: string;
  buildingId?: string;
  /** Other citizens involved (helpers, investors, team mates). */
  others?: string[];
  /** 'ai' when a real AI model made the decision behind this deed. */
  by: 'ai' | 'sim';
  /** The agent's own reason, when it gave one. */
  reason?: string;
  /** For conversations between agents: what each of them said. */
  lines?: { citizenId: string; text: string }[];
}

/** Two agents who know each other are spending time in the same place and get talking. */
export interface AgentEncounter {
  id: string;
  aId: string;
  bId: string;
  buildingId: string;
  time: number;
  /** What they are doing there (eat, leisure, park, event, build, shop). */
  activity: string;
}
