/**
 * Population generation: homes, workplaces, schedules, money and appearance
 * for the background population and the 25 core workforce citizens, plus the
 * initial vehicle fleets (private cars, taxis, buses, delivery vans).
 */
import type { ActivityKind, BuildingDef, BuildingType, CitizenProfile, CoreRole, ScheduleBlock } from '@morphis/shared';
import { BUILDING_TYPES, CORE_CITIZEN_NAMES, CORE_ROLES, CORE_ROLE_ORDER, START_TIME } from '@morphis/shared';
import type { Rng } from '../core/rng';
import type { CitizenRT } from '../state';
import type { CitySimulation } from '../engine';

const FIRST = [
  'Ava', 'Noah', 'Mia', 'Liam', 'Zara', 'Ethan', 'Yuki', 'Mateo', 'Amara', 'Lucas', 'Sofia', 'Kai', 'Leila', 'Ravi', 'Chloe', 'Diego',
  'Hana', 'Felix', 'Nadia', 'Oscar', 'Isla', 'Arjun', 'Freya', 'Tariq', 'Elena', 'Jonas', 'Mei', 'Samir', 'Clara', 'Theo', 'Anya', 'Malik',
  'Rosa', 'Viktor', 'Ines', 'Hugo', 'Leah', 'Kofi', 'Selin', 'Max', 'Priya', 'Bruno', 'Ayla', 'Dmitri', 'Nora', 'Emeka', 'Lin', 'Pablo',
  'Ingrid', 'Rafael', 'Yara', 'Adrian', 'Keiko', 'Omar', 'Lucia', 'Ibrahim', 'Maren', 'Andre', 'Talia', 'Jin',
];
const LAST = [
  'Okoro', 'Tanaka', 'Silva', 'Novak', 'Haddad', 'Larsen', 'Mehta', 'Costa', 'Ivanova', 'Kim', 'Moreno', 'Fischer', 'Osei', 'Park', 'Rossi',
  'Nguyen', 'Kowalski', 'Ahmed', 'Bauer', 'Santos', 'Sato', 'Petrov', 'Diaz', 'Lindqvist', 'Adeyemi', 'Chen', 'Varga', 'Murphy', 'Ortiz',
  'Hoffmann', 'Ali', 'Yamamoto', 'Duarte', 'Nakamura', 'Singh', 'Popescu', 'Mendes', 'Weber', 'Kaya', 'Rahman', 'Lopez', 'Jansen', 'Cruz',
  'Wong', 'Eriksen', 'Banerjee', 'Morales', 'Zhou', 'Sokolov', 'Dubois', 'Ruiz', 'Hassan', 'Kaur', 'Volkov', 'Reyes', 'Lee', 'Moyo',
];
const SKIN = ['#f1c7a3', '#e0ac69', '#c68642', '#8d5524', '#6b3e26', '#ffdbac', '#d4a07a', '#a8714a'];
const HAIR = ['#1a1a1a', '#3b2416', '#6b4423', '#c19a6b', '#e5e5e5', '#7c2d12', '#22d3ee', '#e879f9', '#a3e635', '#111827'];
const TOP = ['#0ea5e9', '#e11d48', '#7c3aed', '#f59e0b', '#10b981', '#334155', '#f472b6', '#1f2937', '#94a3b8', '#22d3ee', '#fafafa', '#b91c1c', '#4338ca'];
const BOTTOM = ['#111827', '#1f2937', '#334155', '#1e3a8a', '#3f3f46', '#27272a', '#44403c'];

const OCCUPATION: Partial<Record<BuildingType, string[]>> = {
  office: ['Software Engineer', 'Analyst', 'Account Manager', 'Designer', 'Consultant'],
  corporate_tower: ['Executive Assistant', 'Strategy Analyst', 'Engineering Manager', 'Product Owner'],
  bank: ['Banker', 'Risk Analyst', 'Trader', 'Teller'],
  cafe: ['Barista', 'Cafe Manager'],
  restaurant: ['Chef', 'Server', 'Line Cook'],
  shop: ['Retail Associate', 'Store Manager'],
  factory: ['Fabrication Technician', 'Robotics Operator', 'Line Supervisor'],
  warehouse: ['Logistics Operator', 'Drone Dispatcher'],
  hospital: ['Nurse', 'Doctor', 'Paramedic', 'Lab Technician'],
  school: ['Teacher', 'School Counsellor'],
  university: ['Lecturer', 'Research Assistant', 'Registrar'],
  library: ['Librarian', 'Archivist'],
  data_center: ['Systems Engineer', 'Network Engineer'],
  research_lab: ['Research Scientist', 'Lab Engineer'],
  ai_lab: ['ML Researcher', 'Data Engineer'],
  government: ['Civil Servant', 'Urban Planner', 'City Clerk'],
  transit_hub: ['Transit Operator', 'Station Agent'],
  power_plant: ['Fusion Technician', 'Grid Operator'],
  water_facility: ['Water Engineer', 'Plant Operator'],
  entertainment: ['Event Host', 'Sound Engineer', 'Performer'],
  parking: ['Parking Attendant'],
  hq: ['Operations Staff', 'Command Analyst'],
};

const SALARY: Partial<Record<BuildingType, number>> = {
  office: 5200, corporate_tower: 6500, bank: 6100, cafe: 2600, restaurant: 2900, shop: 2800, factory: 3600, warehouse: 3200,
  hospital: 5800, school: 4200, university: 5200, library: 3400, data_center: 6200, research_lab: 6400, ai_lab: 7200,
  government: 4600, transit_hub: 3600, power_plant: 4800, water_facility: 4200, entertainment: 3100, parking: 2500, hq: 6000,
};

type Shift = 'day' | 'early' | 'late' | 'night' | 'student' | 'free';

function shiftFor(rng: Rng, type: BuildingType | null): Shift {
  if (!type) return 'free';
  if (type === 'cafe' || type === 'factory' || type === 'warehouse' || type === 'shop') return rng.chance(0.55) ? 'early' : 'day';
  if (type === 'restaurant' || type === 'entertainment') return 'late';
  if (type === 'hospital' || type === 'data_center' || type === 'power_plant') return rng.chance(0.25) ? 'night' : 'day';
  return 'day';
}

export function buildSchedule(rng: Rng, shift: Shift, core: boolean): { weekday: ScheduleBlock[]; weekend: ScheduleBlock[] } {
  const j = (m: number, s: number): number => Math.max(1, Math.min(1438, Math.round(m + rng.range(-s, s))));
  const b = (start: number, activity: ActivityKind): ScheduleBlock => ({ start, activity });
  const evening = (): ActivityKind => rng.weighted(['leisure', 'shop', 'park', 'home', 'eat'] as ActivityKind[], (a) => ({ leisure: 3, shop: 1.2, park: 1.5, home: 2, eat: 1.5 })[a as string] ?? 1)!;
  let weekday: ScheduleBlock[];
  switch (shift) {
    case 'early':
      weekday = [b(0, 'sleep'), b(j(300, 15), 'home'), b(j(330, 15), 'work'), b(j(660, 15), 'eat'), b(j(705, 10), 'work'), b(j(840, 15), evening()), b(j(1000, 30), 'home'), b(j(1290, 30), 'sleep')];
      break;
    case 'late':
      weekday = [b(0, 'sleep'), b(j(540, 30), 'home'), b(j(660, 30), rng.chance(0.5) ? 'shop' : 'park'), b(j(780, 15), 'eat'), b(j(825, 10), 'work'), b(j(1335, 15), rng.chance(0.3) ? 'leisure' : 'home'), b(1415, 'sleep')];
      break;
    case 'night':
      weekday = [b(0, 'work'), b(j(375, 10), 'home'), b(j(420, 15), 'sleep'), b(j(900, 20), 'home'), b(j(1020, 30), evening()), b(j(1140, 20), 'eat'), b(j(1250, 10), 'work')];
      break;
    case 'student':
      weekday = [b(0, 'sleep'), b(j(450, 30), 'home'), b(j(500, 20), 'study'), b(j(750, 20), 'eat'), b(j(810, 15), 'study'), b(j(990, 30), evening()), b(j(1170, 30), 'home'), b(j(1410, 20), 'sleep')];
      break;
    case 'free':
      weekday = [b(0, 'sleep'), b(j(450, 40), 'home'), b(j(570, 40), rng.chance(0.5) ? 'park' : 'shop'), b(j(720, 20), 'eat'), b(j(820, 30), 'home'), b(j(1000, 40), evening()), b(j(1170, 30), 'home'), b(j(1350, 30), 'sleep')];
      break;
    default: {
      const start = core ? j(480, 30) : j(470, 35);
      weekday = [b(0, 'sleep'), b(j(start - 75, 15), 'home'), b(start, 'work'), b(j(735, 20), 'eat'), b(j(790, 12), 'work'), b(j(1065, 25), evening()), b(j(1190, 30), rng.chance(0.25) ? 'eat' : 'home'), b(j(1270, 20), 'home'), b(j(1380, 30), 'sleep')];
    }
  }
  const weekend = [b(0, 'sleep'), b(j(540, 50), 'home'), b(j(660, 30), rng.pick(['shop', 'park', 'leisure'] as ActivityKind[])), b(j(780, 20), 'eat'), b(j(870, 30), rng.pick(['leisure', 'park', 'shop'] as ActivityKind[])), b(j(1080, 30), rng.chance(0.4) ? 'eat' : 'home'), b(j(1200, 30), rng.chance(0.5) ? 'leisure' : 'home'), b(j(1350, 20), 'home'), b(1425, 'sleep')];
  const sort = (s: ScheduleBlock[]): ScheduleBlock[] => s.sort((x, y) => x.start - y.start);
  return { weekday: sort(weekday), weekend: sort(weekend) };
}

export function generatePopulation(sim: CitySimulation): void {
  const rng = sim.rng;
  const w = sim.world;
  const st = sim.state;
  const pop = w.config.population;
  const coreCount = Math.min(w.config.coreCitizens, CORE_ROLE_ORDER.length, pop);

  const homes = w.buildings.filter((b) => BUILDING_TYPES[b.type].category === 'residential' && !b.construction);
  const homeLoad = new Map<string, number>();
  const pickHome = (preferDistricts?: string[]): BuildingDef => {
    const candidates = homes.filter((h) => (homeLoad.get(h.id) ?? 0) < h.capacity);
    const pool = candidates.length ? candidates : homes;
    const h = rng.weighted(pool, (b) => {
      let wgt = Math.max(1, b.capacity - (homeLoad.get(b.id) ?? 0));
      if (preferDistricts?.includes(b.districtId)) wgt *= 3;
      if (b.districtId === 'district_residential') wgt *= 1.8;
      return wgt;
    })!;
    homeLoad.set(h.id, (homeLoad.get(h.id) ?? 0) + 1);
    return h;
  };

  const workBuildings = w.buildings.filter(
    (b) => !b.construction && b.jobs > 0 && !['residential', 'open'].includes(BUILDING_TYPES[b.type].category),
  );
  const jobLoad = new Map<string, number>();
  const pickWork = (): BuildingDef | null => {
    const open = workBuildings.filter((b) => (jobLoad.get(b.id) ?? 0) < Math.max(2, Math.round(b.jobs * 0.4)));
    if (!open.length) return null;
    const b = rng.weighted(open, (x) => Math.sqrt(x.jobs) * (x.named ? 2 : 1))!;
    jobLoad.set(b.id, (jobLoad.get(b.id) ?? 0) + 1);
    return b;
  };

  const university = sim.landmark('university');
  const usedNames = new Set<string>(Object.values(CORE_CITIZEN_NAMES));

  for (let i = 0; i < pop; i++) {
    const core = i < coreCount;
    const role: CoreRole | null = core ? CORE_ROLE_ORDER[i] : null;
    let name: string;
    if (role) name = CORE_CITIZEN_NAMES[role];
    else {
      do name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
      while (usedNames.has(name) && usedNames.size < FIRST.length * LAST.length - 10);
      usedNames.add(name);
    }
    let age: number;
    let work: BuildingDef | null = null;
    let shift: Shift;
    let occupation: string;
    let department: string;
    let salary: number;
    if (role) {
      const meta = CORE_ROLES[role];
      age = rng.int(26, 52);
      const key = meta.workplaces[0];
      work = sim.landmark(key) ?? sim.landmark('hq');
      shift = 'day';
      occupation = meta.label;
      department = meta.department;
      salary = Math.round(rng.range(7000, 9600) / 10) * 10;
    } else {
      const r = rng.float();
      age = r < 0.12 ? rng.int(18, 24) : r < 0.88 ? rng.int(25, 64) : rng.int(65, 84);
      if (age <= 24 && university && rng.chance(0.55)) {
        work = university;
        shift = 'student';
        occupation = 'Student';
        department = 'Morphis University';
        salary = 900;
      } else if (age < 65 && rng.chance(0.88)) {
        work = pickWork();
        shift = shiftFor(rng, work?.type ?? null);
        occupation = work ? rng.pick(OCCUPATION[work.type] ?? ['Specialist']) : 'Job Seeker';
        department = work ? BUILDING_TYPES[work.type].label : 'Unemployed';
        salary = work ? Math.round(((SALARY[work.type] ?? 3800) * rng.range(0.85, 1.25)) / 10) * 10 : 0;
      } else {
        work = null;
        shift = 'free';
        occupation = age >= 65 ? 'Retired' : 'Job Seeker';
        department = age >= 65 ? 'Retired' : 'Unemployed';
        salary = age >= 65 ? 2100 : 0;
      }
      if (!work && occupation !== 'Retired') shift = 'free';
    }
    const home = pickHome(role ? ['district_residential', 'district_creative', 'district_central'] : undefined);
    const rent = Math.round((home.type === 'luxury_apartment' ? rng.range(2200, 3000) : rng.range(1000, 1500)) / 10) * 10;
    const sched = buildSchedule(rng, shift, core);
    const skills: Record<string, number> = {};
    if (role) for (const s of CORE_ROLES[role].skills) skills[s] = Math.round(rng.range(0.7, 0.98) * 100) / 100;
    else skills.general = Math.round(rng.range(0.4, 0.9) * 100) / 100;

    const profile: CitizenProfile = {
      id: `citizen_${String(i).padStart(4, '0')}`,
      index: i,
      name,
      age,
      occupation,
      department,
      core,
      role,
      homeId: home.id,
      workplaceId: work?.id ?? null,
      districtId: home.districtId,
      skills,
      schedule: sched.weekday,
      weekendSchedule: sched.weekend,
      appearance: {
        skin: rng.pick(SKIN),
        hair: rng.pick(HAIR),
        top: role ? CORE_ROLES[role].color : rng.pick(TOP),
        bottom: rng.pick(BOTTOM),
        height: Math.round(rng.range(0.92, 1.08) * 100) / 100,
        build: Math.round(rng.range(0.9, 1.15) * 100) / 100,
      },
      ownsCar: false,
      salary,
      rent,
      bio: role
        ? `${CORE_ROLES[role].label} in the ${CORE_ROLES[role].department} department at ${work?.name ?? 'JARVIS HQ'}. One of the 25 core workforce citizens; will be bound to a real AI agent when an AI provider is connected.`
        : `${age}-year-old ${occupation.toLowerCase()}${work ? ` at ${work.name}` : ''}, living in ${home.name}.`,
    };
    profile.ownsCar = !!work && salary > 4200 && rng.chance(0.4);
    const money = Math.round(salary * rng.range(0.6, 1.6) + rng.range(200, 900));
    const c: CitizenRT = {
      profile,
      dyn: {
        status: 'SLEEPING',
        activity: 'sleep',
        location: { kind: 'building', id: home.id },
        destinationId: null,
        travelMode: null,
        energy: Math.round(rng.range(0.7, 0.95) * 100) / 100,
        satiety: Math.round(rng.range(0.5, 0.8) * 100) / 100,
        social: Math.round(rng.range(0.4, 0.8) * 100) / 100,
        fun: Math.round(rng.range(0.4, 0.8) * 100) / 100,
        happiness: 0.7,
        money,
        savings: Math.round(money * rng.range(1, 4)),
        currentTaskId: null,
        spending: { food: 0, shopping: 0, transport: 0, entertainment: 0, rent: 0 },
        earnedThisMonth: 0,
        employed: !!work && shift !== 'student',
      },
      nextDecision: START_TIME + rng.range(0, 600),
      trip: null,
      walker: null,
      carId: null,
      speedFactor: rng.range(0.85, 1.15),
      insideId: home.id,
      arrivedAt: 0,
      lastNeedsUpdate: START_TIME,
    };
    st.citizens.push(c);
    st.buildings[sim.bIndex(home.id)].occupants.push(profile.id);
  }

  // ---- fleets
  for (const c of st.citizens) {
    if (c.profile.ownsCar) {
      const v = sim.traffic.createVehicle('car', c.profile.id, `${c.profile.name.split(' ')[0]}'s car`, c.profile.homeId);
      c.carId = v.info.id;
    }
  }
  const stands = sim.taxiStands;
  const taxis = 6 + Math.round(pop / 60);
  for (let i = 0; i < taxis; i++) sim.traffic.createVehicle('taxi', null, `Taxi ${101 + i}`, stands[i % stands.length]);
  const depots = w.buildings.filter((b) => b.type === 'warehouse' || b.type === 'factory');
  const vans = depots.length ? 4 + Math.round(pop / 120) : 0;
  for (let i = 0; i < vans; i++) sim.traffic.createVehicle('delivery', null, `Delivery ${201 + i}`, depots[i % depots.length].id);
  for (const line of w.busLines) {
    const count = line.stops.length >= 7 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const v = sim.traffic.createVehicle('bus', null, `${line.name} ${k + 1}`, null, line.id);
      const start = Math.floor((k * line.stops.length) / count);
      if (!sim.traffic.setupBus(v, line.id, start)) {
        v.active = false;
        v.dyn.status = 'IDLE';
      }
    }
  }
}
