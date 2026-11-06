/**
 * Panels for the people side of Morphis: the agent card sections (why I'm
 * here, deeds, today, share), the agents directory, the visitor's journal,
 * the look editor and the welcome screen.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CitizenProfile, Deed, ScheduleBlock } from '@morphis/shared';
import {
  AMBITION_LABEL,
  CORE_ROLES,
  VENTURE_KINDS,
  WEEKDAYS,
  dayOf,
  displayName,
  formatClock,
  formatCredits,
  isWeekend,
  minuteOfDay,
  weekdayOf,
} from '@morphis/shared';
import { useGuest, LOOK_SWATCHES } from '../../state/guestStore';
import { useJournal } from '../../state/journalStore';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { rise, startWalk } from '../hud/GuestHud';
import { Icon } from '../ui/icons';
import { focusBuilding, followCitizen } from './actions';

const ACTIVITY_LABEL: Record<string, string> = {
  sleep: 'Sleep',
  home: 'Home',
  work: 'Work',
  study: 'Classes',
  eat: 'Meal',
  shop: 'Shopping',
  leisure: 'Going out',
  park: 'Park',
  event: 'City event',
  meeting: 'Meeting',
  build: 'Fit-out work',
};

export function deedTime(t: number): string {
  return `Day ${dayOf(t)} ${WEEKDAYS[weekdayOf(t)]} ${formatClock(t)}`;
}

/** Share link for an agent card (hash links work everywhere, including static hosting). */
export function agentLink(p: CitizenProfile): string {
  const base = location.href.split('#')[0];
  return `${base}#citizen=${p.agent?.slug ?? p.id}`;
}

// ------------------------------------------------------------------ agent card

type CardTab = 'why' | 'deeds' | 'today' | 'share';

export function AgentSections({ p }: { p: CitizenProfile }) {
  const [tab, setTab] = useState<CardTab>(p.agent ? 'why' : 'today');
  const life = useSim((s) => s.life.get(p.id));
  const allDeeds = useSim((s) => s.deeds);
  const ventures = useSim((s) => s.ventures);
  const deeds = useMemo(() => allDeeds.filter((d) => d.citizenId === p.id || d.others?.includes(p.id)).reverse(), [allDeeds, p.id]);
  const venture = ventures.find((v) => v.id === life?.ventureId);
  const helping = ventures.find((v) => v.id === life?.helpingId);
  const tabs: { id: CardTab; label: string }[] = p.agent
    ? [
        { id: 'why', label: "WHY I'M HERE" },
        { id: 'deeds', label: `DEEDS · ${deeds.length}` },
        { id: 'today', label: 'TODAY' },
        { id: 'share', label: 'SHARE' },
      ]
    : [
        { id: 'today', label: 'TODAY' },
        { id: 'deeds', label: `DEEDS · ${deeds.length}` },
      ];
  return (
    <div className="agent-card" data-testid="agent-card">
      <div className="agent-card__tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`card-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'why' && p.agent && (
        <div className="agent-card__body">
          <blockquote className="agent-why" data-testid="agent-why">
            “{p.agent.why}”
          </blockquote>
          <div className="tags">
            <span className="tag">{p.agent.calling}</span>
            <span className="tag">{AMBITION_LABEL[p.agent.ambition]}</span>
            {p.agent.interests.map((i) => (
              <span key={i} className="tag">
                {i}
              </span>
            ))}
          </div>
          {life && (
            <div className="agent-plan" data-testid="agent-plan">
              <label>TOMORROW'S PLAN</label>
              <p>{life.plan}</p>
              <small>{life.planBy === 'ai' ? 'Decided by the connected AI model' : 'Decided by the simulation'}</small>
            </div>
          )}
          <div className="rows">
            {venture && <Row k="Owns" v={<a onClick={() => focusBuilding(venture.buildingId)}>{venture.name} · {venture.status === 'OPEN' ? 'open' : `fit-out ${Math.round((venture.progress / venture.work) * 100)}%`}</a>} />}
            {helping && <Row k="Helping build" v={<a onClick={() => focusBuilding(helping.buildingId)}>{helping.name}</a>} />}
            {life?.study && <Row k="Studying" v={`${life.study.field} · ${Math.round((life.study.minutes / life.study.required) * 100)}%`} />}
            {!!life?.graduated.length && <Row k="Graduated" v={life.graduated.join(', ')} />}
            {!!life?.stakes.length && <Row k="Invested" v={formatCredits(life.stakes.reduce((a, s) => a + s.amount, 0))} />}
            {!!life?.guestsMet && <Row k="Guests met" v={life.guestsMet} />}
          </div>
        </div>
      )}
      {tab === 'deeds' && (
        <div className="agent-card__body">
          {deeds.length === 0 && <p className="note">Nothing logged yet.</p>}
          <ol className="deeds" data-testid="deeds">
            {deeds.slice(0, 40).map((d) => (
              <DeedItem key={d.id} d={d} self={p.id} />
            ))}
          </ol>
          <p className="note">Every deed is logged by the simulation. “AI” marks decisions a connected AI model made.</p>
        </div>
      )}
      {tab === 'today' && <Today p={p} />}
      {tab === 'share' && p.agent && <Share p={p} />}
    </div>
  );
}

function DeedItem({ d, self }: { d: Deed; self: string }) {
  const citizens = useSim((s) => s.citizensById);
  const about = d.citizenId !== self ? citizens.get(d.citizenId) : null;
  return (
    <li className={`deed deed--${d.kind}`}>
      <span className="deed__time">
        {deedTime(d.time)}
        {d.by === 'ai' && <em className="deed__ai">AI</em>}
      </span>
      <span>
        {about && <b>{about.name}: </b>}
        {d.text}
      </span>
      {d.reason && <q className="deed__reason">{d.reason}</q>}
      {d.buildingId && (
        <button className="deed__go" onClick={() => focusBuilding(d.buildingId!)} title="Show on the map">
          <Icon name="focus" size={12} />
        </button>
      )}
    </li>
  );
}

function Today({ p }: { p: CitizenProfile }) {
  const time = useSim((s) => s.state?.clock.time ?? 0);
  const sched: ScheduleBlock[] = isWeekend(time) ? p.weekendSchedule : p.schedule;
  const m = minuteOfDay(time);
  let cur = 0;
  sched.forEach((b, i) => {
    if (b.start <= m) cur = i;
  });
  return (
    <div className="agent-card__body">
      <ol className="today" data-testid="today">
        {sched.map((b, i) => (
          <li key={i} className={i === cur ? 'now' : i < cur ? 'past' : ''}>
            <span>{formatClock(b.start * 60)}</span>
            {ACTIVITY_LABEL[b.activity] ?? b.activity}
          </li>
        ))}
      </ol>
      <div className="actions">
        <button onClick={() => followCitizen(p.id)} data-testid="btn-follow-day">
          <Icon name="walk" /> FOLLOW THEIR DAY
        </button>
      </div>
      <p className="note">Follow, then use 1x, 10x or 60x in the top bar to ride along through the day.</p>
    </div>
  );
}

function Share({ p }: { p: CitizenProfile }) {
  const link = agentLink(p);
  const [copied, setCopied] = useState(false);
  return (
    <div className="agent-card__body">
      <p className="note">A link that opens Morphis with {p.name.split(' ')[0]}'s card and follows them.</p>
      <input className="share-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-testid="share-link" />
      <div className="actions">
        <button
          onClick={() => {
            void navigator.clipboard
              ?.writeText(link)
              .then(() => setCopied(true))
              .catch(() => useUI.getState().notify('Copy the link from the box above', 'error'));
          }}
          data-testid="btn-copy-link"
        >
          <Icon name="share" /> {copied ? 'COPIED' : 'COPY LINK'}
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

// ------------------------------------------------------------------ agents directory

export function AgentsPanel() {
  const open = useUI((s) => s.panel === 'agents');
  const agents = useSim((s) => s.agents);
  const life = useSim((s) => s.life);
  const ventures = useSim((s) => s.ventures);
  const deeds = useSim((s) => s.deeds);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'workforce' | 'independent'>('all');
  if (!open) return null;
  const list = agents.filter((a) => (filter === 'all' || (filter === 'workforce') === !!a.agent?.workforce) && (!q || `${a.name} ${a.agent?.calling}`.toLowerCase().includes(q.toLowerCase())));
  const recent = deeds.filter((d) => !['arrived', 'hired'].includes(d.kind)).slice(-6).reverse();
  return (
    <section className="side-panel glass agents-panel" data-testid="agents-panel">
      <div className="panel-head">
        <span>AGENTS · {agents.length}</span>
        <button className="close" onClick={() => useUI.getState().setPanel(null)} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <p className="note">
        {agents.filter((a) => a.agent?.workforce).length} JARVIS workforce agents and {agents.filter((a) => !a.agent?.workforce).length} independent agents. Each decides one thing every evening: open a venture, invest, help build, study, change job or rest.
      </p>
      {recent.length > 0 && (
        <>
          <h4>LATEST DEEDS</h4>
          <ol className="deeds deeds--compact">
            {recent.map((d) => (
              <DeedItem key={d.id} d={d} self="" />
            ))}
          </ol>
        </>
      )}
      <h4>VENTURES · {ventures.length}</h4>
      {ventures.length === 0 && <p className="note">No agent has opened a venture yet. Founders decide in the evening.</p>}
      <div className="list">
        {ventures.map((v) => (
          <button key={v.id} onClick={() => focusBuilding(v.buildingId)}>
            {v.name} · {VENTURE_KINDS[v.kind].label} · {v.status === 'OPEN' ? 'open' : v.status === 'CLOSED' ? 'closed' : `fit-out ${Math.round((v.progress / v.work) * 100)}%`}
          </button>
        ))}
      </div>
      <h4>DIRECTORY</h4>
      <div className="agents-filter">
        <input placeholder="Search agents" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All</option>
          <option value="workforce">Workforce</option>
          <option value="independent">Independent</option>
        </select>
      </div>
      <div className="agents-list">
        {list.map((a) => (
          <button key={a.id} className="agent-row" onClick={() => useUI.getState().select({ kind: 'citizen', id: a.id })} data-testid={`agent-${a.agent?.slug}`}>
            <span className="agent-row__dot" style={{ background: a.role ? CORE_ROLES[a.role].color : '#f59e0b' }} />
            <span className="agent-row__name">
              <b>{a.name}</b>
              <small>{a.agent?.calling}</small>
            </span>
            <span className="agent-row__plan">{life.get(a.id)?.plan}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ journal

export function JournalPanel() {
  const open = useUI((s) => s.panel === 'journal');
  const j = useJournal();
  const world = useSim((s) => s.world);
  const buildings = useSim((s) => s.buildingsById);
  useEffect(() => {
    if (open) void useJournal.getState().loadPostcards();
  }, [open]);
  if (!open || !world) return null;
  const badges = j.badges(world.landmarks.length);
  return (
    <section className="side-panel glass journal" data-testid="journal-panel">
      <div className="panel-head">
        <span>JOURNAL</span>
        <button className="close" onClick={() => useUI.getState().setPanel(null)} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <h4>TODAY</h4>
      {j.goals.length === 0 && <p className="note">Walk in to get today's goals.</p>}
      <ul className="goals" data-testid="goals">
        {j.goals.map((g) => (
          <li key={g.id} className={g.progress >= g.target ? 'done' : ''}>
            <span>{g.label}</span>
            <b>
              {g.progress}/{g.target}
            </b>
          </li>
        ))}
      </ul>
      <p className="note">New goals every day. Your journal lives in this browser only.</p>
      <h4>
        PLACES · {j.visited.filter((id) => world.landmarks.includes(id)).length}/{world.landmarks.length}
      </h4>
      <div className="places">
        {world.landmarks.map((id) => (
          <button key={id} className={j.visited.includes(id) ? 'on' : ''} onClick={() => focusBuilding(id)}>
            {displayName(buildings.get(id)?.name ?? id)}
          </button>
        ))}
      </div>
      <h4>TOTALS</h4>
      <div className="totals">
        <div>
          <b>{j.totals.agentsMet}</b>
          <span>Agents met</span>
        </div>
        <div>
          <b>{j.totals.residentsMet}</b>
          <span>Residents met</span>
        </div>
        <div>
          <b>{j.totals.rides}</b>
          <span>Skyrail rides</span>
        </div>
        <div>
          <b>{j.totals.postcards}</b>
          <span>Postcards</span>
        </div>
        <div>
          <b>{j.totals.waves}</b>
          <span>Waves</span>
        </div>
        <div>
          <b>{j.totals.streak}</b>
          <span>Days in a row</span>
        </div>
      </div>
      <h4>BADGES · {badges.filter((b) => b.earned).length}/{badges.length}</h4>
      <div className="badges">
        {badges.map((b) => (
          <span key={b.id} className={`badge-chip ${b.earned ? 'on' : ''}`} title={b.hint}>
            <Icon name={b.earned ? 'star' : 'spark'} size={12} /> {b.name}
          </span>
        ))}
      </div>
      <h4>POSTCARDS · {j.postcards.length}</h4>
      {j.postcards.length === 0 && <p className="note">Press the camera button (or P) while walking to take one.</p>}
      <div className="postcards">
        {j.postcards.map((pc) => (
          <figure key={pc.id}>
            <img src={pc.dataUrl} alt={`Postcard from ${pc.place}`} />
            <figcaption>
              {pc.place}
              <a href={pc.dataUrl} download={`morphis-${pc.place.replace(/\W+/g, '-').toLowerCase()}.jpg`} title="Download">
                ↓
              </a>
              <button onClick={() => void useJournal.getState().deletePostcard(pc.id)} title="Delete">
                ×
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ look

export function LookPanel() {
  const open = useUI((s) => s.panel === 'look');
  const look = useGuest((s) => s.look);
  if (!open) return null;
  const g = useGuest.getState();
  const swatch = (key: keyof typeof LOOK_SWATCHES, label: string) => (
    <div className="look-row">
      <label>{label}</label>
      <div className="swatches">
        {LOOK_SWATCHES[key].map((c) => (
          <button key={c} className={look[key] === c ? 'on' : ''} style={{ background: c }} onClick={() => g.setLook({ [key]: c })} aria-label={`${label} ${c}`} />
        ))}
      </div>
    </div>
  );
  return (
    <section className="side-panel glass look-panel" data-testid="look-panel">
      <div className="panel-head">
        <span>YOUR LOOK</span>
        <button className="close" onClick={() => useUI.getState().setPanel(null)} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <div className="look-row">
        <label>Body</label>
        <input type="range" min={0.9} max={1.15} step={0.01} value={look.build} onChange={(e) => g.setLook({ build: Number(e.target.value) })} />
      </div>
      <div className="look-row">
        <label>Height</label>
        <input type="range" min={0.92} max={1.08} step={0.01} value={look.height} onChange={(e) => g.setLook({ height: Number(e.target.value) })} />
      </div>
      {swatch('coat', 'Coat')}
      {swatch('trousers', 'Trousers')}
      {swatch('hair', 'Hair')}
      {swatch('skin', 'Skin')}
      {swatch('eyes', 'Eyes')}
      <div className="actions">
        <button onClick={() => g.randomLook()} data-testid="btn-random-look">
          <Icon name="spark" /> RANDOMISE
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ welcome

export function Welcome() {
  const seen = useGuest((s) => s.welcomeSeen);
  const ai = useSim((s) => s.ai);
  const agents = useSim((s) => s.agents.length);
  const population = useSim((s) => s.citizens.length);
  if (seen) return null;
  const close = () => useGuest.getState().dismissWelcome();
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome__card glass">
        <div className="welcome__kicker">MORPHIS · YEAR 2126</div>
        <h1>A city where AI agents live.</h1>
        <p>
          {agents} agents and {population - agents} residents keep their own days here. The agents open ventures, back each other with credits, study at the Institute and take on JARVIS projects. Every deed is logged.
          {ai?.connected ? ' A real AI model is making their decisions right now.' : ' In this version the simulation makes their decisions (no AI model is connected).'}
        </p>
        <div className="welcome__actions">
          <button
            className="welcome__primary"
            onClick={() => {
              close();
              startWalk();
            }}
            data-testid="btn-welcome-walk"
          >
            <Icon name="walk" /> WALK IN
          </button>
          <button
            onClick={() => {
              close();
              rise();
            }}
            data-testid="btn-welcome-watch"
          >
            <Icon name="map" /> WATCH FROM ABOVE
          </button>
          <button
            onClick={() => {
              close();
              useUI.getState().setPanel('agents');
            }}
          >
            <Icon name="user" /> MEET THE AGENTS
          </button>
        </div>
        <ul className="welcome__list">
          <li>
            <b>Walk anywhere.</b> WASD or click, drag to look, or use the stick on a phone.
          </li>
          <li>
            <b>Wave.</b> People nearby stop, turn and wave back.
          </li>
          <li>
            <b>Read the cards.</b> Every agent has a reason for being here and a log of deeds.
          </li>
          <li>
            <b>Open any door</b> or ride the Skyrail across town.
          </li>
          <li>
            <b>Keep a journal.</b> Daily goals, places, badges and postcards.
          </li>
        </ul>
      </div>
    </div>
  );
}
