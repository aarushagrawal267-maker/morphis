/** Top header, navigation tabs and the city information HUD. */
import { useState } from 'react';
import { sound } from '../../audio/engine';
import { SIM_SPEEDS, dayOf, formatClock, formatCredits, weekdayOf } from '@morphis/shared';
import { run } from '../../sim/commands';
import { focusDistrict } from '../../scene/districts/DistrictPins';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { Icon, Logo } from '../ui/icons';
import { HUD_CITY_NAME, HUD_TAGLINE, weekday } from '../ui/format';
import { focusBuilding } from '../panels/actions';
import { useGuest } from '../../state/guestStore';
import { rise, startWalk } from './GuestHud';

function SoundToggle() {
  const [on, setOn] = useState(sound.settings.enabled);
  return (
    <button
      className="icon-btn"
      title={on ? 'Sound on (click to mute)' : 'Sound off (click to unmute)'}
      onClick={() => {
        const next = !on;
        setOn(next);
        sound.setSettings({ ...sound.settings, enabled: next });
        if (next) sound.unlock();
      }}
      data-testid="btn-sound"
    >
      <Icon name={on ? 'sound' : 'mute'} />
    </button>
  );
}

export function TopHeader() {
  const pins = useUI((s) => s.pins);
  const panel = useUI((s) => s.panel);
  const clock = useSim((s) => s.state?.clock);
  const mode = useSim((s) => s.mode);
  const connection = useSim((s) => s.connection);
  const ai = useSim((s) => s.ai);
  const locked = useSim((s) => s.access.locked && !s.access.admin);
  const walking = useGuest((s) => s.active);
  const agents = useSim((s) => s.agents.length);
  const ui = useUI.getState();
  return (
    <header className="topbar glass" data-testid="top-header">
      <div className="brand">
        <Logo />
        <div>
          <div className="brand__name">{HUD_CITY_NAME}</div>
          <div className="brand__tag">{HUD_TAGLINE}</div>
        </div>
      </div>
      <div className="topbar__controls">
        <button className={`chip walk ${walking ? 'on' : ''}`} onClick={() => (walking ? rise() : startWalk())} data-testid="btn-walk" title={walking ? 'Rise back to the overview' : 'Walk the streets as a guest'}>
          <Icon name={walking ? 'rise' : 'walk'} /> {walking ? 'Rise' : 'Walk in'}
        </button>
        <button className={`chip ${panel === 'agents' ? 'on' : ''}`} onClick={() => ui.togglePanel('agents')} data-testid="btn-agents">
          <Icon name="user" /> Agents <span className="chip__state">{agents}</span>
        </button>
        <button className={`chip ${pins ? 'on' : ''}`} onClick={() => ui.setPins(!pins)} data-testid="toggle-pins">
          <Icon name="pin" /> District pins <span className="chip__state">{pins ? 'on' : 'off'}</span>
        </button>
        <button className={`chip ${panel === 'features' ? 'on' : ''}`} onClick={() => ui.togglePanel('features')} data-testid="btn-features">
          <Icon name="star" /> Key features
        </button>
        <button className={`chip ${panel === 'story' ? 'on' : ''}`} onClick={() => ui.togglePanel('story')} data-testid="btn-story">
          <Icon name="story" /> City story
        </button>
        <button className={`chip jarvis ${panel === 'jarvis' ? 'on' : ''}`} onClick={() => ui.togglePanel('jarvis')} data-testid="btn-jarvis">
          <Icon name="terminal" /> JARVIS
        </button>
        <div className="divider" />
        <button
          className="icon-btn play"
          disabled={locked}
          title={locked ? 'Only the host can pause this town' : clock?.paused ? 'Play' : 'Pause'}
          onClick={() => run({ type: 'sim.setPaused', paused: !clock?.paused })}
          data-testid="btn-pause"
        >
          <Icon name={clock?.paused ? 'play' : 'pause'} />
        </button>
        <div className="speeds" role="group" aria-label="Simulation speed">
          {SIM_SPEEDS.map((s) => (
            <button key={s} disabled={locked} title={locked ? 'Only the host can change the speed' : undefined} className={clock?.speed === s ? 'on' : ''} onClick={() => run({ type: 'sim.setSpeed', speed: s })} data-testid={`speed-${s}`}>
              {s}x
            </button>
          ))}
        </div>
        <div className="divider" />
        <button className={`icon-btn ${panel === 'saves' ? 'on' : ''}`} title="Save / load city" onClick={() => ui.togglePanel('saves')} data-testid="btn-saves">
          <Icon name="save" />
        </button>
        <SoundToggle />
        <button className={`icon-btn ${panel === 'settings' ? 'on' : ''}`} title="Settings" onClick={() => ui.togglePanel('settings')} data-testid="btn-settings">
          <Icon name="gear" />
        </button>
        <span className={`conn conn--${connection}`} title={`Simulation authority: ${mode === 'server' ? 'Node.js server' : 'in-browser worker'} (${connection})`}>
          {mode === 'server' ? 'Server' : 'Local sim'}
        </span>
        <span className={`conn ${ai?.connected ? 'conn--connected' : 'conn--sim'}`} title={ai?.connected ? `${ai.provider} — ${ai.detail}` : ai?.detail} data-testid="ai-badge">
          {ai?.connected ? 'AI · live' : 'AI · simulated'}
        </span>
      </div>
    </header>
  );
}

const TABS = [
  { id: 'overview', label: 'City overview' },
  { id: 'complex', label: 'The Complex' },
  { id: 'institute', label: 'The Institute' },
  { id: 'apartments', label: 'Apartments' },
  { id: 'research', label: 'Research lab' },
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
          Districts <Icon name="chevron" size={12} />
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
      <div className="cityinfo__name">{HUD_CITY_NAME}</div>
      <div className="cityinfo__time">
        <span>
          Day {dayOf(t)} · {weekday(weekdayOf(t))}
        </span>
        <strong data-testid="clock">{formatClock(t)}</strong>
      </div>
      <div className="cityinfo__grid">
        <div>
          <label>Population</label>
          <b>{st.population.toLocaleString()}</b>
        </div>
        <div>
          <label>Active citizens</label>
          <b>{st.activeCitizens.toLocaleString()}</b>
        </div>
        <div>
          <label>Weather</label>
          <b className="cap">
            <Icon name={w.kind === 'clear' ? 'sun' : w.kind} size={13} /> {w.kind}
          </b>
        </div>
        <div>
          <label>City budget</label>
          <b title="Simulated credits — fictional">{formatCredits(state.economy.cityBudget)}</b>
        </div>
      </div>
      <div className={`cityinfo__status ${statusTone}`} data-testid="city-status">
        <span className="status-dot" />
        <span>
          City status · <span className="enum">{st.status}</span>
        </span>
      </div>
    </section>
  );
}
