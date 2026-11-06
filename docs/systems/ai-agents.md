# JARVIS and the AI workforce

## Components (`apps/server/src/ai`)

| Spec interface | Implementation |
|---|---|
| AgentController | `AgentController` (`agents.ts`): owns provider, planner, executor, tools, memory, workspace; verifies the provider at startup |
| MasterPlanner | `LlmMasterPlanner` (LLM, zod-validated JSON task graph), with `templatePlan` (engine) as fallback |
| TaskManager / ProjectManager | `WorkforceSystem` (engine): projects, dependencies, role assignment, progress, completion, company founding |
| ToolManager | `ToolManager` (`tools.ts`): permission levels `auto` / `approval` / `restricted`; audit log (`data/audit.log`, plus `AuditLog` table with PostgreSQL) |
| AgentMemory | `AgentMemory` (`memory.ts`): recent task summaries per agent, fed into prompts |
| Shared workspace | `Workspace` (`workspace.ts`): `/projects/<slug>/<artifact>.md`, sandboxed to `data/workspaces` |
| EventBus | engine `EventBus`; agent lifecycle emits `agent.started` / `agent.completed` when a citizen is bound to an agent id |

## Execution model

- Only **JARVIS projects** run on the AI provider. The hourly company backlog stays simulated, so a free-tier key is not spent on background work.
- A task starts when its assignee is `WORKING` inside the task's building. The citizen then stays at the desk until the agent reports back (`holdsCitizen`), so the 3D city always shows the real agent state.
- Each task is one completion call. The system prompt holds the citizen's persona and role; the user prompt holds the project brief, the task, upstream deliverables and recent memory. Output is written through `workspace.write`, which is audited.
- Review tasks receive every completed deliverable and write the final synthesis (`project.report`).
- Reasoning traces (`<think>…</think>`) are stripped from model output.
- On failure the task is retried once by re-queueing it. A second failure completes it with a `[SIMULATED FALLBACK]` note that says no real work was produced.

## Permissions

| Level | Tools | Behaviour |
|---|---|---|
| auto | `workspace.read`, `workspace.write`, `workspace.list` | executed and audited |
| approval | `web.fetch`, `code.exec` | defined but **disabled**. When enabled, requests are queued in `pendingApprovals` and are never executed automatically |
| restricted | `system.shell` | always refused |

To enable web or code tools, add a sandboxed implementation (e.g. one container per project workspace) and an approval UI. The registry and audit trail are already in place.

## Status reporting

`GET /api/ai/status` returns provider, verification result, last error, token usage, requests today, tools and pending approvals. The HUD shows `AI · SIMULATED` unless the provider was verified.
