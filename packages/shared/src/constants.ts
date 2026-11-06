import type { BuildingType, DistrictType, InteriorKind, RoadClass } from './types/world';
import type { CoreRole } from './types/sim';

export const CITY_NAME = 'MORPHIS';
export const CITY_TAGLINE = 'EMERGENT AI CITY • YEAR 2126 • THE COMPLEX';
export const DEFAULT_SEED = 2126;
export const WORLD_VERSION = 1;

/** Simulation tick length in simulated seconds (fixed timestep). */
export const TICK_SECONDS = 1;
/**
 * Base pacing: at 1x one real second advances one simulated minute
 * (a full day takes 24 real minutes). Higher speeds multiply this.
 */
export const BASE_SIM_SECONDS_PER_REAL_SECOND = 60;
export const SIM_SPEEDS = [1, 5, 10, 30, 60] as const;
export type SimSpeed = (typeof SIM_SPEEDS)[number];

export const DAY_SECONDS = 86400;
/** The city starts on Day 1 (a Monday) at 06:40. */
export const START_TIME = 6 * 3600 + 40 * 60;
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export function dayOf(time: number): number {
  return Math.floor(time / DAY_SECONDS) + 1;
}
export function secondsOfDay(time: number): number {
  return ((time % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}
export function minuteOfDay(time: number): number {
  return Math.floor(secondsOfDay(time) / 60);
}
export function hourOf(time: number): number {
  return secondsOfDay(time) / 3600;
}
export function weekdayOf(time: number): number {
  return (dayOf(time) - 1) % 7;
}
export function isWeekend(time: number): boolean {
  return weekdayOf(time) >= 5;
}
export function formatClock(time: number): string {
  const s = secondsOfDay(time);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function formatSimDateTime(time: number): string {
  return `DAY ${dayOf(time)} ${WEEKDAYS[weekdayOf(time)]} ${formatClock(time)}`;
}
/** Simulated currency formatting. The "§" credit sign marks every amount as fictional. */
export function formatCredits(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}§${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}§${(a / 1e3).toFixed(1)}K`;
  return `${sign}§${Math.round(a).toLocaleString('en-US')}`;
}

/** Sun elevation factor 0 (night) .. 1 (day) derived from simulation time. */
export function daylight(time: number): number {
  const h = hourOf(time);
  // sunrise ~06:00, sunset ~19:30 with ~1.2h twilight
  const rise = smoothstep(5.2, 7.0, h);
  const set = 1 - smoothstep(18.6, 20.4, h);
  return Math.max(0, Math.min(rise, set));
}
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- roads

export const LANE_WIDTH = 1.4;

export const ROAD_CLASSES: Record<
  RoadClass,
  { lanes: number; sidewalk: number; median: number; speed: number; label: string; capacity: number }
> = {
  // speeds in world units per *motion second* (see MOTION_SECONDS_PER_TICK)
  highway: { lanes: 3, sidewalk: 0, median: 1.0, speed: 8, label: 'Expressway', capacity: 1.0 },
  avenue: { lanes: 2, sidewalk: 1.6, median: 0.6, speed: 5.5, label: 'Avenue', capacity: 0.7 },
  street: { lanes: 1, sidewalk: 1.3, median: 0, speed: 4.4, label: 'Street', capacity: 0.4 },
  local: { lanes: 1, sidewalk: 1.1, median: 0, speed: 3.6, label: 'Lane', capacity: 0.3 },
};

export function roadWidth(cls: RoadClass): number {
  const c = ROAD_CLASSES[cls];
  return c.lanes * 2 * LANE_WIDTH + c.median;
}

/**
 * Motion time compression. The city is a compressed model of a metropolis: one
 * tick advances the clock by one simulated second, but street-level motion
 * (walking, driving, signal cycles, dwell times) advances by 1/18 of a "motion
 * second". At 1x this makes a pedestrian walk at a natural pace on screen while
 * a cross-town walk still takes a realistic 30-60 clock minutes.
 */
export const MOTION_SECONDS_PER_TICK = 1 / 18;
export const SIM_SECONDS_PER_MOTION_SECOND = 18;

/** Pedestrian walking speed in world units per motion second (≈1.3 m/s). */
export const WALK_SPEED = 0.65;

/** Signal timing in motion seconds. */
export const SIGNAL_GREEN = 15;
export const SIGNAL_YELLOW = 2.5;
export const SIGNAL_ALL_RED = 1.5;
export const SIGNAL_CYCLE = 2 * (SIGNAL_GREEN + SIGNAL_YELLOW + SIGNAL_ALL_RED);

// ---------------------------------------------------------------- districts

export interface DistrictTemplate {
  type: DistrictType;
  name: string;
  center: [number, number];
  radius: number;
  color: string;
  icon: string;
  tagline: string;
  description: string;
  populationDensity: number;
  buildingDensity: number;
  trafficDensity: number;
  heightRange: [number, number];
  buildingTypes: BuildingType[];
}

export const DISTRICT_TEMPLATES: DistrictTemplate[] = [
  {
    type: 'command',
    name: 'JARVIS Command District',
    center: [0, 0],
    radius: 24,
    color: '#22d3ee',
    icon: 'core',
    tagline: 'JARVIS HQ • Plaza • Command',
    description: 'The civic heart of Morphis. JARVIS HQ rises above the central plaza and coordinates the city workforce.',
    populationDensity: 0.3,
    buildingDensity: 0.4,
    trafficDensity: 0.6,
    heightRange: [20, 40],
    buildingTypes: ['government', 'office'],
  },
  {
    type: 'central',
    name: 'Central City',
    center: [0, 0],
    radius: 54,
    color: '#38bdf8',
    icon: 'tower',
    tagline: 'Towers • Commerce • Admin',
    description: 'Dense high-rise core with commercial towers, administration and the busiest streets in the city.',
    populationDensity: 0.7,
    buildingDensity: 1,
    trafficDensity: 0.9,
    heightRange: [22, 72],
    buildingTypes: ['corporate_tower', 'office', 'shop', 'cafe', 'restaurant', 'luxury_apartment', 'bank', 'parking'],
  },
  {
    type: 'education',
    name: 'Education District',
    center: [-84, -88],
    radius: 32,
    color: '#60a5fa',
    icon: 'book',
    tagline: 'University • School • Training',
    description: 'Home of Morphis University, the city library and training academies.',
    populationDensity: 0.5,
    buildingDensity: 0.65,
    trafficDensity: 0.5,
    heightRange: [8, 26],
    buildingTypes: ['school', 'library', 'apartment', 'cafe', 'shop', 'office'],
  },
  {
    type: 'research',
    name: 'Research District',
    center: [-8, -94],
    radius: 32,
    color: '#4ade80',
    icon: 'flask',
    tagline: 'Labs • Innovation • R&D',
    description: 'Laboratories and experimental facilities where new technology is prototyped.',
    populationDensity: 0.3,
    buildingDensity: 0.7,
    trafficDensity: 0.5,
    heightRange: [10, 34],
    buildingTypes: ['research_lab', 'office', 'cafe', 'data_center'],
  },
  {
    type: 'technology',
    name: 'Technology District',
    center: [76, -90],
    radius: 34,
    color: '#2dd4bf',
    icon: 'cpu',
    tagline: 'Software • AI • Development',
    description: 'Software studios, AI companies and the server farms that power them.',
    populationDensity: 0.4,
    buildingDensity: 0.85,
    trafficDensity: 0.7,
    heightRange: [16, 62],
    buildingTypes: ['office', 'corporate_tower', 'data_center', 'cafe', 'shop', 'apartment'],
  },
  {
    type: 'corporate',
    name: 'Corporate District',
    center: [90, -36],
    radius: 30,
    color: '#a78bfa',
    icon: 'briefcase',
    tagline: 'Headquarters • Offices • Strategy',
    description: 'Glass headquarters of the largest companies in Morphis.',
    populationDensity: 0.3,
    buildingDensity: 0.95,
    trafficDensity: 0.8,
    heightRange: [26, 84],
    buildingTypes: ['corporate_tower', 'office', 'restaurant', 'cafe', 'parking'],
  },
  {
    type: 'finance',
    name: 'Finance District',
    center: [92, 10],
    radius: 28,
    color: '#fbbf24',
    icon: 'bank',
    tagline: 'Banks • Trading • Economy',
    description: 'Banks, exchanges and the trading floors that move the city economy.',
    populationDensity: 0.3,
    buildingDensity: 0.95,
    trafficDensity: 0.75,
    heightRange: [24, 76],
    buildingTypes: ['bank', 'corporate_tower', 'office', 'restaurant', 'luxury_apartment'],
  },
  {
    type: 'healthcare',
    name: 'Healthcare District',
    center: [90, 56],
    radius: 28,
    color: '#f87171',
    icon: 'heart',
    tagline: 'Hospital • Clinics • Care',
    description: 'Morphis General Hospital and specialist clinics.',
    populationDensity: 0.4,
    buildingDensity: 0.7,
    trafficDensity: 0.6,
    heightRange: [12, 40],
    buildingTypes: ['office', 'apartment', 'cafe', 'shop', 'research_lab'],
  },
  {
    type: 'creative',
    name: 'Creative District',
    center: [-88, -36],
    radius: 30,
    color: '#e879f9',
    icon: 'palette',
    tagline: 'Studios • Media • Design',
    description: 'Converted lofts filled with design studios, media labs and galleries.',
    populationDensity: 0.6,
    buildingDensity: 0.8,
    trafficDensity: 0.5,
    heightRange: [10, 30],
    buildingTypes: ['office', 'apartment', 'cafe', 'shop', 'restaurant'],
  },
  {
    type: 'residential',
    name: 'Residential District',
    center: [-90, 14],
    radius: 38,
    color: '#f472b6',
    icon: 'home',
    tagline: 'Apartments • Homes • Citizens',
    description: 'Apartment blocks and neighbourhood streets where most citizens live.',
    populationDensity: 1,
    buildingDensity: 0.85,
    trafficDensity: 0.45,
    heightRange: [14, 46],
    buildingTypes: ['apartment', 'apartment', 'luxury_apartment', 'shop', 'cafe', 'school'],
  },
  {
    type: 'entertainment',
    name: 'Entertainment District',
    center: [-84, 66],
    radius: 30,
    color: '#fb7185',
    icon: 'music',
    tagline: 'Restaurants • Cafes • Nightlife',
    description: 'Neon-soaked streets of restaurants, arcades, venues and nightlife.',
    populationDensity: 0.5,
    buildingDensity: 0.85,
    trafficDensity: 0.6,
    heightRange: [8, 30],
    buildingTypes: ['restaurant', 'cafe', 'shop', 'entertainment', 'apartment'],
  },
  {
    type: 'transport',
    name: 'Public Transport District',
    center: [-28, 96],
    radius: 28,
    color: '#facc15',
    icon: 'bus',
    tagline: 'Transit Hub • Depots • Logistics',
    description: 'The central transit hub, bus depot and parking structures.',
    populationDensity: 0.3,
    buildingDensity: 0.6,
    trafficDensity: 0.9,
    heightRange: [6, 20],
    buildingTypes: ['parking', 'warehouse', 'office', 'cafe', 'apartment'],
  },
  {
    type: 'industrial',
    name: 'Industrial District',
    center: [36, 98],
    radius: 30,
    color: '#fb923c',
    icon: 'factory',
    tagline: 'Factories • Manufacturing',
    description: 'Fabrication plants and warehouses supplying the city.',
    populationDensity: 0.15,
    buildingDensity: 0.7,
    trafficDensity: 0.7,
    heightRange: [6, 16],
    buildingTypes: ['factory', 'warehouse', 'warehouse', 'office'],
  },
  {
    type: 'utilities',
    name: 'Utilities District',
    center: [96, 100],
    radius: 24,
    color: '#a3e635',
    icon: 'bolt',
    tagline: 'Power • Water • Infrastructure',
    description: 'Fusion power station, water treatment and grid infrastructure.',
    populationDensity: 0.05,
    buildingDensity: 0.5,
    trafficDensity: 0.4,
    heightRange: [5, 18],
    buildingTypes: ['warehouse', 'factory'],
  },
];

// ---------------------------------------------------------------- buildings

export type BuildingCategory =
  | 'residential'
  | 'office'
  | 'food'
  | 'retail'
  | 'education'
  | 'research'
  | 'industry'
  | 'civic'
  | 'health'
  | 'infrastructure'
  | 'leisure'
  | 'open';

export interface BuildingTypeMeta {
  label: string;
  category: BuildingCategory;
  jobsPerFloor: number;
  residentsPerFloor: number;
  /** Opening hours [open, close) in hours; null = always open. */
  hours: [number, number] | null;
  energy: number;
  price: number;
  interior: InteriorKind | null;
}

export const BUILDING_TYPES: Record<BuildingType, BuildingTypeMeta> = {
  hq: { label: 'Command Headquarters', category: 'civic', jobsPerFloor: 1, residentsPerFloor: 0, hours: null, energy: 1, price: 0, interior: 'hq' },
  corporate_tower: { label: 'Corporate Tower', category: 'office', jobsPerFloor: 0.6, residentsPerFloor: 0, hours: [7, 21], energy: 0.8, price: 0, interior: 'office' },
  office: { label: 'Office Building', category: 'office', jobsPerFloor: 0.6, residentsPerFloor: 0, hours: [7, 20], energy: 0.6, price: 0, interior: 'office' },
  apartment: { label: 'Apartment Building', category: 'residential', jobsPerFloor: 0, residentsPerFloor: 2.2, hours: null, energy: 0.4, price: 0, interior: 'apartment' },
  luxury_apartment: { label: 'Luxury Apartments', category: 'residential', jobsPerFloor: 0.05, residentsPerFloor: 1.4, hours: null, energy: 0.5, price: 0, interior: 'apartment' },
  school: { label: 'School', category: 'education', jobsPerFloor: 1.5, residentsPerFloor: 0, hours: [7, 17], energy: 0.4, price: 0, interior: null },
  university: { label: 'University', category: 'education', jobsPerFloor: 1.6, residentsPerFloor: 0, hours: [7, 22], energy: 0.6, price: 0, interior: 'university' },
  library: { label: 'Library', category: 'education', jobsPerFloor: 1, residentsPerFloor: 0, hours: [8, 22], energy: 0.3, price: 0, interior: null },
  research_lab: { label: 'Research Lab', category: 'research', jobsPerFloor: 1.4, residentsPerFloor: 0, hours: [6, 23], energy: 0.8, price: 0, interior: 'lab' },
  ai_lab: { label: 'AI Laboratory', category: 'research', jobsPerFloor: 1.5, residentsPerFloor: 0, hours: null, energy: 1, price: 0, interior: 'lab' },
  factory: { label: 'Factory', category: 'industry', jobsPerFloor: 4, residentsPerFloor: 0, hours: [5, 23], energy: 1, price: 0, interior: null },
  warehouse: { label: 'Warehouse', category: 'industry', jobsPerFloor: 2, residentsPerFloor: 0, hours: [5, 22], energy: 0.4, price: 0, interior: null },
  shop: { label: 'Shop', category: 'retail', jobsPerFloor: 2, residentsPerFloor: 0, hours: [9, 21], energy: 0.3, price: 42, interior: null },
  cafe: { label: 'Cafe', category: 'food', jobsPerFloor: 2, residentsPerFloor: 0, hours: [6, 22], energy: 0.3, price: 11, interior: null },
  restaurant: { label: 'Restaurant', category: 'food', jobsPerFloor: 3, residentsPerFloor: 0, hours: [11, 24], energy: 0.4, price: 28, interior: null },
  bank: { label: 'Bank', category: 'office', jobsPerFloor: 0.8, residentsPerFloor: 0, hours: [8, 18], energy: 0.6, price: 0, interior: 'office' },
  hospital: { label: 'Hospital', category: 'health', jobsPerFloor: 2.4, residentsPerFloor: 0, hours: null, energy: 0.9, price: 0, interior: null },
  data_center: { label: 'Data Center', category: 'infrastructure', jobsPerFloor: 0.8, residentsPerFloor: 0, hours: null, energy: 1, price: 0, interior: null },
  parking: { label: 'Parking Structure', category: 'infrastructure', jobsPerFloor: 0.2, residentsPerFloor: 0, hours: null, energy: 0.1, price: 0, interior: null },
  entertainment: { label: 'Entertainment Center', category: 'leisure', jobsPerFloor: 3, residentsPerFloor: 0, hours: [12, 26], energy: 0.7, price: 34, interior: null },
  government: { label: 'Government Building', category: 'civic', jobsPerFloor: 1.2, residentsPerFloor: 0, hours: [8, 18], energy: 0.5, price: 0, interior: 'office' },
  power_plant: { label: 'Power Plant', category: 'infrastructure', jobsPerFloor: 3, residentsPerFloor: 0, hours: null, energy: 0, price: 0, interior: null },
  water_facility: { label: 'Water Facility', category: 'infrastructure', jobsPerFloor: 2, residentsPerFloor: 0, hours: null, energy: 0.5, price: 0, interior: null },
  transit_hub: { label: 'Transit Hub', category: 'infrastructure', jobsPerFloor: 3, residentsPerFloor: 0, hours: [5, 25], energy: 0.6, price: 0, interior: null },
  park: { label: 'Park', category: 'open', jobsPerFloor: 0, residentsPerFloor: 0, hours: null, energy: 0.02, price: 0, interior: null },
  plaza: { label: 'Plaza', category: 'open', jobsPerFloor: 0, residentsPerFloor: 0, hours: null, energy: 0.02, price: 0, interior: null },
};

export function isOpenAt(type: BuildingType, hour: number): boolean {
  const h = BUILDING_TYPES[type].hours;
  if (!h) return true;
  const [o, c] = h;
  if (c > 24) return hour >= o || hour < c - 24;
  return hour >= o && hour < c;
}

// ---------------------------------------------------------------- workforce

export interface CoreRoleMeta {
  label: string;
  department: string;
  /** Preferred workplace building ids (named landmarks) in priority order. */
  workplaces: string[];
  skills: string[];
  color: string;
}

export const CORE_ROLES: Record<CoreRole, CoreRoleMeta> = {
  researcher: { label: 'Researcher', department: 'Research', workplaces: ['ai_lab'], skills: ['research', 'analysis', 'writing'], color: '#4ade80' },
  data_analyst: { label: 'Data Analyst', department: 'Research', workplaces: ['ai_lab'], skills: ['analysis', 'python', 'sql'], color: '#4ade80' },
  product_manager: { label: 'Product Manager', department: 'Product', workplaces: ['hq'], skills: ['planning', 'communication', 'analysis'], color: '#22d3ee' },
  ux_researcher: { label: 'UX Researcher', department: 'Design', workplaces: ['studio'], skills: ['research', 'design', 'communication'], color: '#e879f9' },
  ui_designer: { label: 'UI Designer', department: 'Design', workplaces: ['studio'], skills: ['design', 'visual', 'prototyping'], color: '#e879f9' },
  frontend_developer: { label: 'Frontend Developer', department: 'Engineering', workplaces: ['orbital'], skills: ['typescript', 'react', 'design'], color: '#2dd4bf' },
  backend_developer: { label: 'Backend Developer', department: 'Engineering', workplaces: ['orbital'], skills: ['typescript', 'databases', 'apis'], color: '#2dd4bf' },
  ai_engineer: { label: 'AI Engineer', department: 'Engineering', workplaces: ['ai_lab'], skills: ['python', 'ml', 'research'], color: '#2dd4bf' },
  qa_engineer: { label: 'QA Engineer', department: 'Engineering', workplaces: ['orbital'], skills: ['testing', 'automation', 'analysis'], color: '#2dd4bf' },
  devops_engineer: { label: 'DevOps Engineer', department: 'Infrastructure', workplaces: ['datacenter'], skills: ['infrastructure', 'automation', 'security'], color: '#38bdf8' },
  finance_analyst: { label: 'Finance Analyst', department: 'Finance', workplaces: ['bank'], skills: ['finance', 'analysis', 'modelling'], color: '#fbbf24' },
  marketing_strategist: { label: 'Marketing Strategist', department: 'Growth', workplaces: ['corporate'], skills: ['marketing', 'writing', 'analysis'], color: '#a78bfa' },
  sales_specialist: { label: 'Sales Specialist', department: 'Growth', workplaces: ['corporate'], skills: ['sales', 'communication', 'negotiation'], color: '#a78bfa' },
  business_strategist: { label: 'Business Strategist', department: 'Strategy', workplaces: ['corporate'], skills: ['strategy', 'analysis', 'finance'], color: '#a78bfa' },
  operations_manager: { label: 'Operations Manager', department: 'Operations', workplaces: ['hq'], skills: ['operations', 'planning', 'communication'], color: '#22d3ee' },
  content_writer: { label: 'Content Writer', department: 'Media', workplaces: ['studio'], skills: ['writing', 'research', 'editing'], color: '#e879f9' },
  media_specialist: { label: 'Media Specialist', department: 'Media', workplaces: ['studio'], skills: ['video', 'visual', 'writing'], color: '#e879f9' },
  customer_support: { label: 'Customer Support Specialist', department: 'Operations', workplaces: ['corporate'], skills: ['communication', 'empathy', 'documentation'], color: '#a78bfa' },
  hr_coordinator: { label: 'HR Coordinator', department: 'People', workplaces: ['corporate'], skills: ['communication', 'planning', 'empathy'], color: '#a78bfa' },
  legal_researcher: { label: 'Legal Researcher', department: 'Legal', workplaces: ['corporate'], skills: ['research', 'law', 'writing'], color: '#a78bfa' },
  security_analyst: { label: 'Security Analyst', department: 'Infrastructure', workplaces: ['datacenter'], skills: ['security', 'analysis', 'infrastructure'], color: '#38bdf8' },
  innovation_lead: { label: 'Innovation Lead', department: 'Strategy', workplaces: ['hq'], skills: ['strategy', 'research', 'planning'], color: '#22d3ee' },
  educator: { label: 'Educator / Trainer', department: 'Education', workplaces: ['university'], skills: ['teaching', 'writing', 'communication'], color: '#60a5fa' },
  project_manager: { label: 'Project Manager', department: 'Product', workplaces: ['hq'], skills: ['planning', 'communication', 'operations'], color: '#22d3ee' },
  documentation_specialist: { label: 'Documentation Specialist', department: 'Product', workplaces: ['hq'], skills: ['writing', 'editing', 'documentation'], color: '#22d3ee' },
};

export const CORE_ROLE_ORDER: CoreRole[] = [
  'researcher',
  'data_analyst',
  'product_manager',
  'ux_researcher',
  'ui_designer',
  'frontend_developer',
  'backend_developer',
  'ai_engineer',
  'qa_engineer',
  'devops_engineer',
  'finance_analyst',
  'marketing_strategist',
  'sales_specialist',
  'business_strategist',
  'operations_manager',
  'content_writer',
  'media_specialist',
  'customer_support',
  'hr_coordinator',
  'legal_researcher',
  'security_analyst',
  'innovation_lead',
  'educator',
  'project_manager',
  'documentation_specialist',
];

export const CORE_CITIZEN_NAMES: Record<CoreRole, string> = {
  researcher: 'Sarah Chen',
  data_analyst: 'Omar Haddad',
  product_manager: 'Daniel Park',
  ux_researcher: 'Maya Rao',
  ui_designer: 'Lena Fischer',
  frontend_developer: 'Alex Ray',
  backend_developer: 'Kenji Watanabe',
  ai_engineer: 'Priya Nair',
  qa_engineer: 'Tomás Silva',
  devops_engineer: 'Grace Okafor',
  finance_analyst: 'Victor Lindqvist',
  marketing_strategist: 'Chloe Martin',
  sales_specialist: 'Marcus Bell',
  business_strategist: 'Elena Petrova',
  operations_manager: 'Samuel Adeyemi',
  content_writer: 'Hannah Brooks',
  media_specialist: 'Rafael Costa',
  customer_support: 'Aisha Rahman',
  hr_coordinator: 'Nora Kim',
  legal_researcher: 'Julian Weiss',
  security_analyst: 'Ivy Zhang',
  innovation_lead: 'Mateo Alvarez',
  educator: 'Dr. Amara Osei',
  project_manager: 'Leo Novak',
  documentation_specialist: 'Iris Moreau',
};
