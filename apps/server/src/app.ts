/** Server composition (used by main.ts and by the integration tests). */
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { AgentController } from './ai/agents';
import { registerRoutes } from './api/routes';
import type { ServerConfig } from './config';
import { createPersistence } from './persistence';
import { PrismaPersistence } from './persistence/prisma';
import { SimulationHost } from './simulation/host';
import { attachSockets } from './websocket/socket';
import { serveWebClient } from './web/static';
import { ExternalAgents } from './api/externalAgents';
import { registerJournalSync } from './api/journalSync';

export async function buildServer(cfg: ServerConfig, opts: { logger?: boolean; verifyAi?: boolean; serveWeb?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000 });
  await app.register(cors, { origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(',').map((s) => s.trim()) });
  const log = (m: string) => (opts.logger ? app.log.info(m) : undefined);
  const persistence = await createPersistence(cfg, log);
  const audit = persistence instanceof PrismaPersistence ? persistence.audit.bind(persistence) : undefined;
  const agents = new AgentController(cfg, audit);
  if (opts.verifyAi !== false && agents.provider) await agents.verify();
  const host = new SimulationHost(cfg, persistence, agents);
  if (cfg.RESUME_LATEST_SAVE === 'true') {
    try {
      const name = await host.resumeLatest();
      if (name) log(`resumed save "${name}"`);
    } catch (e) {
      log(`could not resume the latest save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  registerRoutes(app, host);
  const outside = new ExternalAgents(cfg.DATA_DIR);
  await outside.load();
  outside.register(app, host);
  registerJournalSync(app, cfg.DATA_DIR);
  if (cfg.WEB_DIST && opts.serveWeb !== false) serveWebClient(app, cfg.WEB_DIST, log);
  attachSockets(app.server, host, cfg.CORS_ORIGIN);
  app.addHook('onClose', async () => {
    // keep the town across redeploys and restarts
    if (cfg.AUTOSAVE_MINUTES > 0) await host.save(`Autosave ${new Date().toISOString()}`).catch(() => undefined);
    host.stop();
    host.io?.close();
    await agents.memory.flush();
    await persistence.close();
  });
  return { app, host, agents, persistence };
}
