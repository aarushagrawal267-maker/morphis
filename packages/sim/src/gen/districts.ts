import type { District, Vec2 } from '@morphis/shared';
import { DISTRICT_TEMPLATES } from '@morphis/shared';

export function buildDistricts(size: number): District[] {
  const k = size / 256;
  return DISTRICT_TEMPLATES.map((t) => ({
    id: `district_${t.type}`,
    name: t.name,
    type: t.type,
    center: { x: t.center[0] * k, z: t.center[1] * k },
    radius: t.radius * k,
    populationDensity: t.populationDensity,
    buildingDensity: t.buildingDensity,
    trafficDensity: t.trafficDensity,
    buildingTypes: [...t.buildingTypes],
    color: t.color,
    description: t.description,
    tagline: t.tagline,
    icon: t.icon,
    heightRange: [...t.heightRange] as [number, number],
  }));
}

/**
 * District membership: the command district owns the plaza core, central city the
 * ring around it, and everything else goes to the district with the smallest
 * normalised distance (distance / radius) — a weighted Voronoi partition.
 */
export function districtAt(districts: District[], p: Vec2): District {
  const r = Math.hypot(p.x, p.z);
  const command = districts.find((d) => d.type === 'command')!;
  const central = districts.find((d) => d.type === 'central')!;
  if (r < command.radius) return command;
  let best = central;
  let bestScore = r / central.radius;
  for (const d of districts) {
    if (d.type === 'command' || d.type === 'central') continue;
    const s = Math.hypot(p.x - d.center.x, p.z - d.center.z) / d.radius;
    if (s < bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}
