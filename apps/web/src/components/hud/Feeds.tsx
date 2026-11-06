/** Agent activity stream, city news / events feed, key features panel, bottom feature bar and toasts. */
import { useEffect, useMemo, useState } from 'react';
import { CORE_ROLES, formatClock, formatCredits } from '@morphis/shared';
import { useSim } from '../../state/simStore';
import { useUI, type Highlight } from '../../state/uiStore';
import { Icon } from '../ui/icons';
import { focusBuilding, focusCitizen, focusPoint } from '../panels/actions';

export function AgentStream() {
  const activity = useSim((s) => s.activity);
  const citizens = useSim((s) => s.citizensById);
  const ai = useSim((s) => s.ai);
  const [collapsed, setCollapsed] = useState(false);
  const items = activity.slice(-6).reverse();
  return (
    <section className={`stream glass ${collapsed ? 'collapsed' : ''}`} data-testid="agent-stream">
      <header onClick={() => setCollapsed((c) => !c)}>
        <span className="live" /> AGENT STREAM
        <small>{ai?.connected ? 'live AI agents' : 'simulated workforce'}</small>
      </header>
      {!collapsed && (
        <ul>
          {items.length === 0 && <li className="empty">Waiting for the workforce to start the day…</li>}
          {items.map((a) => {
            const p = citizens.get(a.citizenId);
            const color = p?.role ? CORE_ROLES[p.role].color : '#94a3b8';
            return (
              <li key={a.id} onClick={() => (a.buildingId && a.kind !== 'travel' ? focusBuilding(a.buildingId) : focusCitizen(a.citizenId))}>
                <span className="avatar" style={{ borderColor: color, color }}>
                  {p?.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)}
                </span>
                <div>
                  <div className="who">
                    {p?.name} <em>{p?.role ? CORE_ROLES[p.role].label : ''}</em>
                    <time>{formatClock(a.time)}</time>
                  </div>
                  <div className="what">“{a.text}”</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const CAT_ICON: Record<string, string> = { traffic: 'car', weather: 'cloud', economy: 'bank', event: 'music', infrastructure: 'bolt', project: 'task', city: 'core', transit: 'bus' };

export function NewsFeed() {
  const open = useUI((s) => s.panel === 'news');
  const news = useSim((s) => s.news);
  const events = useSim((s) => s.cityEvents);
  const buildings = useSim((s) => s.buildingsById);
  if (!open) return null;
  const upcoming = events.filter((e) => e.status !== 'ENDED').sort((a, b) => a.start - b.start);
  return (
    <section className="side-panel glass" data-testid="news-panel">
      <PanelHeader title="CITY EVENTS & NEWS" />
      {upcoming.length > 0 && (
        <div className="events">
          {upcoming.map((e) => (
            <button key={e.id} className={`event event--${e.status.toLowerCase()}`} onClick={() => focusBuilding(e.buildingId)}>
              <span className="event__status">{e.status}</span>
              <b>{e.name}</b>
              <small>
                {buildings.get(e.buildingId)?.name} · {formatClock(e.start)}–{formatClock(e.end)}
                {e.status === 'LIVE' ? ` · ${e.attendees} attending` : ''}
              </small>
            </button>
          ))}
        </div>
      )}
      <ul className="news">
        {news
          .slice()
          .reverse()
          .slice(0, 40)
          .map((n) => (
            <li
              key={n.id}
              className={`news__item sev-${n.severity}`}
              onClick={() => {
                if (n.buildingId) focusBuilding(n.buildingId);
                else if (n.location) focusPoint(n.location.x, n.location.z, 50);
              }}
            >
              <Icon name={CAT_ICON[n.category] ?? 'bell'} size={14} />
              <div>
                <b>{n.headline}</b>
                <small>
                  {formatClock(n.time)} · {n.body}
                </small>
              </div>
            </li>
          ))}
      </ul>
    </section>
  );
}

export function PanelHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <header className="panel-head">
      <span>{title}</span>
      <button className="close" onClick={onClose ?? (() => useUI.getState().setPanel(null))} aria-label="Close">
        <Icon name="close" />
      </button>
    </header>
  );
}

export function KeyFeatures() {
  const open = useUI((s) => s.panel === 'features');
  const state = useSim((s) => s.state);
  const world = useSim((s) => s.world);
  const projects = useSim((s) => s.projects);
  const events = useSim((s) => s.cityEvents);
  const vehicles = useSim((s) => s.vehicles);
  if (!open || !state || !world) return null;
  const ui = useUI.getState();
  const st = state.stats;
  const enterable = world.buildings.filter((b) => b.enterable).length;
  const items: { icon: string; label: string; value: string; action: () => void }[] = [
    { icon: 'layers', label: '3D Interactive City', value: `${world.buildings.length} buildings · ${world.roads.edges.length} road segments`, action: () => ui.requestCamera({ kind: 'overview' }, 'overview') },
    { icon: 'walk', label: 'Citizens', value: `${st.population} residents · ${st.walking} walking`, action: () => ui.setHighlight('pedestrians') },
    { icon: 'briefcase', label: 'Departments', value: `25 core roles · ${projects.filter((p) => p.status === 'ACTIVE').length} active projects`, action: () => ui.setPanel('jarvis') },
    { icon: 'home', label: 'Apartments', value: `${world.buildings.filter((b) => b.type === 'apartment' || b.type === 'luxury_apartment').length} residential buildings`, action: () => ui.setTab('apartments') },
    { icon: 'flask', label: 'Research Labs', value: `${world.buildings.filter((b) => b.type === 'research_lab' || b.type === 'ai_lab').length} labs`, action: () => ui.setHighlight('clickable') },
    { icon: 'book', label: 'University', value: 'Morphis University · enterable', action: () => { const u = world.buildings.find((b) => b.type === 'university'); if (u) focusBuilding(u.id); } },
    { icon: 'bus', label: 'Public Transport', value: `${world.busLines.length} bus lines · ${world.busStops.length} stops · ${state.economy.transitRidersToday} riders today`, action: () => ui.setHighlight('transport') },
    { icon: 'sun', label: 'Day/Night Cycle', value: `Sim clock ${formatClock(state.clock.time)} · ${state.clock.speed}x`, action: () => ui.setPanel('clock') },
    { icon: state.weather.kind === 'clear' ? 'sun' : state.weather.kind, label: 'Weather', value: `${state.weather.kind} · surfaces ${Math.round(state.weather.wetness * 100)}% wet`, action: () => ui.setPanel('clock') },
    { icon: 'bolt', label: 'Real-Time Simulation', value: `${state.perf.ticksPerSecond} ticks/s · ${st.vehiclesMoving}/${vehicles.length} vehicles moving`, action: () => ui.setDebug(true) },
    { icon: 'bank', label: 'Economy', value: `GDP today ${formatCredits(state.economy.gdpToday)} · ${state.economy.employed} employed`, action: () => ui.setPanel('story') },
    { icon: 'music', label: 'City Events', value: `${events.filter((e) => e.status === 'LIVE').length} live · ${events.filter((e) => e.status === 'SCHEDULED').length} scheduled`, action: () => ui.setPanel('news') },
    { icon: 'door', label: 'Buildings', value: `${enterable} enterable interiors`, action: () => ui.setHighlight('enterable') },
  ];
  return (
    <section className="side-panel glass features" data-testid="features-panel">
      <PanelHeader title="KEY FEATURES" />
      <ul>
        {items.map((it) => (
          <li key={it.label}>
            <button onClick={it.action}>
              <span className="fi">
                <Icon name={it.icon} />
              </span>
              <span>
                <b>{it.label}</b>
                <small>{it.value}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BottomBar() {
  const highlight = useUI((s) => s.highlight);
  const panel = useUI((s) => s.panel);
  const walking = useSim((s) => s.state?.stats.walking ?? 0);
  const moving = useSim((s) => s.state?.stats.vehiclesMoving ?? 0);
  const ui = useUI.getState();
  const toggle = (h: Highlight, msg: string) => {
    ui.setHighlight(h);
    if (useUI.getState().highlight === h) ui.notify(msg);
  };
  const items = [
    { id: 'walk', icon: 'walk', label: 'CITIZENS WALKING', on: highlight === 'pedestrians', act: () => toggle('pedestrians', `${walking} citizens walking right now — highlighted`) },
    { id: 'interior', icon: 'door', label: 'INTERIOR VIEWS', on: highlight === 'enterable', act: () => toggle('enterable', 'Enterable buildings highlighted — click one, then ENTER BUILDING') },
    { id: 'transport', icon: 'bus', label: 'VEHICLES & TRANSPORT', on: highlight === 'transport', act: () => toggle('transport', `${moving} vehicles moving · bus lines shown`) },
    { id: 'daynight', icon: 'sun', label: 'DAY / NIGHT CYCLE', on: panel === 'clock', act: () => ui.togglePanel('clock') },
    { id: 'clickable', icon: 'cursor', label: 'CLICKABLE BUILDINGS', on: highlight === 'clickable', act: () => toggle('clickable', 'Building selection mode — click any highlighted building') },
    { id: 'events', icon: 'bell', label: 'CITY EVENTS', on: panel === 'news', act: () => ui.togglePanel('news') },
  ];
  return (
    <footer className="bottombar glass" data-testid="bottom-bar">
      {items.map((i) => (
        <button key={i.id} className={i.on ? 'on' : ''} onClick={i.act} data-testid={`bb-${i.id}`}>
          <Icon name={i.icon} size={18} />
          <span>{i.label}</span>
        </button>
      ))}
    </footer>
  );
}

export function Toasts() {
  const toast = useUI((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const tone = useMemo(() => toast?.tone ?? 'info', [toast]);
  if (!toast || !visible) return null;
  return (
    <div className={`toast toast--${tone}`} role="status" data-testid="toast">
      {toast.text}
    </div>
  );
}
