/**
 * The Agency's specialist personas (github.com/msitarzewski/agency-agents, MIT),
 * read from vendor/agency-agents/. A persona file is the specialist's working
 * instructions; Morphis wraps it in its own rules (tools, honesty, credits) so
 * the town's rules win wherever the persona assumes more than an agent can do here.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgencyAgentMeta } from '@morphis/shared';
import { AGENCY_AGENTS, AGENCY_DIVISIONS, agencyAgent, rankAgency } from '@morphis/shared';

/** Longest persona text sent to the model (characters); long playbooks are cut at a heading. */
export const PERSONA_MAX_CHARS = 7000;

/** Find vendor/agency-agents: explicit dir, else walk up from this module and from the working directory. */
export function locateAgencyDir(explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? path.resolve(explicit) : null;
  const starts = [path.dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      const cand = path.join(dir, 'vendor', 'agency-agents');
      if (existsSync(path.join(cand, 'LICENSE'))) return cand;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

/** Strip frontmatter and cut a long playbook at a heading boundary. */
export function trimPersona(text: string, max = PERSONA_MAX_CHARS): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const at = cut.lastIndexOf('\n## ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trim()}\n\n[… the rest of this playbook is omitted for length]`;
}

export class AgencyLibrary {
  readonly dir: string | null;
  private cache = new Map<string, string>();

  constructor(dir?: string) {
    this.dir = locateAgencyDir(dir);
  }

  get available(): boolean {
    return !!this.dir;
  }

  meta(id: string | null | undefined): AgencyAgentMeta | undefined {
    return agencyAgent(id);
  }

  /** The specialist's persona text (frontmatter removed, trimmed), or null when unavailable. */
  async persona(id: string): Promise<string | null> {
    const meta = agencyAgent(id);
    if (!meta || !this.dir) return null;
    const hit = this.cache.get(id);
    if (hit) return hit;
    const file = path.resolve(this.dir, meta.file);
    if (!file.startsWith(this.dir + path.sep)) return null;
    try {
      const text = trimPersona(await readFile(file, 'utf8'));
      this.cache.set(id, text);
      return text;
    } catch {
      return null;
    }
  }

  /**
   * Roster for the planner: every specialist by id and name, grouped by division,
   * plus the best matches for the request with their descriptions.
   */
  plannerRoster(request: string, featured = 14): string {
    const lines: string[] = [];
    const top = rankAgency(request, { limit: featured });
    if (top.length) {
      lines.push('Best matches for this request:');
      for (const m of top) lines.push(`- ${m.agent.id}: ${m.agent.name}${m.agent.resident ? ' (lives in town)' : ''} — ${m.agent.description.slice(0, 140)}`);
      lines.push('');
    }
    lines.push('Full roster (id: name), by division. "*" = lives in Morphis and walks to work in town:');
    for (const [key, d] of Object.entries(AGENCY_DIVISIONS)) {
      const list = AGENCY_AGENTS.filter((a) => a.division === key);
      if (list.length) lines.push(`${d.label}: ${list.map((a) => `${a.id}${a.resident ? '*' : ''}`).join(', ')}`);
    }
    return lines.join('\n');
  }
}
