/** Agent memory: short summaries of each agent's completed work, fed back into prompts. */
export interface MemoryItem {
  time: string;
  project: string;
  task: string;
  summary: string;
}

export class AgentMemory {
  private items = new Map<string, MemoryItem[]>();

  add(citizenId: string, item: MemoryItem): void {
    const list = this.items.get(citizenId) ?? [];
    list.push(item);
    if (list.length > 20) list.shift();
    this.items.set(citizenId, list);
  }

  recent(citizenId: string, n = 3): MemoryItem[] {
    return (this.items.get(citizenId) ?? []).slice(-n);
  }

  all(citizenId: string): MemoryItem[] {
    return this.items.get(citizenId) ?? [];
  }
}
