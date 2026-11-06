/** Floating information panels for the current selection. Every button performs a real action. */
import { useMemo } from 'react';
import type { BuildingDef, CitizenDynamic, CitizenProfile } from '@morphis/shared';
import { BUILDING_TYPES, CORE_ROLES, formatCredits } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon } from '../ui/icons';
import { enterBuilding, focusBuilding, focusPoint, followCitizen, followVehicle } from './actions';
import { AgentSections } from './Life';

export function SelectionPanel() {
  const sel = useUI((s) => s.selection);
  const interior = useUI((s) => s.interior);
  if (!sel || (interior && sel.kind !== 'citizen')) return null;
  return (
    <aside className="sel-panel glass" data-testid="selection-panel">
      <button className="close" onClick={() => useUI.getState().select(null)} aria-label="Close">
        <Icon name="close" />
      </button>
      {sel.kind === 'building' && <BuildingPanel id={sel.id} />}
      {sel.kind === 'citizen' && <CitizenPanel id={sel.id} />}
      {sel.kind === 'district' && <DistrictPanel id={sel.id} />}
      {sel.kind === 'vehicle' && <VehiclePanel id={sel.id} />}
    </aside>
  );
}

function Row({ k, v, testid }: { k: string; v: React.ReactNode; testid?: string }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b data-testid={testid}>{v}</b>
    </div>
  );
}

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bar">
      <div className="bar__label">
        <span>{label}</span>
        <b>{Math.round(value * 100)}%</b>
      </div>
      <div className="bar__track">
        <span style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export function locationLabel(d: CitizenDynamic | undefined, buildings: Map<string, BuildingDef>, vehicles: { id: string; label: string }[]): string {
  if (!d) return '—';
  const l = d.location;
  if (l.kind === 'building') return buildings.get(l.id)?.name ?? l.id;
  if (l.kind === 'vehicle') return `In ${vehicles.find((v) => v.id === l.id)?.label ?? 'vehicle'}`;
  if (l.kind === 'stop') return 'Waiting at bus stop';
  const dest = d.destinationId ? buildings.get(d.destinationId)?.name : null;
  return dest ? `On the street → ${dest}` : 'On the street';
}

function BuildingPanel({ id }: { id: string }) {
  const b = useSim((s) => s.buildingsById.get(id));
  const dyn = useSim((s) => s.buildingDyn[id]);
  const occ = useSim((s) => (b ? s.state?.occupancy[b.index] : 0));
  const biz = useSim((s) => s.businessByBuilding.get(id));
  const district = useSim((s) => (b ? s.districtsById.get(b.districtId) : undefined));
  const allProjects = useSim((s) => s.projects);
  const tasks = useSim((s) => s.tasks);
  const projects = useMemo(
    () => allProjects.filter((p) => p.buildingId === id || p.tasks.some((tid) => tasks.get(tid)?.buildingId === id)),
    [allProjects, tasks, id],
  );
  if (!b) return null;
  const meta = BUILDING_TYPES[b.type];
  const active = projects.filter((p) => p.status === 'ACTIVE').length;
  const status = dyn?.status ?? (b.construction ? 'CONSTRUCTION' : 'ACTIVE');
  return (
    <>
      <div className="sel-panel__kicker" style={{ color: district?.color }}>
        {meta.label.toUpperCase()}
      </div>
      <h2 data-testid="panel-title">{b.name}</h2>
      <div className={`badge badge--${status.toLowerCase()}`}>{status}</div>
      <div className="rows">
        <Row k="Type" v={meta.label} />
        <Row k="District" v={district?.name ?? '—'} />
        <Row k="Building ID" v={<code>{b.id}</code>} />
        <Row k="Height" v={`${Math.round(b.height * 2)} m · ${b.floorCount} floors`} />
        {meta.category === 'residential' ? (
          <Row k="Residents present" v={`${occ ?? 0} / ${b.capacity}`} testid="occupants" />
        ) : (
          <Row k="Occupants" v={`${occ ?? 0} / ${b.capacity}`} testid="occupants" />
        )}
        {biz && biz.category !== 'housing' && <Row k="Employees" v={`${biz.employees.length} / ${biz.jobs}`} />}
        <Row k="Energy usage" v={`${Math.round((dyn?.energyUsage ?? 0) * 100)}%`} />
        <Row k="Active projects" v={active} />
        {biz && (biz.category === 'company' || biz.category === 'food' || biz.category === 'retail' || biz.category === 'finance' || biz.category === 'industry' || biz.category === 'service') && (
          <>
            <Row k="Operator" v={biz.name} />
            <Row k="Revenue today" v={<span title="Simulated credits">{formatCredits(biz.revenueToday)}</span>} />
            <Row k="Cash" v={formatCredits(biz.cash)} />
            {biz.inventoryCapacity > 0 && <Row k="Inventory" v={`${Math.round((100 * biz.inventory) / biz.inventoryCapacity)}%${biz.restockPending ? ' · delivery en route' : ''}`} />}
          </>
        )}
      </div>
      <p className="note">Economic values are simulated credits (§), not real money.</p>
      <div className="actions">
        <button onClick={() => focusBuilding(b.id)} data-testid="btn-focus">
          <Icon name="focus" /> FOCUS
        </button>
        <button disabled={!b.enterable} title={b.enterable ? 'Enter the building interior' : 'This building has no interior yet'} onClick={() => enterBuilding(b.id)} data-testid="btn-enter">
          <Icon name="door" /> ENTER BUILDING
        </button>
        <button onClick={() => useUI.getState().setPanel('projects')} data-testid="btn-projects">
          <Icon name="task" /> VIEW PROJECTS
        </button>
      </div>
    </>
  );
}

function CitizenPanel({ id }: { id: string }) {
  const p = useSim((s) => s.citizensById.get(id));
  const d = useSim((s) => (p ? s.state?.citizens[p.index] : undefined));
  const buildings = useSim((s) => s.buildingsById);
  const vehicles = useSim((s) => s.vehicles);
  const task = useSim((s) => (d?.currentTaskId ? s.tasks.get(d.currentTaskId) : undefined));
  const ai = useSim((s) => s.ai);
  if (!p) return null;
  return (
    <>
      <div className="sel-panel__kicker" style={{ color: p.role ? CORE_ROLES[p.role].color : p.agent ? '#f59e0b' : undefined }}>
        {p.agent ? `AGENT · ${p.agent.workforce ? 'JARVIS WORKFORCE' : 'INDEPENDENT'} · ${p.agent.calling.toUpperCase()}` : p.core ? 'CORE WORKFORCE CITIZEN' : 'RESIDENT'}
      </div>
      <h2 data-testid="panel-title">{p.name.toUpperCase()}</h2>
      <div className={`badge badge--${(d?.status ?? 'idle').toLowerCase()}`} data-testid="citizen-status">
        {d?.status ?? '—'}
      </div>
      {p.agent && <AgentSections key={p.id} p={p} />}
      <div className="rows">
        <Row k="Occupation" v={p.occupation} />
        <Row k="Location" v={locationLabel(d, buildings, vehicles)} testid="citizen-location" />
        <Row k="Current task" v={task ? `${task.title} (${Math.round(task.progress * 100)}%)` : '—'} />
        <Row k="Money" v={<span title="Simulated credits">{formatCredits(d?.money ?? 0)}</span>} />
        {p.core && <Row k="AI agent" v={p.agentId ? p.agentId : ai?.connected ? 'Available' : 'Not connected (simulated)'} />}
      </div>
      <Bar label="Energy" value={d?.energy ?? 0} color="linear-gradient(90deg,#22d3ee,#38bdf8)" />
      <Bar label="Happiness" value={d?.happiness ?? 0} color="linear-gradient(90deg,#a78bfa,#e879f9)" />
      <Bar label="Satiety" value={d?.satiety ?? 0} color="linear-gradient(90deg,#fbbf24,#fb923c)" />
      <div className="actions actions--row">
        <button onClick={() => followCitizen(p.id)} data-testid="btn-follow">
          <Icon name="walk" /> FOLLOW
        </button>
        <button onClick={() => useUI.getState().setPanel('profile')} data-testid="btn-profile">
          <Icon name="user" /> PROFILE
        </button>
        <button disabled={!task} title={task ? 'Open task' : 'No current task'} onClick={() => useUI.getState().setPanel('task')} data-testid="btn-task">
          <Icon name="task" /> TASK
        </button>
      </div>
      {!p.agent && <AgentSections key={p.id} p={p} />}
    </>
  );
}

function DistrictPanel({ id }: { id: string }) {
  const d = useSim((s) => s.districtsById.get(id));
  const world = useSim((s) => s.world);
  const citizens = useSim((s) => s.citizens);
  const occupancy = useSim((s) => s.state?.occupancy);
  if (!d || !world) return null;
  const inD = world.buildings.filter((b) => b.districtId === d.id);
  const residents = citizens.filter((c: CitizenProfile) => world.buildings.find((b) => b.id === c.homeId)?.districtId === d.id).length;
  const present = occupancy ? inD.reduce((a, b) => a + (occupancy[b.index] ?? 0), 0) : 0;
  const types = new Map<string, number>();
  for (const b of inD) types.set(BUILDING_TYPES[b.type].label, (types.get(BUILDING_TYPES[b.type].label) ?? 0) + 1);
  const named = inD.filter((b) => b.named);
  return (
    <>
      <div className="sel-panel__kicker" style={{ color: d.color }}>
        DISTRICT
      </div>
      <h2 data-testid="panel-title">{d.name.toUpperCase()}</h2>
      <p className="desc">{d.description}</p>
      <div className="rows">
        <Row k="Buildings" v={inD.length} />
        <Row k="Residents" v={residents} />
        <Row k="People inside now" v={present} />
        <Row k="Tallest" v={`${Math.round(Math.max(0, ...inD.map((b) => b.height)) * 2)} m`} />
      </div>
      <div className="tags">
        {[...types.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([t, n]) => (
            <span key={t} className="tag">
              {t} · {n}
            </span>
          ))}
      </div>
      {named.length > 0 && (
        <div className="list">
          {named.map((b) => (
            <button key={b.id} onClick={() => focusBuilding(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      )}
      <div className="actions">
        <button onClick={() => focusPoint(d.center.x, d.center.z, d.radius * 2.6 + 45)} data-testid="btn-focus">
          <Icon name="focus" /> FOCUS DISTRICT
        </button>
      </div>
    </>
  );
}

function VehiclePanel({ id }: { id: string }) {
  const v = useSim((s) => s.vehicles.find((x) => x.id === id));
  const d = useSim((s) => (v ? s.state?.vehicles[v.index] : undefined));
  const buildings = useSim((s) => s.buildingsById);
  const citizens = useSim((s) => s.citizensById);
  const lines = useSim((s) => s.world?.busLines);
  if (!v) return null;
  return (
    <>
      <div className="sel-panel__kicker">{v.kind.toUpperCase()}</div>
      <h2 data-testid="panel-title">{v.label}</h2>
      <div className={`badge badge--${(d?.status ?? 'idle').toLowerCase()}`}>{d?.status ?? '—'}</div>
      <div className="rows">
        {v.lineId && <Row k="Line" v={lines?.find((l) => l.id === v.lineId)?.name ?? v.lineId} />}
        <Row k="Speed" v={`${Math.round((d?.speed ?? 0) * 7.2)} km/h`} />
        <Row k="Destination" v={d?.destinationId ? buildings.get(d.destinationId)?.name ?? '—' : v.kind === 'bus' ? 'Loop service' : '—'} />
        <Row k="Passengers" v={d?.passengers.length ? d.passengers.map((p) => citizens.get(p)?.name ?? p).slice(0, 4).join(', ') + (d.passengers.length > 4 ? ` +${d.passengers.length - 4}` : '') : 'None'} />
        <Row k="Trips" v={d?.trips ?? 0} />
        <Row k="Odometer" v={`${((d?.odometer ?? 0) * 0.002).toFixed(2)} km`} />
      </div>
      <div className="actions">
        <button onClick={() => followVehicle(v.id)} data-testid="btn-follow">
          <Icon name="car" /> FOLLOW VEHICLE
        </button>
      </div>
    </>
  );
}
