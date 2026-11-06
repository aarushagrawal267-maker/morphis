import type { ServerConfig } from '../config';
import { FilePersistence } from './file';
import { PrismaPersistence } from './prisma';
import type { PersistenceAdapter } from './types';

/** PostgreSQL when DATABASE_URL works, otherwise JSON files. Never pretends to be connected. */
export async function createPersistence(cfg: ServerConfig, log: (msg: string) => void): Promise<PersistenceAdapter> {
  if (cfg.DATABASE_URL) {
    try {
      const p = await PrismaPersistence.connect(cfg.DATABASE_URL);
      log('persistence: PostgreSQL connected');
      return p;
    } catch (e) {
      log(`persistence: PostgreSQL unavailable (${e instanceof Error ? e.message.split('\n')[0] : e}); falling back to files`);
      const f = new FilePersistence(cfg.DATA_DIR);
      (f.info as { detail: string }).detail = `PostgreSQL configured but unreachable — using JSON files in ${cfg.DATA_DIR}/saves`;
      return f;
    }
  }
  log('persistence: JSON files (no DATABASE_URL)');
  return new FilePersistence(cfg.DATA_DIR);
}

export type { PersistenceAdapter };
