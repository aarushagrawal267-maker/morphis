/** MORPHIS simulation server entry point. */
import { loadConfig } from './config';
import { buildServer } from './app';

const cfg = loadConfig();
const { app, host, agents, persistence } = await buildServer(cfg, { logger: true });
host.start();
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`MORPHIS server on :${cfg.PORT} — persistence: ${persistence.info.backend}; AI: ${agents.info.connected ? agents.info.provider : 'simulated'} (${agents.verified})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void app.close().then(() => process.exit(0));
  });
}
