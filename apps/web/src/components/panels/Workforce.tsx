/** Projects (per building), citizen profile, task view and the JARVIS command console. */
import { useMemo, useState } from 'react';
import type { SimProject, SimTask } from '@morphis/shared';
import { BUILDING_TYPES, CORE_ROLES, agencyAgent, formatClock, formatCredits, dayOf, WEEKDAYS } from '@morphis/shared';
import { run } from '../../sim/commands';
import { useSim } from '../../state/simStore';
import { useUI } from '../../state/uiStore';
import { PanelHeader } from '../hud/Feeds';
import { Icon } from '../ui/icons';
import { focusBuilding, focusCitizen } from './actions';

function TaskRow({ t }: { t: SimTask }) {
  const citizens = useSim((s) => s.citizensById);
  const buildings = useSim((s) => s.buildingsById);
  const who = t.assigneeId ? citizens.get(t.assigneeId) : null;
  return (
    <li className={`task task--${t.status.toLowerCase()}`}>
      <div className="task__head">
        <b>{t.title}</b>
        <span className="task__status">{t.status}</span>
      </div>
      <div className="task__meta">
        {agencyAgent(t.specialist) ? (
          <span title="Specialist from The Agency hired by JARVIS">
            {agencyAgent(t.specialist)!.emoji} {agencyAgent(t.specialist)!.name}
            {who && !who.agent?.agency ? ` (playbook, done by ${CORE_ROLES[t.role].label})` : ''}
          </span>
        ) : (
          CORE_ROLES[t.role].label
        )}
        {who && (
          <>
            {' · '}
            <a onClick={() => focusCitizen(who.id)}>{who.name}</a>
          </>
        )}
        {' · '}
        <a onClick={() => focusBuilding(t.buildingId)}>{buildings.get(t.buildingId)?.name}</a>
      </div>
      <div className="bar__track small">
        <span style={{ width: `${Math.round(t.progress * 100)}%` }} />
      </div>
      {t.output && <div className="task__out">{t.output}</div>}
    </li>
  );
}

function ProjectCard({ p, open = false }: { p: SimProject; open?: boolean }) {
  const taskMap = useSim((s) => s.tasks);
  const tasks = useMemo(() => p.tasks.map((id) => taskMap.get(id)).filter((t): t is SimTask => !!t), [p.tasks, taskMap]);
  const [expanded, setExpanded] = useState(open);
  return (
    <div className={`project project--${p.status.toLowerCase()}`}>
      <button className="project__head" onClick={() => setExpanded((e) => !e)}>
        <span>
          <b>{p.name}</b>
          <small>
            {p.source === 'jarvis' ? 'JARVIS' : 'Company'} · {p.planner ?? 'planner'} · {tasks.filter((t) => t.status === 'COMPLETED').length}/{tasks.length} tasks
          </small>
        </span>
        <span className="pct">{Math.round(p.progress * 100)}%</span>
      </button>
      <div className="bar__track small">
        <span style={{ width: `${Math.round(p.progress * 100)}%` }} />
      </div>
      {expanded && (
        <>
          <p className="note">Workspace: <code>{p.workspace}</code></p>
          <ul className="tasks">{tasks.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
          {p.report && <pre className="report">{p.report}</pre>}
        </>
      )}
    </div>
  );
}

export function ProjectsPanel() {
  const open = useUI((s) => s.panel === 'projects');
  const sel = useUI((s) => s.selection);
  const b = useSim((s) => (sel?.kind === 'building' ? s.buildingsById.get(sel.id) : undefined));
  const projects = useSim((s) => s.projects);
  const tasks = useSim((s) => s.tasks);
  if (!open) return null;
  const relevant = b ? projects.filter((p) => p.buildingId === b.id || p.tasks.some((id) => tasks.get(id)?.buildingId === b.id)) : projects;
  return (
    <section className="side-panel glass wide" data-testid="projects-panel">
      <PanelHeader title={b ? `PROJECTS · ${b.name}` : 'ALL PROJECTS'} />
      {relevant.length === 0 && <p className="note">No projects involve this building yet. Projects appear when companies or JARVIS assign work here.</p>}
      {relevant
        .slice()
        .reverse()
        .map((p) => (
          <ProjectCard key={p.id} p={p} />
        ))}
    </section>
  );
}

export function ProfileModal() {
  const open = useUI((s) => s.panel === 'profile');
  const sel = useUI((s) => s.selection);
  const p = useSim((s) => (sel?.kind === 'citizen' ? s.citizensById.get(sel.id) : undefined));
  const d = useSim((s) => (p ? s.state?.citizens[p.index] : undefined));
  const buildings = useSim((s) => s.buildingsById);
  if (!open || !p) return null;
  const home = buildings.get(p.homeId);
  const work = p.workplaceId ? buildings.get(p.workplaceId) : null;
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return (
    <section className="side-panel glass wide" data-testid="profile-panel">
      <PanelHeader title="CITIZEN PROFILE" />
      <h2>{p.name}</h2>
      <p className="desc">{p.bio}</p>
      <div className="rows">
        <div className="row"><span>Age</span><b>{p.age}</b></div>
        <div className="row"><span>Occupation</span><b>{p.occupation}</b></div>
        <div className="row"><span>Department</span><b>{p.department}</b></div>
        <div className="row"><span>Home</span><b><a onClick={() => home && focusBuilding(home.id)}>{home?.name}</a></b></div>
        <div className="row"><span>Workplace</span><b>{work ? <a onClick={() => focusBuilding(work.id)}>{work.name}</a> : '—'}</b></div>
        <div className="row"><span>Monthly salary (sim)</span><b>{formatCredits(p.salary)}</b></div>
        <div className="row"><span>Monthly rent (sim)</span><b>{formatCredits(p.rent)}</b></div>
        <div className="row"><span>Savings (sim)</span><b>{formatCredits(d?.savings ?? 0)}</b></div>
        <div className="row"><span>Owns a car</span><b>{p.ownsCar ? 'Yes' : 'No'}</b></div>
      </div>
      {d && (
        <>
          <h4>Spending this month (simulated)</h4>
          <div className="tags">
            {Object.entries(d.spending).map(([k, v]) => (
              <span key={k} className="tag">
                {k} · {formatCredits(v)}
              </span>
            ))}
          </div>
        </>
      )}
      <h4>Skills</h4>
      <div className="tags">
        {Object.entries(p.skills).map(([k, v]) => (
          <span key={k} className="tag">
            {k} · {Math.round(v * 100)}
          </span>
        ))}
      </div>
      <h4>Weekday schedule</h4>
      <ol className="schedule">
        {p.schedule.map((s, i) => (
          <li key={i}>
            <time>{fmt(s.start)}</time> {s.activity}
          </li>
        ))}
      </ol>
      <h4>Weekend</h4>
      <ol className="schedule">
        {p.weekendSchedule.map((s, i) => (
          <li key={i}>
            <time>{fmt(s.start)}</time> {s.activity}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TaskModal() {
  const open = useUI((s) => s.panel === 'task');
  const sel = useUI((s) => s.selection);
  const p = useSim((s) => (sel?.kind === 'citizen' ? s.citizensById.get(sel.id) : undefined));
  const taskId = useSim((s) => (p ? s.state?.citizens[p.index]?.currentTaskId : null));
  const task = useSim((s) => (taskId ? s.tasks.get(taskId) : undefined));
  const project = useSim((s) => (task ? s.projects.find((x) => x.id === task.projectId) : undefined));
  if (!open) return null;
  return (
    <section className="side-panel glass wide" data-testid="task-panel">
      <PanelHeader title="CURRENT TASK" />
      {!task && <p className="note">{p?.name ?? 'This citizen'} has no task right now.</p>}
      {task && (
        <>
          <ul className="tasks">
            <TaskRow t={task} />
          </ul>
          {project && <ProjectCard p={project} open />}
        </>
      )}
    </section>
  );
}

const EXAMPLES = ['Create an AI tutoring startup', 'Build a city traffic dashboard', 'Research energy use in Morphis', 'Run a marketing campaign for the Lantern Night Market', 'Audit the security of the data center'];

export function JarvisConsole() {
  const open = useUI((s) => s.panel === 'jarvis');
  const commands = useSim((s) => s.commands);
  const projects = useSim((s) => s.projects);
  const ai = useSim((s) => s.ai);
  const citizens = useSim((s) => s.citizens);
  const state = useSim((s) => s.state);
  const tasks = useSim((s) => s.tasks);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const approvals = useSim((s) => s.approvals);
  if (!open) return null;
  const core = citizens.filter((c) => c.core);
  const submit = async (t: string) => {
    if (t.trim().length < 3) return;
    setBusy(true);
    await run({ type: 'jarvis.command', text: t.trim(), urgent }, urgent ? 'JARVIS accepted the command — team called in now' : 'JARVIS accepted the command');
    setBusy(false);
    setText('');
  };
  const jarvisProjects = projects.filter((p) => p.source === 'jarvis').slice().reverse();
  return (
    <section className="side-panel glass wide jarvis-console" data-testid="jarvis-panel">
      <PanelHeader title="JARVIS · COMMAND INTERFACE" />
      <div className={`ai-status ${ai?.connected ? 'live' : 'sim'}`}>
        <Icon name="core" />
        <div>
          <b>{ai?.connected ? `AI provider connected: ${ai.provider}` : 'AI provider not connected — simulated execution'}</b>
          <small>{ai?.detail}</small>
        </div>
      </div>
      <form
        className="cmd"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
      >
        <span className="prompt">JARVIS&gt;</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Give JARVIS a high-level command…" maxLength={500} data-testid="jarvis-input" />
        <button disabled={busy || text.trim().length < 3} data-testid="jarvis-submit">
          SEND
        </button>
      </form>
      <label className="toggle" data-testid="jarvis-urgent">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
        <span>Start now (urgent: call the team in even outside working hours)</span>
      </label>
      {approvals.length > 0 && (
        <>
          <h4>Approvals</h4>
          <ul className="approvals">
            {approvals
              .slice()
              .reverse()
              .slice(0, 8)
              .map((a) => (
                <li key={a.id} className={`appr appr--${a.status.toLowerCase()}`} data-testid="approval">
                  <div>
                    <b>
                      {a.agentName} wants to use {a.tool}
                    </b>
                    <small>
                      “{a.taskTitle}” · <code>{a.summary}</code>
                    </small>
                  </div>
                  {a.status === 'PENDING' ? (
                    <span className="appr__btns">
                      <button onClick={() => run({ type: 'jarvis.approve', id: a.id, approve: true }, 'Approved')} data-testid="approve">
                        APPROVE
                      </button>
                      <button className="deny" onClick={() => run({ type: 'jarvis.approve', id: a.id, approve: false }, 'Denied')}>
                        DENY
                      </button>
                    </span>
                  ) : (
                    <span className="appr__status">{a.status}</span>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}
      <div className="examples">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setText(e)}>
            {e}
          </button>
        ))}
      </div>
      {commands.length > 0 && (
        <>
          <h4>Commands</h4>
          <ul className="cmds">
            {commands
              .slice()
              .reverse()
              .slice(0, 6)
              .map((c) => (
                <li key={c.id} className={`cmd-${c.status.toLowerCase()}`}>
                  <b>“{c.text}”</b>
                  <small>
                    {c.status} · {c.planner} · {c.message} · Day {dayOf(c.time)} {WEEKDAYS[(dayOf(c.time) - 1) % 7]} {formatClock(c.time)}
                  </small>
                </li>
              ))}
          </ul>
        </>
      )}
      {jarvisProjects.length > 0 && <h4>Projects (task graphs)</h4>}
      {jarvisProjects.map((p) => (
        <ProjectCard key={p.id} p={p} open />
      ))}
      <h4>Workforce · 25 core citizens</h4>
      <div className="workforce">
        {core.map((c) => {
          const d = state?.citizens[c.index];
          const t = d?.currentTaskId ? tasks.get(d.currentTaskId) : undefined;
          return (
            <button key={c.id} className="wf" onClick={() => focusCitizen(c.id)} title={t ? t.title : 'No task'}>
              <span className="wf__dot" style={{ background: CORE_ROLES[c.role!].color }} />
              <span className="wf__name">{c.name}</span>
              <span className="wf__role">{CORE_ROLES[c.role!].label}</span>
              <span className={`wf__status s-${(d?.status ?? '').toLowerCase()}`}>{d?.status}</span>
            </button>
          );
        })}
      </div>
      <p className="note">
        Pipeline: JARVIS → Master Planner (task dependency graph) → Task Manager (role assignment) → citizen travels to the work building → executor →
        reviewer → final synthesis. Without an AI provider the executor is the simulation and deliverables are labelled [SIMULATED].
      </p>
      <p className="note">Building types used: {Object.keys(BUILDING_TYPES).length} · all figures are simulated.</p>
    </section>
  );
}
