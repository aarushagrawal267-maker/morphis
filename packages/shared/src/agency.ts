/**
 * The Agency: specialist AI agents imported from github.com/msitarzewski/agency-agents
 * (MIT License). About 70 of them live in Morphis as residents; JARVIS can hire any
 * of them for a project. The full persona text stays on the server
 * (vendor/agency-agents/); this module only holds the catalogue metadata.
 */
import type { AmbitionKind, Interest } from './types/life';
import type { BuildingType } from './types/world';
import { AGENCY_AGENTS } from './agency.generated';

export interface AgencyAgentMeta {
  /** Stable id (the upstream file name), e.g. "engineering-frontend-developer". */
  id: string;
  name: string;
  division: string;
  description: string;
  vibe: string;
  emoji: string;
  /** Path of the persona file inside vendor/agency-agents/. */
  file: string;
  /** Lives in town as a resident (otherwise hired for projects only). */
  resident: boolean;
}

export interface AgencyDivision {
  label: string;
  /** Building types the division's residents work in (nearest to home wins). */
  workplaces: BuildingType[];
  ambition: AmbitionKind;
  interests: Interest[];
}

export const AGENCY_DIVISIONS: Record<string, AgencyDivision> = {
  engineering: { label: 'Engineering', workplaces: ['ai_lab', 'research_lab', 'office'], ambition: 'builder', interests: ['craft', 'research'] },
  specialized: { label: 'Specialized', workplaces: ['office', 'government', 'library'], ambition: 'connector', interests: ['research', 'community'] },
  marketing: { label: 'Marketing', workplaces: ['corporate_tower', 'office'], ambition: 'climber', interests: ['trade', 'art'] },
  design: { label: 'Design', workplaces: ['office', 'entertainment'], ambition: 'builder', interests: ['art', 'craft'] },
  'game-development': { label: 'Game Development', workplaces: ['entertainment', 'office'], ambition: 'founder', interests: ['art', 'craft'] },
  security: { label: 'Security', workplaces: ['data_center', 'office'], ambition: 'scholar', interests: ['research', 'craft'] },
  gis: { label: 'GIS', workplaces: ['government', 'research_lab'], ambition: 'scholar', interests: ['explore', 'research'] },
  testing: { label: 'Testing', workplaces: ['research_lab', 'office'], ambition: 'builder', interests: ['craft', 'research'] },
  sales: { label: 'Sales', workplaces: ['corporate_tower', 'office'], ambition: 'climber', interests: ['trade', 'community'] },
  product: { label: 'Product', workplaces: ['office', 'corporate_tower'], ambition: 'founder', interests: ['craft', 'community'] },
  'project-management': { label: 'Project Management', workplaces: ['office', 'corporate_tower'], ambition: 'connector', interests: ['community', 'trade'] },
  finance: { label: 'Finance', workplaces: ['bank', 'corporate_tower'], ambition: 'investor', interests: ['trade', 'research'] },
  academic: { label: 'Academic', workplaces: ['university', 'library'], ambition: 'scholar', interests: ['research', 'art'] },
  support: { label: 'Support', workplaces: ['office', 'corporate_tower'], ambition: 'connector', interests: ['community', 'food'] },
  'paid-media': { label: 'Paid Media', workplaces: ['corporate_tower', 'office'], ambition: 'climber', interests: ['trade', 'art'] },
  'spatial-computing': { label: 'Spatial Computing', workplaces: ['research_lab', 'ai_lab'], ambition: 'builder', interests: ['explore', 'craft'] },
  healthcare: { label: 'Healthcare', workplaces: ['hospital', 'office'], ambition: 'scholar', interests: ['community', 'research'] },
  research: { label: 'Research', workplaces: ['university', 'research_lab'], ambition: 'scholar', interests: ['research', 'explore'] },
};

export { AGENCY_AGENTS, AGENCY_SOURCE } from './agency.generated';

const byId = new Map(AGENCY_AGENTS.map((a) => [a.id, a]));

export function agencyAgent(id: string | null | undefined): AgencyAgentMeta | undefined {
  return id ? byId.get(id) : undefined;
}

export function agencyDivisionLabel(division: string): string {
  return AGENCY_DIVISIONS[division]?.label ?? division;
}

const STOP = new Set(
  'a an and the of for to in on with by from at as is are be or our your my this that these those it its into about over under build create make run do new plan project city morphis town using use help need want'.split(' '),
);

/** Lower-case word stems of a text (very small stemmer: plural/-ing/-ed endings). */
export function agencyTerms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/ies$/, 'y').replace(/(ments|ment|ers|er|ings|ing|ed|es|s|e)$/, ''))
    .filter((w) => w.length > 2);
}

export interface AgencyMatch {
  agent: AgencyAgentMeta;
  score: number;
}

/**
 * Rank specialists by how well their name, division and description match a text.
 * Name matches weigh most. Deterministic, no AI involved.
 */
export function rankAgency(text: string, opts: { residentsOnly?: boolean; limit?: number } = {}): AgencyMatch[] {
  const terms = new Set(agencyTerms(text));
  if (!terms.size) return [];
  const out: AgencyMatch[] = [];
  for (const agent of AGENCY_AGENTS) {
    if (opts.residentsOnly && !agent.resident) continue;
    let score = 0;
    for (const t of agencyTerms(agent.name)) if (terms.has(t)) score += 3;
    for (const t of agencyTerms(agencyDivisionLabel(agent.division))) if (terms.has(t)) score += 2;
    const desc = new Set(agencyTerms(agent.description));
    for (const t of terms) if (desc.has(t)) score += 1;
    if (score > 0) out.push({ agent, score: score + (agent.resident ? 0.5 : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));
  return out.slice(0, opts.limit ?? 20);
}
