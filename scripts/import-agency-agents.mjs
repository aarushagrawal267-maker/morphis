#!/usr/bin/env node
/**
 * Import the agent roster from The Agency (github.com/msitarzewski/agency-agents, MIT).
 *
 *   node scripts/import-agency-agents.mjs /path/to/agency-agents-checkout
 *
 * Copies every agent file of the listed divisions into vendor/agency-agents/ (the
 * full text is the agent's working instructions, read by the server) and writes
 * packages/shared/src/agency.generated.ts with the catalogue metadata used by the
 * simulation and the web client. Re-run it to update to a newer upstream version.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/import-agency-agents.mjs <agency-agents checkout>');
  process.exit(1);
}

/** Divisions imported from upstream (every agent in them can be hired by JARVIS). */
const DIVISIONS = ['engineering', 'specialized', 'marketing', 'design', 'game-development', 'security', 'gis', 'testing', 'sales', 'product', 'project-management', 'finance', 'academic', 'support', 'paid-media', 'spatial-computing', 'healthcare', 'research'];

/** The ~70 agents who live in town as residents: a broad, useful mix across divisions. */
const RESIDENTS = [
  // engineering
  'engineering-frontend-developer', 'engineering-backend-architect', 'engineering-ai-engineer', 'engineering-devops-automator', 'engineering-software-architect',
  'engineering-data-engineer', 'engineering-mobile-app-builder', 'engineering-rapid-prototyper', 'engineering-sre', 'engineering-technical-writer',
  'engineering-prompt-engineer', 'engineering-code-reviewer',
  // specialized
  'business-strategist', 'operations-manager', 'customer-success-manager', 'grant-writer', 'language-translator', 'specialized-civil-engineer',
  'supply-chain-strategist', 'specialized-pricing-analyst', 'agents-orchestrator', 'personal-growth-mentor',
  // marketing
  'marketing-content-creator', 'marketing-growth-hacker', 'marketing-seo-specialist', 'marketing-social-media-strategist', 'marketing-pr-communications-manager',
  'marketing-podcast-strategist', 'marketing-email-strategist',
  // design
  'design-ui-designer', 'design-ux-researcher', 'design-brand-guardian', 'design-visual-storyteller', 'design-whimsy-injector',
  // game development
  'game-designer', 'level-designer', 'narrative-designer', 'game-audio-engineer',
  // security
  'security-architect', 'security-penetration-tester', 'security-incident-responder', 'security-compliance-auditor',
  // gis
  'gis-analyst', 'gis-cartography-designer', 'gis-drone-reality-mapping',
  // testing
  'testing-accessibility-auditor', 'testing-reality-checker', 'testing-performance-benchmarker',
  // sales
  'sales-coach', 'sales-account-strategist', 'sales-proposal-strategist',
  // product
  'product-manager', 'product-feedback-synthesizer', 'product-trend-researcher',
  // project management
  'project-manager-senior', 'project-management-studio-producer', 'project-management-meeting-notes-specialist',
  // finance
  'finance-financial-analyst', 'finance-bookkeeper-controller', 'finance-investment-researcher',
  // academic
  'academic-historian', 'academic-psychologist', 'academic-statistician',
  // support
  'support-support-responder', 'support-analytics-reporter', 'support-legal-compliance-checker',
  // paid media
  'paid-media-creative-strategist', 'paid-media-ppc-strategist',
  // spatial computing
  'xr-immersive-developer', 'xr-interface-architect',
  // healthcare
  'healthcare-clinical-evidence-agent', 'healthcare-innovation-strategist',
  // research
  'research-synthesist',
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Minimal frontmatter reader: `key: value`, quoted values and `|` / `>` block scalars. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i].trim());
      value = block.filter(Boolean).join(' ');
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    data[kv[1]] = value;
  }
  return data;
}

const clip = (s, n) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

const vendor = path.join(root, 'vendor', 'agency-agents');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

const agents = [];
const ids = new Set();
for (const division of DIVISIONS) {
  const files = walk(path.join(src, division)).filter((f) => frontmatter(readFileSync(f, 'utf8'))?.name);
  files.forEach((file) => {
    const text = readFileSync(file, 'utf8');
    const fm = frontmatter(text);
    const rel = path.relative(src, file).split(path.sep).join('/');
    let id = path.basename(file, '.md');
    if (ids.has(id)) id = `${division}-${id}`;
    ids.add(id);
    mkdirSync(path.dirname(path.join(vendor, rel)), { recursive: true });
    copyFileSync(file, path.join(vendor, rel));
    agents.push({
      id,
      name: clip(fm.name, 60),
      division,
      description: clip(fm.description ?? '', 240),
      vibe: clip(fm.vibe ?? '', 160),
      emoji: (fm.emoji ?? '').slice(0, 8),
      file: rel,
      resident: RESIDENTS.includes(id),
    });
  });
}

const missing = RESIDENTS.filter((id) => !ids.has(id));
if (missing.length) throw new Error(`resident ids not found upstream: ${missing.join(', ')}`);

copyFileSync(path.join(src, 'LICENSE'), path.join(vendor, 'LICENSE'));
let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', src, 'log', '-1', '--format=%H %cs'], { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
writeFileSync(
  path.join(vendor, 'SOURCE.md'),
  [
    '# The Agency (agency-agents)',
    '',
    'Agent personas from https://github.com/msitarzewski/agency-agents, used under the MIT License (see LICENSE in this folder).',
    `Imported from commit ${commit} by scripts/import-agency-agents.mjs.`,
    '',
    'The files are unmodified. Morphis uses each file as the working instructions of that agent and adds its own safety rules on top.',
    '',
  ].join('\n'),
);

const header = `/* eslint-disable */
// Generated by scripts/import-agency-agents.mjs from github.com/msitarzewski/agency-agents
// (MIT License, see vendor/agency-agents/LICENSE). Source commit: ${commit}. Do not edit by hand.
import type { AgencyAgentMeta } from './agency';

export const AGENCY_SOURCE = ${JSON.stringify({ repo: 'https://github.com/msitarzewski/agency-agents', commit })};

export const AGENCY_AGENTS: AgencyAgentMeta[] = `;
writeFileSync(path.join(root, 'packages', 'shared', 'src', 'agency.generated.ts'), header + JSON.stringify(agents, null, 1) + ';\n');
console.log(`imported ${agents.length} agents (${agents.filter((a) => a.resident).length} town residents) from ${commit}`);
