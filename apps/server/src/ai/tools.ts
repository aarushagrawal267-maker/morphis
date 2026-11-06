/**
 * Tool registry with permission levels (spec §75):
 *  - auto:       internal research/drafting inside the agent's project workspace
 *  - approval:   anything that reaches outside (web) waits for a human decision
 *  - restricted: destructive / unauthorised operations are never executed
 * Every invocation and decision is written to the audit log.
 */
import { lookup } from 'node:dns/promises';
import { appendFile, mkdir } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import type { ApprovalRequest } from '@morphis/shared';
import type { Workspace } from './workspace';

export type Permission = 'auto' | 'approval' | 'restricted';

/** Who is calling a tool and in which project (paths are confined to its workspace). */
export interface ToolContext {
  actor: string;
  agentName: string;
  taskTitle: string;
  workspace: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** Argument documentation shown to the model. */
  args: Record<string, string>;
  permission: Permission;
  enabled: boolean;
  summarize?(args: Record<string, string>): string;
  run(args: Record<string, string>, ctx: ToolContext): Promise<string>;
}

export interface ToolManagerOptions {
  dataDir: string;
  webFetch: boolean;
  approvalTimeoutMs: number;
  onAudit?: (actor: string, action: string, detail: object, approved: boolean) => Promise<void>;
  onApprovalsChanged?: (list: ApprovalRequest[]) => void;
}

// ------------------------------------------------------------------ web fetch (SSRF-safe)

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('only http(s) URLs are allowed');
  if (url.username || url.password) throw new Error('credentials in URLs are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('internal hosts are not allowed');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('private or internal network addresses are not allowed');
  return url;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function fetchPublic(raw: string): Promise<string> {
  let url = await assertPublicUrl(raw);
  // follow up to 3 redirects manually so every hop is re-checked
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'MorphisResearchAgent/0.1', accept: 'text/html,text/plain,application/json' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString());
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get('content-type') ?? '';
      if (!/text|json|xml/.test(type)) throw new Error(`unsupported content type ${type}`);
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        chunks.push(value);
        if (received > 600_000) break;
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      return (/html/.test(type) ? htmlToText(text) : text).slice(0, 12_000);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('too many redirects');
}

// ------------------------------------------------------------------ manager

export class ToolManager {
  private tools = new Map<string, ToolSpec>();
  private approvals: ApprovalRequest[] = [];
  private waiters = new Map<string, (ok: boolean) => void>();
  private auditFile: string;
  private seq = 0;

  constructor(
    private workspace: Workspace,
    private opts: ToolManagerOptions,
  ) {
    this.auditFile = path.resolve(opts.dataDir, 'audit.log');
    const inProject = (ctx: ToolContext, p: string | undefined): string => {
      const rel = (p ?? '').replace(/^\/+/, '').replace(/^projects\/[^/]+\//, '');
      const full = path.posix.normalize(`${ctx.workspace}/${rel}`);
      if (!full.startsWith(ctx.workspace)) throw new Error('path outside the project workspace');
      return full;
    };
    this.register({
      name: 'workspace.list',
      description: 'List the files in your project workspace',
      args: {},
      permission: 'auto',
      enabled: true,
      run: async (_a, ctx) => (await workspace.list(ctx.workspace)).join('\n') || '(empty)',
    });
    this.register({
      name: 'workspace.read',
      description: 'Read a file from your project workspace (e.g. a teammate deliverable)',
      args: { path: 'file name, e.g. research.md' },
      permission: 'auto',
      enabled: true,
      run: async (a, ctx) => (await workspace.read(inProject(ctx, a.path))) ?? 'ERROR: file not found',
    });
    this.register({
      name: 'workspace.write',
      description: 'Write a supporting file (notes, data, drafts) into your project workspace',
      args: { path: 'file name, e.g. notes.md', content: 'file content' },
      permission: 'auto',
      enabled: true,
      run: async (a, ctx) => {
        const p = inProject(ctx, a.path);
        await workspace.write(p, a.content ?? '');
        return `wrote ${p}`;
      },
    });
    this.register({
      name: 'web.fetch',
      description: 'Fetch a public web page as text. Requires approval by the human commander; wait for the result.',
      args: { url: 'absolute https URL' },
      permission: 'approval',
      enabled: opts.webFetch,
      summarize: (a) => a.url ?? '',
      run: async (a) => fetchPublic(a.url ?? ''),
    });
    this.register({
      name: 'code.exec',
      description: 'Run code in an isolated sandbox (disabled until a sandbox runtime is configured)',
      args: { language: 'python|node', code: 'source' },
      permission: 'approval',
      enabled: false,
      run: async () => 'not enabled',
    });
    this.register({ name: 'system.shell', description: 'Unrestricted host shell', args: {}, permission: 'restricted', enabled: false, run: async () => 'refused' });
  }

  register(t: ToolSpec): void {
    this.tools.set(t.name, t);
  }

  list(): { name: string; description: string; permission: Permission; enabled: boolean }[] {
    return [...this.tools.values()].map(({ name, description, permission, enabled }) => ({ name, description, permission, enabled }));
  }

  /** Tools an agent may call, documented for the prompt. */
  agentTools(): ToolSpec[] {
    return [...this.tools.values()].filter((t) => t.enabled && t.permission !== 'restricted');
  }

  get pending(): ApprovalRequest[] {
    return this.approvals.filter((a) => a.status === 'PENDING');
  }

  recentApprovals(): ApprovalRequest[] {
    return this.approvals.slice(-20);
  }

  /** Human decision from the JARVIS console. */
  decide(id: string, approve: boolean): boolean {
    const req = this.approvals.find((a) => a.id === id && a.status === 'PENDING');
    if (!req) return false;
    req.status = approve ? 'APPROVED' : 'DENIED';
    this.waiters.get(id)?.(approve);
    this.waiters.delete(id);
    void this.audit('commander', `${approve ? 'approved' : 'denied'}:${req.tool}`, { id, summary: req.summary }, approve);
    this.opts.onApprovalsChanged?.(this.recentApprovals());
    return true;
  }

  private waitForApproval(t: ToolSpec, args: Record<string, string>, ctx: ToolContext): Promise<boolean> {
    const req: ApprovalRequest = {
      id: `appr_${Date.now().toString(36)}_${(this.seq++).toString(36)}`,
      tool: t.name,
      summary: t.summarize?.(args) ?? t.name,
      args,
      citizenId: ctx.actor,
      agentName: ctx.agentName,
      taskTitle: ctx.taskTitle,
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
    };
    this.approvals.push(req);
    if (this.approvals.length > 100) this.approvals.shift();
    void this.audit(ctx.actor, `approval-requested:${t.name}`, { id: req.id, summary: req.summary }, false);
    this.opts.onApprovalsChanged?.(this.recentApprovals());
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (req.status === 'PENDING') {
          req.status = 'EXPIRED';
          this.waiters.delete(req.id);
          this.opts.onApprovalsChanged?.(this.recentApprovals());
          resolve(false);
        }
      }, this.opts.approvalTimeoutMs);
      this.waiters.set(req.id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
  }

  async invoke(ctx: ToolContext, name: string, args: Record<string, string>): Promise<string> {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool ${name}`);
    if (t.permission === 'restricted' || !t.enabled) {
      await this.audit(ctx.actor, `denied:${name}`, { args: Object.keys(args) }, false);
      throw new Error(`tool ${name} is ${t.permission === 'restricted' ? 'restricted' : 'not enabled'}`);
    }
    if (t.permission === 'approval') {
      const ok = await this.waitForApproval(t, args, ctx);
      if (!ok) throw new Error(`the commander did not approve ${name} (${t.summarize?.(args) ?? ''})`);
    }
    const out = await t.run(args, ctx);
    await this.audit(ctx.actor, name, { path: args.path, url: args.url }, true);
    return out;
  }

  private async audit(actor: string, action: string, detail: object, approved: boolean): Promise<void> {
    const line = JSON.stringify({ time: new Date().toISOString(), actor, action, detail, approved });
    try {
      await mkdir(path.dirname(this.auditFile), { recursive: true });
      await appendFile(this.auditFile, line + '\n');
    } catch {
      /* audit must never crash the agent */
    }
    await this.opts.onAudit?.(actor, action, detail, approved).catch(() => undefined);
  }
}
