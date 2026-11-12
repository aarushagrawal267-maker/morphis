import { describe, expect, it } from 'vitest';
import { AGENCY_AGENTS, agencyAgent } from '@morphis/shared';
import { CitySimulation } from '../src/engine';
import { templatePlan, validatePlan } from '../src/systems/planner';

describe('JARVIS planning (template planner, simulated execution)', () => {
  it('turns commands into valid dependency graphs', () => {
    const plan = templatePlan('Create an AI tutoring startup');
    expect(plan.kind).toBe('startup');
    expect(plan.name).toBe('AI Tutoring Startup');
    expect(plan.foundsCompany).toBe('AI Tutoring');
    expect(validatePlan(plan)).toBeNull();
    // clear matches hire resident specialists from The Agency
    const hired = plan.tasks.filter((t) => t.specialist).map((t) => agencyAgent(t.specialist)!);
    expect(hired.length).toBeGreaterThan(2);
    for (const a of hired) expect(a.resident).toBe(true);
    expect(new Set(hired.map((a) => a.id)).size).toBe(hired.length);
    const roots = plan.tasks.filter((t) => t.dependsOn.length === 0);
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(templatePlan('Build a fleet dashboard').kind).toBe('software');
    expect(templatePlan('Audit the payment system security').kind).toBe('security');
  });

  it('hires a resident Agency specialist for a task, and falls back to the workforce role otherwise', () => {
    const sim = CitySimulation.create({ population: 300 });
    sim.run(3600 * 2);
    const resident = sim.workforce.specialists()[0];
    expect(resident).toBeDefined();
    const id = resident.profile.agent!.agency!;
    const outsider = AGENCY_AGENTS.find((a) => !a.resident)!;
    const project = sim.workforce.createProject(
      {
        name: 'Specialist test',
        kind: 'llm',
        description: 'test',
        planner: 'test',
        tasks: [
          { key: 'a', title: 'Resident specialist task', role: 'researcher', specialist: id, work: 60, dependsOn: [], description: 'x', artifact: 'a.md' },
          { key: 'b', title: 'Hired-in specialist task', role: 'data_analyst', specialist: outsider.id, work: 60, dependsOn: [], description: 'x', artifact: 'b.md' },
        ],
      },
      'jarvis',
      sim.state.buildings[0].id,
      null,
      null,
    );
    const [a, b] = project.tasks.map((t) => sim.workforce.task(t)!);
    expect(a.specialist).toBe(id);
    expect(a.assigneeId).toBe(resident.profile.id);
    expect(a.buildingId).toBe(resident.profile.workplaceId);
    expect(b.specialist).toBe(outsider.id);
    const bc = sim.citizenById(b.assigneeId!)!;
    expect(bc.profile.role).toBe('data_analyst');
  });

  it('rejects cyclic plans', () => {
    const plan = templatePlan('Research city traffic');
    plan.tasks[0].dependsOn = [plan.tasks[plan.tasks.length - 1].key];
    expect(validatePlan(plan)).toBe('dependency cycle');
  });

  it('assigns tasks to core citizens who must be at work for progress', () => {
    const sim = CitySimulation.create({ population: 120 });
    sim.run(3600 * 2); // 08:40
    const reply = sim.command({ type: 'jarvis.command', text: 'Research city traffic patterns' });
    expect(reply.ok).toBe(true);
    const project = sim.state.projects.find((p) => p.source === 'jarvis')!;
    expect(project.tasks.length).toBeGreaterThan(3);
    const assigned = sim.state.tasks.filter((t) => t.projectId === project.id && t.assigneeId);
    expect(assigned.length).toBeGreaterThan(0);
    for (const t of assigned) {
      const c = sim.citizenById(t.assigneeId!)!;
      if (c.profile.agent?.agency) {
        // a resident specialist hired for this task
        expect(c.profile.agent.agency).toBe(t.specialist);
      } else {
        expect(c.profile.core).toBe(true);
        expect(c.profile.role).toBe(t.role);
      }
    }
    // progress only while WORKING inside the task building
    sim.run(3600 * 3);
    for (const t of sim.state.tasks.filter((x) => x.projectId === project.id && x.progress > 0)) {
      expect(t.startedAt).not.toBeNull();
    }
    const completed = sim.state.tasks.filter((t) => t.projectId === project.id && t.status === 'COMPLETED');
    for (const t of completed) expect(t.output).toContain('[SIMULATED]');
  });
});

describe('JARVIS priority', () => {
  it('pauses routine company work so JARVIS tasks start immediately', () => {
    const sim = CitySimulation.create({ population: 120 });
    sim.run(3600 * 3); // company backlog assigned during the morning
    const busy = sim.state.citizens.find((c) => c.profile.core && c.dyn.currentTaskId)!;
    expect(busy).toBeTruthy();
    const role = busy.profile.role!;
    const plan = templatePlan('Research the city');
    plan.tasks = [{ key: 'only', title: 'Priority analysis', role, work: 60, dependsOn: [], description: 'x', artifact: 'only.md' }];
    const r = sim.jarvisCommand('Priority analysis', plan, true);
    expect(r.ok).toBe(true);
    const task = sim.state.tasks.find((t) => t.title === 'Priority analysis')!;
    expect(task.assigneeId).toBe(busy.profile.id);
    expect(sim.state.projects.find((p) => p.id === task.projectId)!.urgent).toBe(true);
  });
});
