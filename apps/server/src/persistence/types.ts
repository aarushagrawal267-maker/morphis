import type { PersistenceInfo, SaveSummary } from '@morphis/shared';
import type { SaveData } from '@morphis/sim';

export interface PersistenceAdapter {
  readonly info: PersistenceInfo;
  save(data: SaveData, extra: { population: number }): Promise<SaveSummary>;
  list(): Promise<SaveSummary[]>;
  load(id: string): Promise<SaveData>;
  delete(id: string): Promise<void>;
  close(): Promise<void>;
}
