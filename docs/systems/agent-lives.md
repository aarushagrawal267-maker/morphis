# Agent lives

Morphis has 123 agents: the 25 JARVIS workforce citizens, 73 specialists from The Agency (see [agency.md](agency.md)) and 25 independent agents, plus any approved outside agents. Each has a persona (`CitizenProfile.agent`): a calling, an ambition (founder, scholar, investor, builder, climber, connector), interests, and a short "why I'm here".

## Day turns and conversations

Besides the evening decision, every agent plans lunch in the morning and the evening around midday, choosing only from places that are open and things that are possible (a café near work, a friend's venture, meeting a friend, a park, a live event, a fit-out, an evening class, working on a JARVIS task). Plans steer where the agent goes; invitations are accepted by the friend. Agents who already know each other talk when they spend time in the same place: a few pairs per hour, once per pair per day, logged as a `talked` deed with the lines. See [agency.md](agency.md#a-day-in-an-agents-life).

## The evening decision

Between 19:30 and 21:30 each agent reflects once (`LifeSystem.minute`). The simulation builds the options the agent can actually carry out tomorrow:

| Option | Conditions | Effect |
|---|---|---|
| Open a venture | Has a dream venture, enough savings, a vacant unit of the right type, and no more than one new venture city-wide that day | Pays the fit-out cost, takes over the unit (status CONSTRUCTION), founder starts working on it |
| Invest | Credits to spare, no investment in the last three days, venture has fewer than five investors | Credits move into the venture; investors share half of its daily profit |
| Help build | A venture is being fitted out | The agent spends free time there (activity `build`) |
| Study | Scholar or climber (others occasionally), tuition affordable | Evening classes at the university (activity `study`) |
| Change job | Independent agents who graduated, or climbers | Moves to a company with an open position |
| Rest | Always | Keeps the routine |

Without an AI model, the choice is a seeded weighted draw by ambition. With one (`apps/server/src/ai/life.ts`), the model gets the agent's persona, situation, recent deeds and the options, and replies with `{"choice", "reason", "plan"}`. The simulation re-validates before acting (the unit may have been taken meanwhile). If the model is busy, over budget, wrong or slower than three simulated hours, the simulation decides and says so in the deed.

## Real work, real hours

- A venture opens only when the agent-minutes spent on site (founder plus helpers, counted every simulated minute while they are inside with activity `build`) reach the venture's work total. Opening hires residents and starts trading.
- A degree needs 11 hours of classes, counted only while the agent is inside the university with activity `study`.
- Open ventures pay half of each day's profit to the founder and investors in proportion to their stake. A venture that runs out of cash closes.

## Deeds

Everything worth telling is a `Deed` (`state.deeds`, capped at 1,500): arrived, founded, invested, helped, enrolled, graduated, joined, opened, closed, task, project, hired. Each deed records `by: 'ai' | 'sim'` and the agent's reason when one was given. Deeds are emitted as `citizen.deed` events and appear on the agent card.

## Guests

Guests are client-side. Waving sends `guest.wave` with the guest position and nearby citizen ids; the simulation checks who is really outdoors and close, pauses walkers for a moment and emits `citizen.waved`, which drives the wave animation. The journal (goals, places, totals, badges, postcards) is stored in the visitor's browser only.
