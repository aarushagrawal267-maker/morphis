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
- Each task runs as a **multi-step agent loop** (up to `AI_AGENT_MAX_STEPS`, default 6). Every turn the model answers with one JSON object: either `{"thought", "action", "args"}` to call a tool, or `{"thought", "final"}` with the finished markdown deliverable. Tool results come back as observations. Plain-text answers are accepted as the final deliverable, so models without strict JSON habits still work.
- The prompt holds the citizen's persona and role, the project brief, the task, upstream deliverables and recent memory. The hand-in is written through the audited `workspace.write` tool.
- JARVIS tasks take priority: if the right citizen is busy with routine company work, that task is paused and resumed later.
- **Urgent** commands (`urgent: true`, the "Start now" checkbox) call assignees in immediately, even at night, unless they are exhausted. Otherwise work starts during normal working hours.
- Agent memory is persisted to `data/agent-memory.json` and survives restarts.
- Review tasks receive every completed deliverable and write the final synthesis (`project.report`).
- Reasoning traces (`<think>…</think>`) are stripped from model output.
- On failure the task is retried once by re-queueing it. A second failure completes it with a `[SIMULATED FALLBACK]` note that says no real work was produced.

## Permissions

| Level | Tools | Behaviour |
|---|---|---|
| auto | `workspace.read`, `workspace.write`, `workspace.list` | executed and audited |
| approval | `web.fetch` (enabled), `code.exec` (disabled) | the agent pauses. The request appears in the JARVIS console with **Approve / Deny**, and the agent continues once you decide (denied or expired after `AI_APPROVAL_TIMEOUT_MS` means it continues without it). `web.fetch` only reaches public http(s) addresses: localhost, private ranges, link-local/metadata IPs, credentials in URLs and redirects to such targets are refused. Responses are capped at 600 KB and converted to text |
| restricted | `system.shell` | always refused |

Code execution still needs a sandbox runtime (e.g. one container per project workspace). The approval flow it will use already works.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AI_AGENT_MAX_STEPS` | 6 | tool-use steps per task before a final answer is forced |
| `AI_WEB_FETCH` | true | offer `web.fetch` to agents (each call still needs approval) |
| `AI_APPROVAL_TIMEOUT_MS` | 600000 | how long an agent waits for a decision |
| `AI_THINKING` | false | NVIDIA reasoning mode (`chat_template_kwargs.enable_thinking`); slower, sometimes better |

## Status reporting

`GET /api/ai/status` returns provider, verification result, last error, token usage, requests today, tools and pending approvals. The HUD shows `AI · SIMULATED` unless the provider was verified.
