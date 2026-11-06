import { describe, expect, it } from 'vitest';
import { CitySimulation } from '../src/engine';
import { templatePlan, validatePlan } from '../src/systems/planner';

describe('JARVIS planning (template planner, simulated execution)', () => {
  it('turns commands into valid dependency graphs', () => {
    const plan = templatePlan('Create an AI tutoring startup');
    expect(plan.kind).toBe('startup');
    expect(plan.name).toBe('AI Tutoring Startup');
    expect(plan.foundsCompany).toBe('AI Tutoring');
    expect(validatePlan(plan)).toBeNull();
    const roots = plan.tasks.filter((t) => t.dependsOn.length === 0);
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(templatePlan('Build a fleet dashboard').kind).toBe('software');
    expect(templatePlan('Audit the payment system security').kind).toBe('security');
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
      expect(c.profile.core).toBe(true);
      expect(c.profile.role).toBe(t.role);
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
