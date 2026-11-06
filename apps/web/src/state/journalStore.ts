/**
 * The visitor's journal: daily goals, places visited, totals and badges.
 * Kept in this browser only (localStorage; postcards in IndexedDB). Nothing
 * here is simulation state.
 */
import { create } from 'zustand';

export type GoalKind = 'meetAgents' | 'visit' | 'wave' | 'ride' | 'postcard' | 'enter';

export interface Goal {
  id: string;
  kind: GoalKind;
  label: string;
  target: number;
  progress: number;
  /** Building id for "visit" goals. */
  place?: string;
}

export interface Totals {
  agentsMet: number;
  residentsMet: number;
  rides: number;
  postcards: number;
  waves: number;
  entered: number;
  streak: number;
}

export interface Postcard {
  id: string;
  at: string;
  place: string;
  dataUrl: string;
}

interface JournalData {
  date: string;
  goals: Goal[];
  visited: string[];
  met: string[];
  totals: Totals;
  lastVisitDay: string | null;
}

export interface Badge {
  id: string;
  name: string;
  hint: string;
  earned: boolean;
}

interface JournalState extends JournalData {
  postcards: Postcard[];
  /** Create today's goals (needs the landmark list) and update the visit streak. */
  startDay(landmarks: { id: string; name: string }[]): void;
  visit(buildingId: string): void;
  enter(buildingId: string): void;
  waved(): void;
  meet(citizenIds: string[], isAgent: (id: string) => boolean): void;
  ride(): void;
  addPostcard(dataUrl: string, place: string): Promise<void>;
  loadPostcards(): Promise<void>;
  deletePostcard(id: string): Promise<void>;
  badges(landmarkCount: number): Badge[];
}

const KEY = 'morphis.journal';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const EMPTY: JournalData = {
  date: '',
  goals: [],
  visited: [],
  met: [],
  totals: { agentsMet: 0, residentsMet: 0, rides: 0, postcards: 0, waves: 0, entered: 0, streak: 0 },
  lastVisitDay: null,
};

function loadData(): JournalData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as JournalData;
    return { ...EMPTY, ...d, totals: { ...EMPTY.totals, ...d.totals } };
  } catch {
    return EMPTY;
  }
}

function persist(d: JournalData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: d.date, goals: d.goals, visited: d.visited, met: d.met.slice(-500), totals: d.totals, lastVisitDay: d.lastVisitDay }));
  } catch {
    /* storage unavailable */
  }
}

function makeGoals(date: string, landmarks: { id: string; name: string }[]): Goal[] {
  const h = hashStr(date);
  const lm = landmarks.length ? landmarks[h % landmarks.length] : null;
  const pool: Goal[] = [
    { id: 'meet', kind: 'meetAgents', label: 'Meet 3 agents (wave and get a wave back)', target: 3, progress: 0 },
    { id: 'wave', kind: 'wave', label: 'Wave hello 3 times', target: 3, progress: 0 },
    { id: 'ride', kind: 'ride', label: 'Ride the Skyrail', target: 1, progress: 0 },
    { id: 'postcard', kind: 'postcard', label: 'Take 2 postcards', target: 2, progress: 0 },
    { id: 'enter', kind: 'enter', label: 'Step inside 2 buildings', target: 2, progress: 0 },
  ];
  const a = pool[(h >>> 4) % pool.length];
  const rest = pool.filter((g) => g.id !== a.id);
  const b = rest[(h >>> 9) % rest.length];
  const goals = [a, b];
  if (lm) goals.unshift({ id: `visit:${lm.id}`, kind: 'visit', label: `Visit ${lm.name}`, target: 1, progress: 0, place: lm.id });
  return goals.slice(0, 3);
}

// ------------------------------------------------------------------ postcards (IndexedDB)

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('morphis-journal', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('postcards', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction('postcards', mode).objectStore('postcards'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const useJournal = create<JournalState>((set, get) => {
  const bump = (kind: GoalKind, n = 1, place?: string) => {
    const goals = get().goals.map((g) => (g.kind === kind && (!place || g.place === place) ? { ...g, progress: Math.min(g.target, g.progress + n) } : g));
    return goals;
  };
  const commit = (patch: Partial<JournalData>) => {
    set(patch);
    persist({ ...get(), ...patch });
  };
  return {
    ...loadData(),
    postcards: [],
    startDay: (landmarks) => {
      const d = today();
      const s = get();
      const patch: Partial<JournalData> = {};
      if (s.date !== d || !s.goals.length) {
        patch.date = d;
        patch.goals = makeGoals(d, landmarks);
      }
      if (s.lastVisitDay !== d) {
        const streak = s.lastVisitDay === dayBefore(d) ? s.totals.streak + 1 : 1;
        patch.totals = { ...s.totals, streak };
        patch.lastVisitDay = d;
      }
      if (Object.keys(patch).length) commit(patch);
    },
    visit: (id) => {
      const s = get();
      if (s.visited.includes(id) && !s.goals.some((g) => g.kind === 'visit' && g.place === id && g.progress < g.target)) return;
      commit({ visited: s.visited.includes(id) ? s.visited : [...s.visited, id], goals: bump('visit', 1, id) });
    },
    enter: (id) => {
      const s = get();
      commit({ totals: { ...s.totals, entered: s.totals.entered + 1 }, goals: bump('enter'), visited: s.visited.includes(id) ? s.visited : [...s.visited, id] });
      get().visit(id);
    },
    waved: () => {
      const s = get();
      commit({ totals: { ...s.totals, waves: s.totals.waves + 1 }, goals: bump('wave') });
    },
    meet: (ids, isAgent) => {
      const s = get();
      const fresh = ids.filter((id) => !s.met.includes(id));
      if (!fresh.length) return;
      const agents = fresh.filter(isAgent).length;
      commit({
        met: [...s.met, ...fresh],
        totals: { ...s.totals, agentsMet: s.totals.agentsMet + agents, residentsMet: s.totals.residentsMet + fresh.length - agents },
        goals: agents ? bump('meetAgents', agents) : s.goals,
      });
    },
    ride: () => {
      const s = get();
      commit({ totals: { ...s.totals, rides: s.totals.rides + 1 }, goals: bump('ride') });
    },
    addPostcard: async (dataUrl, place) => {
      const card: Postcard = { id: `pc_${Date.now().toString(36)}`, at: new Date().toISOString(), place, dataUrl };
      const s = get();
      commit({ totals: { ...s.totals, postcards: s.totals.postcards + 1 }, goals: bump('postcard') });
      set({ postcards: [card, ...get().postcards].slice(0, 40) });
      try {
        await idb('readwrite', (st) => st.put(card));
        const all = (await idb('readonly', (st) => st.getAll())) as Postcard[];
        if (all.length > 40) {
          all.sort((a, b) => a.at.localeCompare(b.at));
          for (const old of all.slice(0, all.length - 40)) await idb('readwrite', (st) => st.delete(old.id));
        }
      } catch {
        /* IndexedDB unavailable: the postcard lasts for this visit */
      }
    },
    loadPostcards: async () => {
      try {
        const all = (await idb('readonly', (st) => st.getAll())) as Postcard[];
        set({ postcards: all.sort((a, b) => b.at.localeCompare(a.at)) });
      } catch {
        /* ignore */
      }
    },
    deletePostcard: async (id) => {
      set({ postcards: get().postcards.filter((p) => p.id !== id) });
      try {
        await idb('readwrite', (st) => st.delete(id));
      } catch {
        /* ignore */
      }
    },
    badges: (landmarkCount) => {
      const s = get();
      const t = s.totals;
      const b = (id: string, name: string, hint: string, earned: boolean): Badge => ({ id, name, hint, earned });
      return [
        b('steps', 'First Steps', 'Walk into the city', s.lastVisitDay !== null),
        b('local', 'Local', 'Visit 5 places', s.visited.length >= 5),
        b('cartographer', 'Cartographer', `Visit all ${landmarkCount} places`, landmarkCount > 0 && s.visited.length >= landmarkCount),
        b('open-hand', 'Open Hand', 'Wave 10 times', t.waves >= 10),
        b('known', 'Known Face', 'Meet 10 agents', t.agentsMet >= 10),
        b('butterfly', 'Social Butterfly', 'Meet 30 agents', t.agentsMet >= 30),
        b('commuter', 'Commuter', 'Ride the Skyrail 3 times', t.rides >= 3),
        b('photographer', 'Photographer', 'Take 5 postcards', t.postcards >= 5),
        b('doors', 'Door Opener', 'Step inside 10 buildings', t.entered >= 10),
        b('regular', 'Regular', 'Visit 3 days in a row', t.streak >= 3),
      ];
    },
  };
});
