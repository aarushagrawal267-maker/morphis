/** Top header, navigation tabs and the city information HUD. */
import { useState } from 'react';
import { CITY_NAME, CITY_TAGLINE, SIM_SPEEDS, WEEKDAYS, dayOf, formatClock, formatCredits, weekdayOf } from '@morphis/shared';
import { run } from '../../sim/commands';
import { focusDistrict } from '../../scene/districts/DistrictPins';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon, Logo } from '../ui/icons';
import { focusBuilding } from '../panels/actions';

export function TopHeader() {
  const pins = useUI((s) => s.pins);
  const panel = useUI((s) => s.panel);
  const clock = useSim((s) => s.state?.clock);
  const mode = useSim((s) => s.mode);
  const connection = useSim((s) => s.connection);
  const ai = useSim((s) => s.ai);
  const ui = useUI.getState();
  return (
    <header className="topbar glass" data-testid="top-header">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand__name">{CITY_NAME}</div>
          <div className="brand__tag">{CITY_TAGLINE}</div>
        </div>
      </div>
      <div className="topbar__controls">
        <button className={`chip ${pins ? 'on' : ''}`} onClick={() => ui.setPins(!pins)} data-testid="toggle-pins">
          <Icon name="pin" /> DISTRICT PINS <span className="chip__state">{pins ? 'ON' : 'OFF'}</span>
        </button>
        <button className={`chip ${panel === 'features' ? 'on' : ''}`} onClick={() => ui.togglePanel('features')} data-testid="btn-features">
          <Icon name="star" /> KEY FEATURES
        </button>
        <button className={`chip ${panel === 'story' ? 'on' : ''}`} onClick={() => ui.togglePanel('story')} data-testid="btn-story">
          <Icon name="story" /> CITY STORY
        </button>
        <button className={`chip jarvis ${panel === 'jarvis' ? 'on' : ''}`} onClick={() => ui.togglePanel('jarvis')} data-testid="btn-jarvis">
          <Icon name="terminal" /> JARVIS
        </button>
        <div className="divider" />
        <button
          className="icon-btn play"
          title={clock?.paused ? 'Play' : 'Pause'}
          onClick={() => run({ type: 'sim.setPaused', paused: !clock?.paused })}
          data-testid="btn-pause"
        >
          <Icon name={clock?.paused ? 'play' : 'pause'} />
        </button>
        <div className="speeds" role="group" aria-label="Simulation speed">
          {SIM_SPEEDS.map((s) => (
            <button key={s} className={clock?.speed === s ? 'on' : ''} onClick={() => run({ type: 'sim.setSpeed', speed: s })} data-testid={`speed-${s}`}>
              {s}x
            </button>
          ))}
        </div>
        <div className="divider" />
        <button className={`icon-btn ${panel === 'saves' ? 'on' : ''}`} title="Save / load city" onClick={() => ui.togglePanel('saves')} data-testid="btn-saves">
          <Icon name="save" />
        </button>
        <button className={`icon-btn ${panel === 'settings' ? 'on' : ''}`} title="Settings" onClick={() => ui.togglePanel('settings')} data-testid="btn-settings">
          <Icon name="gear" />
        </button>
        <span className={`conn conn--${connection}`} title={`Simulation authority: ${mode === 'server' ? 'Node.js server' : 'in-browser worker'} (${connection})`}>
          {mode === 'server' ? 'SERVER' : 'LOCAL SIM'}
        </span>
        <span className={`conn ${ai?.connected ? 'conn--connected' : 'conn--sim'}`} title={ai?.connected ? `${ai.provider} — ${ai.detail}` : ai?.detail} data-testid="ai-badge">
          {ai?.connected ? 'AI · LIVE' : 'AI · SIMULATED'}
        </span>
      </div>
    </header>
  );
}

const TABS = [
  { id: 'overview', label: 'CITY OVERVIEW' },
  { id: 'complex', label: 'THE COMPLEX' },
  { id: 'institute', label: 'THE INSTITUTE' },
  { id: 'apartments', label: 'APARTMENTS' },
  { id: 'research', label: 'RESEARCH LAB' },
] as const;

export function NavBar() {
  const tab = useUI((s) => s.activeTab);
  const world = useSim((s) => s.world);
  const [open, setOpen] = useState(false);
  if (!world) return null;
  const go = (id: string) => {
    const ui = useUI.getState();
    ui.setTab(id);
    setOpen(false);
    const byType = (t: string) => world.buildings.find((b) => b.type === t);
    switch (id) {
      case 'overview':
        ui.select(null);
        ui.requestCamera({ kind: 'overview' }, 'overview');
        break;
      case 'complex': {
        const hq = world.buildings.find((b) => b.id === world.hqId);
        if (hq) focusBuilding(hq.id);
        break;
      }
      case 'institute': {
        const u = byType('university');
        if (u) focusBuilding(u.id);
        break;
      }
      case 'apartments': {
        const d = world.districts.find((x) => x.type === 'residential');
        if (d) focusDistrict(d);
        break;
      }
      case 'research': {
        const lab = byType('ai_lab');
        if (lab) focusBuilding(lab.id);
        break;
      }
    }
  };
  return (
    <nav className="navbar glass" data-testid="navbar">
      {TABS.map((t) => (
        <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} data-testid={`tab-${t.id}`}>
          {t.label}
        </button>
      ))}
      <div className="nav-dropdown">
        <button className={tab === 'districts' ? 'on' : ''} onClick={() => setOpen((o) => !o)} data-testid="tab-districts">
          DISTRICTS ▾
        </button>
        {open && (
          <div className="dropdown glass">
            {world.districts.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  useUI.getState().setTab('districts');
                  setOpen(false);
                  focusDistrict(d);
                }}
              >
                <span className="dot" style={{ background: d.color }} />
                {d.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

export function CityInfo() {
  const state = useSim((s) => s.state);
  if (!state) return null;
  const t = state.clock.time;
  const w = state.weather;
  const st = state.stats;
  const statusTone = st.status === 'NORMAL' ? 'ok' : st.status === 'BUSY' ? 'busy' : 'warn';
  return (
    <section className="cityinfo glass" data-testid="city-info">
      <div className="cityinfo__name">{CITY_NAME}</div>
      <div className="cityinfo__time">
        <span>
          DAY {dayOf(t)} · {WEEKDAYS[weekdayOf(t)]}
        </span>
        <strong data-testid="clock">{formatClock(t)}</strong>
      </div>
      <div className="cityinfo__grid">
        <div>
          <label>POPULATION</label>
          <b>{st.population.toLocaleString()}</b>
        </div>
        <div>
          <label>ACTIVE CITIZENS</label>
          <b>{st.activeCitizens.toLocaleString()}</b>
        </div>
        <div>
          <label>WEATHER</label>
          <b className="cap">
            <Icon name={w.kind === 'clear' ? 'sun' : w.kind} size={13} /> {w.kind}
          </b>
        </div>
        <div>
          <label>CITY BUDGET</label>
          <b title="Simulated credits — fictional">{formatCredits(state.economy.cityBudget)}</b>
        </div>
      </div>
      <div className={`cityinfo__status ${statusTone}`} data-testid="city-status">
        <span className="pulse" /> CITY STATUS · {st.status}
      </div>
    </section>
  );
}
