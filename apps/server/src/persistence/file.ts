/** JSON file persistence (fallback when no DATABASE_URL is configured). */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SaveSummary } from '@morphis/shared';
import type { SaveData } from '@morphis/sim';
import type { PersistenceAdapter } from './types';

export class FilePersistence implements PersistenceAdapter {
  readonly info;
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.resolve(dataDir, 'saves');
    this.info = { backend: 'file' as const, detail: `JSON files in ${this.dir} (set DATABASE_URL for PostgreSQL)` };
  }

  private file(id: string): string {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('invalid save id');
    return path.join(this.dir, `${id}.json`);
  }

  async save(data: SaveData, extra: { population: number }): Promise<SaveSummary> {
    await mkdir(this.dir, { recursive: true });
    const id = `save_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const summary: SaveSummary = { id, name: data.name, seed: data.config.seed, simTime: data.state.clock.time, savedAt: data.savedAt, population: extra.population, backend: 'file' };
    await writeFile(this.file(id), JSON.stringify({ summary, data }));
    return summary;
  }

  async list(): Promise<SaveSummary[]> {
    await mkdir(this.dir, { recursive: true });
    const out: SaveSummary[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(await readFile(path.join(this.dir, f), 'utf8')) as { summary: SaveSummary };
        out.push(raw.summary);
      } catch {
        /* skip corrupt file */
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async load(id: string): Promise<SaveData> {
    const raw = JSON.parse(await readFile(this.file(id), 'utf8')) as { data: SaveData };
    return raw.data;
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }

  async close(): Promise<void> {}
}
