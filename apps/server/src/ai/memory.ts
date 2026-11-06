/**
 * Agent memory: short summaries of each agent's completed work, fed back into
 * prompts. Persisted to DATA_DIR/agent-memory.json so it survives restarts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MemoryItem {
  time: string;
  project: string;
  task: string;
  summary: string;
}

export class AgentMemory {
  private items = new Map<string, MemoryItem[]>();
  private file: string | null;
  private saving: Promise<void> = Promise.resolve();

  constructor(dataDir?: string) {
    this.file = dataDir ? path.resolve(dataDir, 'agent-memory.json') : null;
  }

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, MemoryItem[]>;
      for (const [k, v] of Object.entries(raw)) this.items.set(k, v);
    } catch {
      /* first run */
    }
  }

  add(citizenId: string, item: MemoryItem): void {
    const list = this.items.get(citizenId) ?? [];
    list.push(item);
    if (list.length > 30) list.shift();
    this.items.set(citizenId, list);
    this.persist();
  }

  recent(citizenId: string, n = 3): MemoryItem[] {
    return (this.items.get(citizenId) ?? []).slice(-n);
  }

  all(citizenId: string): MemoryItem[] {
    return this.items.get(citizenId) ?? [];
  }

  private persist(): void {
    const file = this.file;
    if (!file) return;
    const snapshot = JSON.stringify(Object.fromEntries(this.items));
    this.saving = this.saving.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, snapshot);
    }).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.saving;
  }
}
