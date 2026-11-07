/**
 * What people say out loud. Every line is derived from the citizen's real
 * simulated state (activity, needs, weather, time, city events, ventures) or,
 * for agents, from their plan for the day (which an AI wrote when one is
 * connected). Lines change every ten simulated minutes.
 */
import type { AgentLife, CitizenDynamic, CitizenProfile, CityEvent, Venture, WeatherKind } from '@morphis/shared';
import { hourOf } from '@morphis/shared';

const pick = (arr: string[], seed: number) => arr[Math.abs(Math.floor(seed)) % arr.length];

export interface ChatterContext {
  /** A friend standing close by (agents greet and talk to their friends). */
  friend?: { name: string; life?: AgentLife };
  time: number;
  weather: WeatherKind;
  events: CityEvent[];
  ventures: Venture[];
  busyProjects: number;
}

export function chatterFor(p: CitizenProfile, d: CitizenDynamic, life: AgentLife | undefined, ctx: ChatterContext): string {
  const slot = Math.floor(ctx.time / 600);
  const seed = p.index * 7 + slot;
  const h = hourOf(ctx.time);
  if (ctx.friend && seed % 4 !== 3) {
    const f = ctx.friend.name.split(' ')[0];
    const fl = ctx.friend.life;
    const theirs = fl?.ventureId ? ctx.ventures.find((v) => v.id === fl.ventureId) : undefined;
    const helping = fl?.helpingId ? ctx.ventures.find((v) => v.id === fl.helpingId) : undefined;
    const mine = life?.ventureId ? ctx.ventures.find((v) => v.id === life.ventureId) : undefined;
    const options = [`Good to see you, ${f}!`, `${f}! Coffee later?`];
    if (theirs) options.push(theirs.status === 'OPEN' ? `${f}, ${theirs.name} looks busy tonight.` : `${f}, how is ${theirs.name} coming along?`);
    if (helping) options.push(`Thanks for helping at ${helping.name}, ${f}.`);
    if (fl?.study) options.push(`${f}, how are the ${fl.study.field} classes?`);
    if (mine && mine.status === 'FITTING_OUT') options.push(`${f}, could you lend a hand at ${mine.name}?`);
    if (h < 10) options.push(`Morning, ${f}! Sleep well?`);
    else if (h >= 20) options.push(`${f}! Out late again?`, `Walk me home, ${f}?`);
    if (ctx.weather === 'rain' || ctx.weather === 'storm') options.push(`${f}, share my umbrella?`);
    if (ctx.weather === 'fog') options.push(`${f}? Is that you in this fog?`);
    const ev = ctx.events.find((e) => e.status === 'LIVE');
    if (ev) options.push(`${f}, coming to ${ev.name}?`);
    return pick(options, seed);
  }
  if (life?.plan && seed % 3 !== 2) return life.plan;
  if (d.satiety < 0.28) return pick(['Starving. Where is the nearest café?', 'I could eat a whole noodle bar.', 'Lunch. Now.'], seed);
  if (d.energy < 0.2) return pick(['I need about twelve hours of sleep.', 'Running on fumes.', 'Bed. Soon.'], seed);
  if (ctx.weather === 'storm') return pick(['This storm is no joke.', 'Hold on to your hat near the island edge.', 'Did you see that lightning?'], seed);
  if (ctx.weather === 'rain') return pick(['Should have brought an umbrella.', 'Rain makes the shop lights look better.', 'Wet streets again.'], seed);
  if (ctx.weather === 'fog') return pick(["Can't even see the end of the street.", 'This fog is thick.', 'Feels like walking through a cloud.'], seed);
  if (ctx.weather === 'clear' && h >= 18 && h < 20 && seed % 2 === 0) return pick(['Look at that sunset over the cloud sea.', 'Golden hour on the island. Best time of day.', 'The sky lifts glow at dusk.'], seed);
  if (ctx.weather === 'clear' && h >= 6 && h < 8 && seed % 2 === 0) return pick(['Fresh morning air up here.', 'First light over the clouds. Never gets old.', 'Early start, quiet streets.'], seed);
  const live = ctx.events.find((e) => e.status === 'LIVE');
  if (live && live.kind === 'market' && seed % 4 === 2) return pick(['The lanterns are up at the market!', 'Dumplings at the night market, anyone?', 'I always buy too much at the market.'], seed);
  if (live && seed % 4 === 0) return pick([`Are you going to ${live.name}?`, `${live.name} is on right now.`, `Heard ${live.name} is packed.`], seed);
  const open = ctx.ventures.filter((v) => v.status === 'OPEN');
  if (open.length && seed % 5 === 1) {
    const v = open[seed % open.length];
    return pick([`Have you tried ${v.name}?`, `${v.name} is my new favourite place.`, `They say ${v.name} was built by agents.`], seed);
  }
  const building = ctx.ventures.filter((v) => v.status === 'FITTING_OUT');
  if (building.length && seed % 5 === 3) return `Someone is opening ${building[seed % building.length].name}.`;
  if (ctx.busyProjects > 0 && p.core && seed % 3 === 0) return pick(['JARVIS has us all busy.', 'Another project just landed.', 'Deadline tonight.'], seed);
  switch (d.activity) {
    case 'work':
      return pick(['Running late again.', 'Another shift.', 'Work, then dinner.', 'Big day today.'], seed);
    case 'eat':
      return pick(['Noodles or dumplings?', 'Food first.', 'I know a good place nearby.'], seed);
    case 'shop':
      return pick(['Just need a few things.', 'Window shopping.', 'Prices keep going up.'], seed);
    case 'park':
      return pick(['Fresh air, finally.', 'Good spot for a walk.', 'The trees are real, you know.', 'You can see three islets from here.', 'Mind the edge, it is a long way down.'], seed);
    case 'leisure':
    case 'event':
      return pick(['Work is done. Now the fun part.', 'Anyone up for the arcade?', 'Meeting friends tonight.'], seed);
    case 'study':
      return pick(['Exams next week.', 'One more class.', 'The Institute library closes at ten.'], seed);
    case 'build':
      return pick(['Almost finished the counter.', 'Fit-out work, again.', 'This place will be great.'], seed);
    case 'home':
    case 'sleep':
      return h >= 21 || h < 5 ? pick(['Heading home.', 'Long day.', 'Night, Morphis.'], seed) : pick(['Back home for a bit.', 'Forgot something at home.', 'Watering the window boxes.'], seed);
  }
  if (h >= 22 || h < 5) return pick(['Lanterns are still on at the café.', 'Quiet streets.', 'Late again.'], seed);
  return pick(['Morning, neighbour.', 'Nice day.', 'Busy town today.', 'This street has the best little shops.'], seed);
}
