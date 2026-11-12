# The Agency: specialist agents

Morphis includes the specialist personas from
[The Agency (msitarzewski/agency-agents)](https://github.com/msitarzewski/agency-agents),
used under the MIT License. There are 283 specialists in 18 divisions: engineering,
design, marketing, sales, finance, security, testing, product, project management,
academic, GIS, game development and more.

## Where they live

- **In town (73).** A hand-picked, broad mix lives in Morphis as residents. Each one has
  a home, works in a building that fits their division (engineering in the labs,
  finance at the bank, security at the data center, academics at the university),
  an agent card with the persona's description, and takes part in agent life
  (evening decisions, friendships, deeds). They keep their craft: they do not change
  jobs or move their workplace to a venture they found.
- **On call (the rest).** Every specialist can be hired by JARVIS for a project.

Find them in the Agents panel under the filter "The Agency", with a second filter by
division.

## How JARVIS uses them

1. **Planning.** With an AI model connected, the planner sees the whole roster (ids,
   with residents marked) plus the best matches for the request with their
   descriptions. For each task it names a `specialist` and also a workforce `role`.
   Ids the model invents are dropped. Without a model, the template planner hires a
   resident specialist only when one clearly matches a task.
2. **Assignment.** If the specialist lives in town and is free, they get the task and
   walk to the task's building. If they are busy, the task waits for them for up to a
   working day, then goes to the workforce role. If the specialist does not live in
   town, the workforce member with the role does the task using that specialist's
   playbook; if they are busy, a free resident specialist from the same division
   takes the playbook instead, so work runs in parallel.
3. **Working.** The specialist's persona file (frontmatter removed, long playbooks cut
   at a heading, about 7,000 characters at most) becomes the agent's working
   instructions. Morphis wraps it in its own rules, which win where they conflict:
   only the listed tools (project workspace, town data, web pages with human
   approval), no invented sources or data, money in simulated credits, and where a
   playbook says to run, install or deploy something, the agent writes the plan,
   code or checklist and says it has not been run.

The JARVIS panel shows the hired specialist on each task, and finished files say
who wrote them.

## Memory

Every agent (workforce, specialists, independents) keeps a long-term memory on the
server, built only from things that happened in town:

| Kind | Written when | Kept |
|---|---|---|
| Work | An AI task is finished (project, task, summary of the deliverable) | last 25 |
| Conversation | A visitor talks to the agent (what they said, what the agent answered) | last 15 |
| Day | A simulated day ends: that day's deeds and the plan for tomorrow | last 20 |

The most relevant memories (word overlap with the situation, recent ones preferred,
always the latest day) are recalled into the agent's task work, evening decisions
and conversations. Memories are stored in `DATA_DIR/agent-memory.json`, shown on
the agent card (MEMORY tab) in server towns and available at
`GET /api/agents/:slug/memory`.

## Updating the roster

```bash
git clone --depth 1 https://github.com/msitarzewski/agency-agents /tmp/agency-agents
node scripts/import-agency-agents.mjs /tmp/agency-agents
```

The script copies the persona files unmodified into `vendor/agency-agents/` (with the
licence and the source commit in `SOURCE.md`) and regenerates
`packages/shared/src/agency.generated.ts`. Residents are listed in the script.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENCY_DIR` | found automatically | Folder with the persona files, if you keep them elsewhere |

Costs: a persona adds up to about 2,000 tokens to each step of a specialist's task.
The existing request limits (`AI_REQUESTS_PER_MINUTE`, `AI_DAILY_REQUEST_CAP`) apply.
