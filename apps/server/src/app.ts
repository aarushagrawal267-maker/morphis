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

export async function buildServer(cfg: ServerConfig, opts: { logger?: boolean; verifyAi?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000 });
  await app.register(cors, { origin: cfg.CORS_ORIGIN === '*' ? true : cfg.CORS_ORIGIN.split(',').map((s) => s.trim()) });
  const log = (m: string) => (opts.logger ? app.log.info(m) : undefined);
  const persistence = await createPersistence(cfg, log);
  const audit = persistence instanceof PrismaPersistence ? persistence.audit.bind(persistence) : undefined;
  const agents = new AgentController(cfg, audit);
  if (opts.verifyAi !== false && agents.provider) await agents.verify();
  const host = new SimulationHost(cfg, persistence, agents);
  registerRoutes(app, host);
  attachSockets(app.server, host, cfg.CORS_ORIGIN);
  app.addHook('onClose', async () => {
    host.stop();
    host.io?.close();
    await persistence.close();
  });
  return { app, host, agents, persistence };
}
