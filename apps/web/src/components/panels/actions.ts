/** Shared UI actions (camera + selection) used by panels, nav and minimap. */
import { useGuest } from '../../state/guestStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { citizenPosition, vehiclePosition } from '../../scene/positions';

/** Camera moves need the city camera: leave walk-in mode first. */
function leaveWalk(): void {
  if (useGuest.getState().active) useGuest.getState().exit();
}

export function focusBuilding(id: string): void {
  leaveWalk();
  const b = useSim.getState().buildingsById.get(id);
  if (!b) return;
  const ui = useUI.getState();
  ui.select({ kind: 'building', id });
  ui.requestCamera({ kind: 'building', x: b.position.x, z: b.position.z, height: b.height }, 'building');
}

export function focusPoint(x: number, z: number, radius = 70): void {
  leaveWalk();
  useUI.getState().requestCamera({ kind: 'point', x, z, radius }, 'district');
}

export function streetView(x: number, z: number): void {
  leaveWalk();
  useUI.getState().requestCamera({ kind: 'street', x, z }, 'street');
}

export function followCitizen(id: string): void {
  leaveWalk();
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
  leaveWalk();
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
  leaveWalk();
  const sim = useSim.getState();
  const idx = sim.citizensById.get(id)?.index;
  if (idx === undefined) return;
  const ui = useUI.getState();
  ui.select({ kind: 'citizen', id });
  const p = citizenPosition(idx);
  if (p) ui.requestCamera({ kind: 'street', x: p.x, z: p.z }, 'street');
}

/** Fly to the entrance, fade, then switch to the interior scene. */
export function enterBuilding(id: string): void {
  const b = useSim.getState().buildingsById.get(id);
  if (!b || !b.enterable) return;
  const ui = useUI.getState();
  ui.select({ kind: 'building', id });
  ui.requestCamera({ kind: 'street', x: b.entrance.x, z: b.entrance.z }, 'street');
  setTimeout(() => useUI.getState().setFading(true), 650);
  setTimeout(() => {
    useUI.getState().enterInterior(id);
    useUI.getState().select(null);
  }, 1000);
  setTimeout(() => useUI.getState().setFading(false), 1250);
}

export function exitBuilding(): void {
  const ui = useUI.getState();
  const id = ui.interior?.buildingId;
  ui.setFading(true);
  setTimeout(() => {
    useUI.getState().exitInterior();
    if (id) focusBuilding(id);
  }, 300);
  setTimeout(() => useUI.getState().setFading(false), 650);
}
