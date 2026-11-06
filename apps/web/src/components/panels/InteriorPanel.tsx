/** Interior navigation: rooms, who is where, and the way back to the city. */
import { useMemo } from 'react';
import { BUILDING_TYPES } from '@morphis/shared';
import { placeOccupants } from '../../scene/interiors/layouts';
import { floorLabel, floorOfOccupant, floorsOf, planFor } from '../../scene/interiors/plan';
import { hash01 } from '../../scene/positions';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon } from '../ui/icons';
import { exitBuilding } from './actions';
import { leaveInterior } from '../../scene/guest/InteriorGuest';
import { useGuest } from '../../state/guestStore';

export function InteriorPanel() {
  const interior = useUI((s) => s.interior);
  const b = useSim((s) => (interior ? s.buildingsById.get(interior.buildingId) : undefined));
  const state = useSim((s) => s.state);
  const citizens = useSim((s) => s.citizens);
  const floor = interior?.floor ?? 0;
  const layout = useMemo(() => (b ? planFor(b, floor, b.name) : null), [b, floor]);
  if (!interior || !b || !layout) return null;
  const floors = floorsOf(b);
  const all = state ? state.citizens.map((d, i) => ({ d, p: citizens[i], activity: d.activity as string })).filter((x) => x.d.location.kind === 'building' && x.d.location.id === b.id) : [];
  const inside = all.filter((x) => floorOfOccupant(b, x.p.index, x.activity) === floor);
  const placed = placeOccupants(layout, inside.slice(0, 120), hash01);
  return (
    <aside className="sel-panel glass interior-panel" data-testid="interior-panel">
      <div className="sel-panel__kicker">INTERIOR VIEW · {BUILDING_TYPES[b.type].label.toUpperCase()}</div>
      <h2>{b.name}</h2>
      <div className="badge">{all.length} PEOPLE INSIDE</div>
      {floors > 1 && (
        <>
          <h4>Floors</h4>
          <div className="floors" data-testid="floors">
            {Array.from({ length: floors }, (_, f) => (
              <button key={f} className={f === floor ? 'on' : ''} onClick={() => useUI.getState().setFloor(f)} data-testid={`floor-${f}`}>
                {f === 0 ? 'G' : f}
              </button>
            ))}
            <small>{floorLabel(floor)} · {inside.length} here</small>
          </div>
        </>
      )}
      <h4>Rooms</h4>
      <div className="list rooms">
        {layout.rooms.map((r, i) => {
          const n = placed.filter((x) => x.room === r).length;
          return (
            <button key={r.name} className={interior.room === i ? 'on' : ''} onClick={() => useUI.getState().setRoom(i)} data-testid={`room-${i}`}>
              <b>{r.name}</b>
              <small>
                {r.purpose}
                {n ? ` · ${n} here` : ''}
              </small>
            </button>
          );
        })}
      </div>
      {inside.length > 0 && (
        <>
          <h4>Occupants</h4>
          <div className="list">
            {inside.slice(0, 14).map(({ d, p }) => (
              <button key={p.id} onClick={() => useUI.getState().select({ kind: 'citizen', id: p.id })}>
                {p.name} · <small>{d.status.toLowerCase()}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="actions">
        <button onClick={() => (useGuest.getState().active ? leaveInterior() : exitBuilding())} data-testid="btn-exit">
          <Icon name="exit" /> EXIT BUILDING
        </button>
      </div>
      <p className="note">Occupants and their activities come from the live simulation.</p>
    </aside>
  );
}
