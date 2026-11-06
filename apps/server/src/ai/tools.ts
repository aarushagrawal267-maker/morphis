/**
 * Tool registry with permission levels (spec §75):
 *  - auto:       internal research/drafting inside the project workspace
 *  - approval:   anything external (web, messages, deployments) needs a human
 *  - restricted: destructive / unauthorised operations are never executed
 * Every invocation is written to the audit log.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Workspace } from './workspace';

export type Permission = 'auto' | 'approval' | 'restricted';

export interface ToolSpec {
  name: string;
  description: string;
  permission: Permission;
  enabled: boolean;
  run(args: Record<string, string>): Promise<string>;
}

export interface PendingApproval {
  id: string;
  tool: string;
  args: Record<string, string>;
  actor: string;
  requestedAt: string;
}

export class ToolManager {
  private tools = new Map<string, ToolSpec>();
  readonly pending: PendingApproval[] = [];
  private auditFile: string;

  constructor(
    workspace: Workspace,
    dataDir: string,
    private onAudit?: (actor: string, action: string, detail: object, approved: boolean) => Promise<void>,
  ) {
    this.auditFile = path.resolve(dataDir, 'audit.log');
    this.register({ name: 'workspace.write', description: 'Write a markdown artifact into the project workspace', permission: 'auto', enabled: true, run: async (a) => (await workspace.write(a.path, a.content), `wrote ${a.path}`) });
    this.register({ name: 'workspace.read', description: 'Read an artifact from the project workspace', permission: 'auto', enabled: true, run: async (a) => (await workspace.read(a.path)) ?? '' });
    this.register({ name: 'workspace.list', description: 'List artifacts of a project', permission: 'auto', enabled: true, run: async (a) => (await workspace.list(a.path)).join('\n') });
    this.register({ name: 'web.fetch', description: 'Fetch a public web page (requires human approval)', permission: 'approval', enabled: false, run: async () => 'not enabled' });
    this.register({ name: 'code.exec', description: 'Execute code in an isolated sandbox (requires a Docker sandbox; disabled)', permission: 'approval', enabled: false, run: async () => 'not enabled' });
    this.register({ name: 'system.shell', description: 'Unrestricted shell on the host', permission: 'restricted', enabled: false, run: async () => 'refused' });
  }

  register(t: ToolSpec): void {
    this.tools.set(t.name, t);
  }

  list(): Omit<ToolSpec, 'run'>[] {
    return [...this.tools.values()].map(({ run: _run, ...rest }) => rest);
  }

  async invoke(actor: string, name: string, args: Record<string, string>): Promise<string> {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool ${name}`);
    if (t.permission === 'restricted' || !t.enabled) {
      await this.audit(actor, `denied:${name}`, { args: Object.keys(args) }, false);
      throw new Error(`tool ${name} is ${t.permission === 'restricted' ? 'restricted' : 'not enabled'}`);
    }
    if (t.permission === 'approval') {
      const req: PendingApproval = { id: `appr_${Date.now().toString(36)}`, tool: name, args, actor, requestedAt: new Date().toISOString() };
      this.pending.push(req);
      await this.audit(actor, `approval-requested:${name}`, { id: req.id }, false);
      throw new Error(`tool ${name} requires human approval (request ${req.id})`);
    }
    const out = await t.run(args);
    await this.audit(actor, name, { path: args.path }, true);
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
    await this.onAudit?.(actor, action, detail, approved).catch(() => undefined);
  }
}
