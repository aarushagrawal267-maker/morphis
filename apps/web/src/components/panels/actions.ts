/** Shared UI actions (camera + selection) used by panels, nav and minimap. */
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { citizenPosition, vehiclePosition } from '../../scene/positions';

export function focusBuilding(id: string): void {
  const b = useSim.getState().buildingsById.get(id);
  if (!b) return;
  const ui = useUI.getState();
  ui.select({ kind: 'building', id });
  ui.requestCamera({ kind: 'building', x: b.position.x, z: b.position.z, height: b.height }, 'building');
}

export function focusPoint(x: number, z: number, radius = 70): void {
  useUI.getState().requestCamera({ kind: 'point', x, z, radius }, 'district');
}

export function streetView(x: number, z: number): void {
  useUI.getState().requestCamera({ kind: 'street', x, z }, 'street');
}

export function followCitizen(id: string): void {
  const sim = useSim.getState();
  const idx = sim.citizensById.get(id)?.index;
  const ui = useUI.getState();
  if (idx === undefined) return;
  ui.select({ kind: 'citizen', id });
  const p = citizenPosition(idx);
  if (p) ui.requestCamera({ kind: 'street', x: p.x, z: p.z }, 'follow');
  ui.setFollow({ kind: 'citizen', id });
}

export function followVehicle(id: string): void {
  const sim = useSim.getState();
  const idx = sim.vehicles.findIndex((v) => v.id === id);
  const ui = useUI.getState();
  if (idx < 0) return;
  ui.select({ kind: 'vehicle', id });
  const p = vehiclePosition(idx);
  if (p) ui.requestCamera({ kind: 'street', x: p.x, z: p.z }, 'follow');
  ui.setFollow({ kind: 'vehicle', id });
}

export function focusCitizen(id: string): void {
  const sim = useSim.getState();
  const idx = sim.citizensById.get(id)?.index;
  if (idx === undefined) return;
  const ui = useUI.getState();
  ui.select({ kind: 'citizen', id });
  const p = citizenPosition(idx);
  if (p) ui.requestCamera({ kind: 'street', x: p.x, z: p.z }, 'street');
}

export function enterBuilding(id: string): void {
  const b = useSim.getState().buildingsById.get(id);
  if (!b || !b.enterable) return;
  const ui = useUI.getState();
  ui.select({ kind: 'building', id });
  ui.enterInterior(id);
}
