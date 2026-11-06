/**
 * Static world model: everything produced by the deterministic city generator.
 * The static world never changes during a simulation run (dynamic state lives in
 * the simulation state types). Coordinates: x = east, z = south (north = -z).
 * 1 world unit = 2 metres.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export type DistrictType =
  | 'central'
  | 'command'
  | 'corporate'
  | 'technology'
  | 'research'
  | 'finance'
  | 'education'
  | 'residential'
  | 'creative'
  | 'entertainment'
  | 'industrial'
  | 'healthcare'
  | 'transport'
  | 'utilities';

export interface District {
  id: string;
  name: string;
  type: DistrictType;
  center: Vec2;
  radius: number;
  populationDensity: number;
  buildingDensity: number;
  trafficDensity: number;
  buildingTypes: BuildingType[];
  color: string;
  description: string;
  tagline: string;
  icon: string;
  heightRange: [number, number];
}

export type RoadClass = 'highway' | 'avenue' | 'street' | 'local';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Signalised intersection. */
  signal: boolean;
  /** Incident edge ids sorted counter-clockwise by angle. */
  edges: number[];
  /** Radius of the intersection box (distance from node centre to stop line). */
  radius: number;
  /** Highway gate where external traffic enters/leaves the city. */
  gate: boolean;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  cls: RoadClass;
  /** Lanes per direction. */
  lanes: number;
  /** Total carriageway width (both directions, incl. median). */
  width: number;
  /** Sidewalk width on each side (0 = none). */
  sidewalk: number;
  median: number;
  length: number;
  /** Speed limit in world units per sim second. */
  speedLimit: number;
  name: string;
  /** Signal group (0/1) at node a and node b. */
  groupA: number;
  groupB: number;
  /** Distance from node a / node b to the stop line (start of the lane geometry). */
  setbackA: number;
  setbackB: number;
}

export type PedNodeKind = 'corner' | 'entrance' | 'stop' | 'park' | 'end';

export interface PedNode {
  id: number;
  x: number;
  z: number;
  kind: PedNodeKind;
  roadNode?: number;
  buildingId?: string;
}

export type PedEdgeKind = 'sidewalk' | 'crosswalk' | 'entrance' | 'path';

export interface PedEdge {
  id: number;
  a: number;
  b: number;
  kind: PedEdgeKind;
  length: number;
  /** For crosswalks: the road node they sit at and the road edge they cross. */
  roadNode?: number;
  crossesEdge?: number;
}

export type BuildingType =
  | 'hq'
  | 'corporate_tower'
  | 'office'
  | 'apartment'
  | 'luxury_apartment'
  | 'school'
  | 'university'
  | 'library'
  | 'research_lab'
  | 'ai_lab'
  | 'factory'
  | 'warehouse'
  | 'shop'
  | 'cafe'
  | 'restaurant'
  | 'bank'
  | 'hospital'
  | 'data_center'
  | 'parking'
  | 'entertainment'
  | 'government'
  | 'power_plant'
  | 'water_facility'
  | 'transit_hub'
  | 'park'
  | 'plaza';

export type FacadeType = 'glass' | 'grid' | 'ribbon' | 'panel' | 'industrial' | 'residential' | 'none';
export type RooftopType = 'flat' | 'hvac' | 'antenna' | 'helipad' | 'garden' | 'tanks' | 'spire' | 'dish' | 'crown';
export type ShapeKind = 'box' | 'cylinder' | 'hex';
export type InteriorKind = 'hq' | 'lab' | 'university' | 'office' | 'apartment' | 'cafe' | 'shop' | 'hall';

/** One volume of a building's massing, in building-local coordinates. */
export interface BuildingTier {
  shape: ShapeKind;
  /** Local offset of the tier centre (building local frame, before rotation). */
  ox: number;
  oz: number;
  w: number;
  d: number;
  y0: number;
  h: number;
  facade: FacadeType;
}

export interface NeonSpec {
  color: string;
  /** 'edge' = vertical edge strips, 'crown' = top band, 'band' = horizontal bands */
  style: 'edge' | 'crown' | 'band';
}

export interface BuildingDef {
  /** Stable id, e.g. building_00042 */
  id: string;
  index: number;
  name: string;
  type: BuildingType;
  districtId: string;
  position: Vec2;
  /** Rotation around Y in radians; local +z faces the street (the entrance side). */
  rotation: number;
  width: number;
  depth: number;
  height: number;
  floorCount: number;
  tiers: BuildingTier[];
  facade: FacadeType;
  windowDensity: number;
  /** Index into the architectural palette. */
  palette: number;
  rooftop: RooftopType;
  neon: NeonSpec | null;
  sign: string | null;
  antennas: number;
  balconies: boolean;
  /** Entrance point on the facade (world space). */
  entrance: Vec2;
  /** Pedestrian graph node of the entrance. */
  entranceNode: number;
  /** Kerb access for vehicles: road edge, distance from node a, side (+1 = right of a->b). */
  access: { edge: number; s: number; side: 1 | -1; point: Vec2 };
  capacity: number;
  jobs: number;
  enterable: boolean;
  interior: InteriorKind | null;
  named: boolean;
  important: boolean;
  /** Starts as a construction site (becomes active through simulated growth). */
  construction: boolean;
}

export interface PropInstance {
  x: number;
  z: number;
  r: number;
  s?: number;
  k?: number;
}

export interface WorldProps {
  streetLights: PropInstance[];
  trees: PropInstance[];
  benches: PropInstance[];
  planters: PropInstance[];
  billboards: PropInstance[];
  vents: PropInstance[];
  barriers: PropInstance[];
  parkedCars: PropInstance[];
  busStops: PropInstance[];
  /** Crosswalk stripes: centre + rotation + length. */
  crosswalks: PropInstance[];
}

export interface BusStop {
  id: string;
  name: string;
  /** Pedestrian node where citizens wait. */
  pedNode: number;
  /** Road edge and distance from node a where the bus halts. */
  edge: number;
  s: number;
  side: 1 | -1;
  position: Vec2;
}

export interface BusLine {
  id: string;
  name: string;
  color: string;
  /** Ordered stop ids; the line loops back to the first stop. */
  stops: string[];
}

export interface RailStation {
  id: string;
  name: string;
  /** Distance along the loop. */
  s: number;
  /** Street-level pedestrian node at the station's stairs. */
  pedNode: number;
  /** Platform centre (on the track). */
  position: Vec2;
  /** Street-level access point (the stair tower). */
  access: Vec2;
}

/** Elevated maglev loop ("Skyrail"). */
export interface RailLine {
  id: string;
  name: string;
  color: string;
  /** Closed polyline [x0, z0, x1, z1, ...] (the last point joins the first). */
  points: number[];
  cum: number[];
  length: number;
  /** Track height above the street. */
  height: number;
  stations: RailStation[];
  /** Support pylons: kerb-side foot and the track point they carry. */
  pylons: { x: number; z: number; tx: number; tz: number }[];
}

export interface SkylineBlock {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface CityConfig {
  seed: number;
  size: number;
  population: number;
  coreCitizens: number;
  buildingDensity: number;
  roadDensity: number;
  trafficDensity: number;
  parkFrequency: number;
  heightScale: number;
}

export interface StaticWorld {
  version: number;
  seed: number;
  config: CityConfig;
  size: number;
  hash: string;
  districts: District[];
  roads: { nodes: RoadNode[]; edges: RoadEdge[] };
  ped: { nodes: PedNode[]; edges: PedEdge[] };
  buildings: BuildingDef[];
  props: WorldProps;
  busStops: BusStop[];
  busLines: BusLine[];
  rail?: RailLine;
  skyline: SkylineBlock[];
  /** Ids of buildings considered landmarks (named, shown on the minimap). */
  landmarks: string[];
  hqId: string;
}
