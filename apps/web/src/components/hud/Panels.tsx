/** Clock & environment, settings, debug overlay, city story and save/load panels. */
import { useEffect, useState } from 'react';
import type { SaveSummary, WeatherKind } from '@morphis/shared';
import { SIM_SPEEDS, dayOf, daylight, formatClock, formatCredits, formatSimDateTime } from '@morphis/shared';
import { run } from '../../sim/commands';
import { simClient } from '../../sim/client';
import { perf } from '../../scene/perf';
import { useSim } from '../../state/simStore';
import { useUI, type DebugLayers } from '../../state/uiStore';
import { Icon } from '../ui/icons';
import { PanelHeader } from './Feeds';

export function ClockPanel() {
  const open = useUI((s) => s.panel === 'clock');
  const state = useSim((s) => s.state);
  if (!open || !state) return null;
  const t = state.clock.time;
  const dl = daylight(t);
  const phase = dl > 0.95 ? 'DAY' : dl < 0.05 ? 'NIGHT' : (t % 86400) / 3600 < 12 ? 'SUNRISE' : 'SUNSET';
  const weathers: (WeatherKind | 'auto')[] = ['auto', 'clear', 'rain', 'fog', 'storm'];
  return (
    <section className="side-panel glass" data-testid="clock-panel">
      <PanelHeader title="DAY / NIGHT & ENVIRONMENT" />
      <div className="clock-big">
        <strong>{formatClock(t)}</strong>
        <span>
          DAY {dayOf(t)} · {phase}
        </span>
      </div>
      <div className="dayline">
        <span style={{ left: `${(((t % 86400) / 86400) * 100).toFixed(2)}%` }} />
      </div>
      <label className="lbl">Simulation speed (1x = 1 sim minute per second)</label>
      <div className="speeds wide">
        <button className={state.clock.paused ? 'on' : ''} onClick={() => run({ type: 'sim.setPaused', paused: !state.clock.paused })}>
          {state.clock.paused ? 'PLAY' : 'PAUSE'}
        </button>
        {SIM_SPEEDS.map((s) => (
          <button key={s} className={state.clock.speed === s ? 'on' : ''} onClick={() => run({ type: 'sim.setSpeed', speed: s })}>
            {s}x
          </button>
        ))}
      </div>
      <label className="lbl">Fast-forward (the city lives through the skipped time)</label>
      <div className="speeds wide">
        {[1, 3, 6, 12].map((h) => (
          <button key={h} onClick={() => run({ type: 'sim.skip', hours: h }, `Skipped ${h}h`)} data-testid={`skip-${h}`}>
            +{h}h
          </button>
        ))}
      </div>
      <label className="lbl">
        Weather — currently <b className="cap">{state.weather.kind}</b> ({state.weather.manual ? 'manual' : 'simulated'})
      </label>
      <div className="speeds wide">
        {weathers.map((w) => (
          <button
            key={w}
            className={(w === 'auto' && !state.weather.manual) || (state.weather.manual && state.weather.target === w) ? 'on' : ''}
            onClick={() => run({ type: 'sim.setWeather', weather: w })}
            data-testid={`weather-${w}`}
          >
            {w.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="rows">
        <div className="row">
          <span>Power demand / supply</span>
          <b>
            {state.economy.resources.powerDemand} / {state.economy.resources.powerSupply} MW
          </b>
        </div>
        <div className="row">
          <span>Water demand / supply</span>
          <b>
            {state.economy.resources.waterDemand} / {state.economy.resources.waterSupply} ML
          </b>
        </div>
      </div>
    </section>
  );
}

export function SettingsPanel() {
  const open = useUI((s) => s.panel === 'settings');
  const q = useUI((s) => s.quality);
  const debug = useUI((s) => s.debug);
  const pins = useUI((s) => s.pins);
  const persistence = useSim((s) => s.persistence);
  const mode = useSim((s) => s.mode);
  const ai = useSim((s) => s.ai);
  if (!open) return null;
  const ui = useUI.getState();
  const Toggle = ({ label, on, set, id }: { label: string; on: boolean; set: (v: boolean) => void; id: string }) => (
    <label className="toggle" data-testid={id}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
  return (
    <section className="side-panel glass" data-testid="settings-panel">
      <PanelHeader title="SETTINGS" />
      <h4>Graphics</h4>
      <Toggle label="Bloom (neon glow)" on={q.bloom} set={(v) => ui.setQuality({ bloom: v })} id="set-bloom" />
      <Toggle label="Shadows" on={q.shadows} set={(v) => ui.setQuality({ shadows: v })} id="set-shadows" />
      <Toggle label="Ambient occlusion (slower)" on={q.ao} set={(v) => ui.setQuality({ ao: v })} id="set-ao" />
      <label className="lbl">Resolution scale: {q.pixelRatio.toFixed(1)}x</label>
      <input type="range" min={0.6} max={2} step={0.1} value={q.pixelRatio} onChange={(e) => ui.setQuality({ pixelRatio: Number(e.target.value) })} />
      <h4>Interface</h4>
      <Toggle label="District pins" on={pins} set={(v) => ui.setPins(v)} id="set-pins" />
      <Toggle label="Developer debug overlay" on={debug} set={(v) => ui.setDebug(v)} id="set-debug" />
      <h4>System</h4>
      <div className="rows">
        <div className="row">
          <span>Simulation authority</span>
          <b>{mode === 'server' ? 'Node.js server (authoritative)' : 'Browser worker (local mode)'}</b>
        </div>
        <div className="row">
          <span>Persistence</span>
          <b>{persistence?.backend ?? '—'}</b>
        </div>
        <div className="row">
          <span>AI provider</span>
          <b>{ai?.connected ? ai.provider : 'Not connected'}</b>
        </div>
      </div>
      <p className="note">{persistence?.detail}</p>
      <p className="note">{ai?.detail}</p>
    </section>
  );
}

export function DebugOverlay() {
  const debug = useUI((s) => s.debug);
  const layers = useUI((s) => s.debugLayers);
  const [, force] = useState(0);
  useEffect(() => {
    if (!debug) return;
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [debug]);
  if (!debug) return null;
  const sim = useSim.getState();
  const st = sim.state;
  const s = simClient.sampleMotion();
  let walkers = 0;
  let moving = 0;
  if (s) {
    for (const v of s.cVisible) walkers += v;
    for (const v of s.vVisible) moving += v;
  }
  const labels: Record<keyof DebugLayers, string> = { roads: 'Road graph', ped: 'Pedestrian paths', districts: 'District bounds', bounds: 'Building bounds', destinations: 'Citizen destinations', collision: 'Collision boundaries' };
  return (
    <section className="debug glass" data-testid="debug-overlay">
      <header>
        <Icon name="bug" /> DEBUG
        <button className="close" onClick={() => useUI.getState().setDebug(false)}>
          <Icon name="close" />
        </button>
      </header>
      <table>
        <tbody>
          <tr><td>FPS</td><td data-testid="dbg-fps">{perf.fps}</td></tr>
          <tr><td>Draw calls</td><td>{perf.calls}</td></tr>
          <tr><td>Triangles</td><td>{perf.triangles.toLocaleString()}</td></tr>
          <tr><td>Buildings</td><td>{sim.world?.buildings.length}</td></tr>
          <tr><td>Citizens</td><td>{sim.citizens.length} ({walkers} rendered walking)</td></tr>
          <tr><td>Vehicles</td><td>{sim.vehicles.length} ({moving} moving)</td></tr>
          <tr><td>Simulation tick</td><td>{st?.clock.tick.toLocaleString()}</td></tr>
          <tr><td>Sim time</td><td>{st ? formatSimDateTime(st.clock.time) : ''}</td></tr>
          <tr><td>Tick cost</td><td>{st?.perf.tickMs.toFixed(3)} ms · {st?.perf.ticksPerSecond} ticks/s</td></tr>
          <tr><td>Active paths</td><td>{st?.stats.activeRoutes} ({simClient.routes.size} cached)</td></tr>
          <tr><td>Events received</td><td>{simClient.eventsReceived.toLocaleString()}</td></tr>
          <tr><td>Transport</td><td>{sim.mode === 'server' ? 'WebSocket' : 'Worker'} · {sim.connection}</td></tr>
        </tbody>
      </table>
      <div className="debug__layers">
        {(Object.keys(labels) as (keyof DebugLayers)[]).map((k) => (
          <label key={k}>
            <input type="checkbox" checked={layers[k]} onChange={(e) => useUI.getState().setDebugLayer(k, e.target.checked)} data-testid={`dbg-${k}`} />
            {labels[k]}
          </label>
        ))}
      </div>
    </section>
  );
}

export function CityStory() {
  const open = useUI((s) => s.panel === 'story');
  const state = useSim((s) => s.state);
  const news = useSim((s) => s.news);
  const projects = useSim((s) => s.projects);
  if (!open || !state) return null;
  const hist = state.economy.history;
  const max = Math.max(1, ...hist.map((h) => h.gdp));
  const milestones = news.filter((n) => n.category === 'project' || n.category === 'economy' || n.category === 'event').slice(-12).reverse();
  return (
    <section className="side-panel glass story" data-testid="story-panel">
      <PanelHeader title="CITY STORY" />
      <p className="desc">
        Morphis is a compressed metropolis of {state.stats.population} simulated citizens. Every person has a home, a schedule and needs; every
        trip happens on the streets you see. Twenty-five core citizens form the city's workforce and run projects coordinated by JARVIS.
      </p>
      <div className="kpis">
        <div>
          <label>GDP today</label>
          <b>{formatCredits(state.economy.gdpToday)}</b>
        </div>
        <div>
          <label>Employed</label>
          <b>
            {state.economy.employed} <small>/ {state.economy.unemployed} seeking</small>
          </b>
        </div>
        <div>
          <label>Happiness</label>
          <b>{Math.round(state.economy.avgHappiness * 100)}%</b>
        </div>
        <div>
          <label>Projects done</label>
          <b>{projects.filter((p) => p.status === 'COMPLETED').length}</b>
        </div>
      </div>
      {hist.length > 0 && (
        <div className="spark" title="Daily city output (simulated credits)">
          {hist.map((h) => (
            <span key={h.day} style={{ height: `${(h.gdp / max) * 100}%` }} title={`Day ${h.day}: ${formatCredits(h.gdp)}`} />
          ))}
        </div>
      )}
      <h4>Timeline</h4>
      <ul className="news">
        {milestones.length === 0 && <li className="news__item">The story is just beginning — come back after the first working day.</li>}
        {milestones.map((n) => (
          <li key={n.id} className="news__item">
            <div>
              <b>{n.headline}</b>
              <small>
                Day {dayOf(n.time)} {formatClock(n.time)} · {n.body}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="note">All money in Morphis is simulated credits (§). Nothing here represents real-world earnings.</p>
    </section>
  );
}

export function SavesPanel() {
  const open = useUI((s) => s.panel === 'saves');
  const persistence = useSim((s) => s.persistence);
  const world = useSim((s) => s.world);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [name, setName] = useState('');
  const [seed, setSeed] = useState(2126);
  const [pop, setPop] = useState(400);
  const [busy, setBusy] = useState(false);
  const refresh = async () => setSaves((await run<SaveSummary[]>({ type: 'city.list' })) ?? []);
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  if (!open) return null;
  return (
    <section className="side-panel glass" data-testid="saves-panel">
      <PanelHeader title="SAVE · LOAD · NEW CITY" />
      <p className="note">Storage: {persistence?.detail}</p>
      <div className="form">
        <input placeholder="Save name" value={name} onChange={(e) => setName(e.target.value)} data-testid="save-name" />
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run({ type: 'city.save', name: name || undefined }, 'City saved');
            setBusy(false);
            void refresh();
          }}
          data-testid="btn-save"
        >
          SAVE CITY
        </button>
      </div>
      <ul className="saves">
        {saves.length === 0 && <li className="empty">No saves yet.</li>}
        {saves.map((s) => (
          <li key={s.id}>
            <div>
              <b>{s.name}</b>
              <small>
                {formatSimDateTime(s.simTime)} · seed {s.seed} · {s.population} citizens · {new Date(s.savedAt).toLocaleString()}
              </small>
            </div>
            <button
              onClick={async () => {
                setBusy(true);
                await run({ type: 'city.load', id: s.id }, `Loaded “${s.name}”`);
                setBusy(false);
              }}
              data-testid="btn-load"
            >
              LOAD
            </button>
            <button
              className="ghost"
              onClick={async () => {
                await run({ type: 'city.delete', id: s.id });
                void refresh();
              }}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <h4>New city</h4>
      <div className="form">
        <label>
          Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} data-testid="new-seed" />
        </label>
        <label>
          Population
          <select value={pop} onChange={(e) => setPop(Number(e.target.value))}>
            {[100, 250, 400, 800, 1500].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run({ type: 'city.new', seed, population: pop }, `New city generated (seed ${seed})`);
            setBusy(false);
          }}
          data-testid="btn-new"
        >
          NEW CITY
        </button>
      </div>
      <p className="note">Current world: seed {world?.seed} · hash {world?.hash}</p>
    </section>
  );
}
