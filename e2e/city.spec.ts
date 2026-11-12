import { expect, test, type Page } from '@playwright/test';

/** Local-mode city (no server needed), low graphics for software WebGL in CI. */
async function open(page: Page, extra = '', welcome = false) {
  if (!welcome) await page.addInitScript(() => localStorage.setItem('morphis.welcome', '1'));
  await page.goto(`/?mode=local&quality=low&population=150${extra}`);
  await page.waitForFunction(() => (window as any).__morphis?.sim.getState().ready, null, { timeout: 90_000 });
  await expect(page.getByTestId('top-header')).toBeVisible();
}

const state = (page: Page) => page.evaluate(() => (window as any).__morphis.sim.getState().state);

test('renders the city with header, navigation and live HUD numbers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.getByTestId('navbar')).toBeVisible();
  await expect(page.getByTestId('city-info')).toContainText('POPULATION');
  await expect(page.getByTestId('city-info')).toContainText('150');
  await expect(page.getByTestId('bottom-bar')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();
  const t0 = (await state(page)).clock.time;
  await page.waitForTimeout(2500);
  expect((await state(page)).clock.time).toBeGreaterThan(t0);
  expect(errors).toEqual([]);
});

test('selects a building by clicking it in 3D (raycast)', async ({ page }) => {
  await open(page);
  // view the HQ from close by, then click its projected screen position
  await page.evaluate(() => (window as any).__morphisCamera.setLookAt(0, 60, 75, 0, 25, 0, false));
  await page.waitForTimeout(1500);
  const p = await page.evaluate(() => (window as any).__morphis.project(0, 30, 0));
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('panel-title')).toHaveText('JARVIS HQ', { timeout: 30_000 });
  await expect(page.getByTestId('selection-panel')).toContainText('Building ID');
});

test('dragging the canvas pans the camera', async ({ page }) => {
  await open(page);
  const target = () => page.evaluate(() => { const v = (window as any).__morphisCamera.getTarget(); return { x: v.x, y: v.y, z: v.z }; });
  const before = await target();
  await page.mouse.move(640, 420);
  await page.mouse.down();
  await page.mouse.move(520, 380, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const after = await target();
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(5);
});

test('navigation tabs focus places and select landmarks', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-institute').click();
  await expect(page.getByTestId('panel-title')).toHaveText('MORPHIS UNIVERSITY');
  await page.getByTestId('tab-research').click();
  await expect(page.getByTestId('panel-title')).toHaveText('MORPHIS AI LAB');
  await page.getByTestId('tab-apartments').click();
  await expect(page.getByTestId('panel-title')).toHaveText('RESIDENTIAL DISTRICT');
  await page.getByTestId('tab-overview').click();
  await expect(page.getByTestId('selection-panel')).toHaveCount(0);
});

test('district pins toggle and focus a district', async ({ page }) => {
  await open(page);
  // pins start hidden on the island overview
  await expect(page.getByTestId('pin-finance')).toHaveCount(0);
  await page.getByTestId('toggle-pins').click();
  await expect(page.getByTestId('pin-finance')).toBeVisible();
  await page.getByTestId('pin-finance').click();
  await expect(page.getByTestId('panel-title')).toHaveText('FINANCE DISTRICT');
  await page.getByTestId('toggle-pins').click();
  await expect(page.getByTestId('pin-finance')).toHaveCount(0);
  await page.getByTestId('toggle-pins').click();
  await expect(page.getByTestId('pin-finance')).toBeVisible();
});

test('simulation controls change speed, pause and weather', async ({ page }) => {
  await open(page);
  await page.getByTestId('speed-10').click();
  await expect.poll(async () => (await state(page)).clock.speed).toBe(10);
  await page.getByTestId('btn-pause').click();
  await expect.poll(async () => (await state(page)).clock.paused).toBe(true);
  const t = (await state(page)).clock.time;
  await page.waitForTimeout(1200);
  expect((await state(page)).clock.time).toBe(t);
  await page.getByTestId('btn-pause').click();
  await page.getByTestId('bb-daynight').click();
  await expect(page.getByTestId('clock-panel')).toBeVisible();
  await page.getByTestId('weather-rain').click();
  await expect.poll(async () => (await state(page)).weather.target).toBe('rain');
  await page.getByTestId('weather-auto').click();
});

test('bottom bar opens feeds and highlight modes', async ({ page }) => {
  await open(page);
  await page.getByTestId('bb-events').click();
  await expect(page.getByTestId('news-panel')).toContainText('Welcome to Morphis');
  await page.getByTestId('bb-walk').click();
  expect(await page.evaluate(() => (window as any).__morphis.ui.getState().highlight)).toBe('pedestrians');
  await page.getByTestId('bb-interior').click();
  expect(await page.evaluate(() => (window as any).__morphis.ui.getState().highlight)).toBe('enterable');
  await page.getByTestId('btn-features').click();
  await expect(page.getByTestId('features-panel')).toContainText('Public Transport');
});

test('enters a building interior and returns to the city', async ({ page }) => {
  await open(page, '&hour=11');
  await page.getByTestId('tab-complex').click();
  await expect(page.getByTestId('panel-title')).toHaveText('JARVIS HQ');
  await page.getByTestId('btn-enter').click();
  await expect(page.getByTestId('interior-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('interior-panel')).toContainText('AI Command Center');
  await page.getByTestId('room-1').click();
  await page.getByTestId('btn-exit').click();
  await expect(page.getByTestId('interior-panel')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('panel-title')).toHaveText('JARVIS HQ');
});

test('JARVIS turns a command into a project with assigned tasks', async ({ page }) => {
  await open(page, '&hour=9');
  await page.getByTestId('btn-jarvis').click();
  await page.getByTestId('jarvis-input').fill('Build a city traffic dashboard');
  await page.getByTestId('jarvis-submit').click();
  await expect(page.getByTestId('jarvis-panel')).toContainText('Build a city traffic dashboard');
  await expect(page.getByTestId('jarvis-panel')).toContainText('City Traffic Dashboard');
  const projects = await page.evaluate(() => (window as any).__morphis.sim.getState().projects.filter((p: any) => p.source === 'jarvis').length);
  expect(projects).toBe(1);
});

test('saves and reloads the city (browser persistence)', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-saves').click();
  await page.getByTestId('save-name').fill('e2e save');
  await page.getByTestId('btn-save').click();
  await expect(page.getByTestId('saves-panel')).toContainText('e2e save');
  await page.getByTestId('btn-load').first().click();
  await expect(page.getByTestId('toast')).toContainText('Loaded');
});

test('debug overlay shows engine metrics', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-settings').click();
  await page.getByTestId('set-debug').click();
  await expect(page.getByTestId('debug-overlay')).toContainText('Draw calls');
  await expect(page.getByTestId('debug-overlay')).toContainText('Simulation tick');
  await page.getByTestId('dbg-roads').check();
});

test('welcome screen leads into walk-in mode; the guest walks, waves and keeps a journal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '&hour=8', true);
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByTestId('btn-welcome-walk').click();
  await expect(page.getByTestId('guest-bar')).toBeVisible();
  await expect(page.getByTestId('navbar')).toHaveCount(0);
  const pose = () => page.evaluate(() => { const g = (window as any).__morphis.guestPose; return { x: g.x, z: g.z }; });
  const p0 = await pose();
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  const p1 = await pose();
  expect(Math.hypot(p1.x - p0.x, p1.z - p0.z)).toBeGreaterThan(0.3);
  // stand next to someone walking and wave: the simulation makes them wave back
  const walker = await page.evaluate(() => {
    const s = (window as any).__morphis.simClient.sampleMotion();
    for (let i = 0; i < s.cVisible.length; i++) if (s.cVisible[i]) return { x: s.cX[i], z: s.cZ[i] };
    return null;
  });
  expect(walker).not.toBeNull();
  await page.evaluate((w) => { const g = (window as any).__morphis.guestPose; g.x = w!.x + 1; g.z = w!.z + 1; }, walker);
  await page.getByTestId('btn-wave').click();
  await expect.poll(() => page.evaluate(() => (window as any).__morphis.journal.getState().totals.waves)).toBe(1);
  await expect.poll(() => page.evaluate(() => { const t = (window as any).__morphis.journal.getState().totals; return t.agentsMet + t.residentsMet; }), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.getByTestId('btn-journal').click();
  await expect(page.getByTestId('journal-panel')).toContainText('TODAY');
  await expect(page.getByTestId('goals').locator('li')).toHaveCount(3);
  await page.getByTestId('btn-rise').click();
  await expect(page.getByTestId('guest-bar')).toHaveCount(0);
  await expect(page.getByTestId('navbar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('agents directory opens an agent card with why, deeds, today and a share link', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-agents').click();
  await expect(page.getByTestId('agents-panel')).toContainText('AGENTS · 123');
  await expect(page.getByTestId('agents-panel')).toContainText('73 specialists from The Agency');
  await page.getByTestId('agent-juno-albright').click();
  await expect(page.getByTestId('panel-title')).toHaveText('JUNO ALBRIGHT');
  await expect(page.getByTestId('agent-why')).toContainText('espresso');
  await page.getByTestId('card-tab-deeds').click();
  await expect(page.getByTestId('deeds')).toContainText('Moved to Morphis');
  await page.getByTestId('card-tab-today').click();
  await expect(page.getByTestId('today').locator('li').first()).toBeVisible();
  await page.getByTestId('card-tab-share').click();
  await expect(page.getByTestId('share-link')).toHaveValue(/#citizen=juno-albright$/);
});

test('specialists from The Agency live in town with their persona on the card', async ({ page }) => {
  await open(page);
  await page.getByTestId('btn-agents').click();
  const panel = page.getByTestId('agents-panel');
  await panel.locator('.agents-filter select').first().selectOption('agency');
  await panel.getByRole('combobox', { name: 'Division' }).selectOption('security');
  const rows = panel.locator('.agent-row');
  await expect(rows).toHaveCount(4);
  await rows.first().click();
  await expect(page.locator('.sel-panel__kicker')).toContainText('THE AGENCY');
  await expect(page.getByTestId('agency-info')).toContainText('THE AGENCY · SECURITY');
  await expect(page.getByTestId('agency-info').getByRole('link', { name: 'agency-agents' })).toHaveAttribute('href', /github\.com\/msitarzewski\/agency-agents\/blob\/main\/security\//);
});

test('a #citizen= link opens that agent and follows them', async ({ page }) => {
  await open(page, '#citizen=sarah-chen');
  await expect(page.getByTestId('panel-title')).toHaveText('SARAH CHEN', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__morphis.ui.getState().follow?.kind)).toBe('citizen');
});

test('the skyrail runs trains between stations', async ({ page }) => {
  await open(page);
  const line = await page.evaluate(() => (window as any).__morphis.sim.getState().world.rail);
  expect(line.stations.length).toBeGreaterThanOrEqual(3);
  const s0 = await page.evaluate(() => (window as any).__morphis.simClient.sampleMotion().rail.slice());
  expect(s0.length).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  const s1 = await page.evaluate(() => (window as any).__morphis.simClient.sampleMotion().rail.slice());
  expect(s1.some((v: number, i: number) => v !== s0[i])).toBe(true);
});

test('the town floats on an island; you can walk into a building and talk to people', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '&hour=12');
  const world = await page.evaluate(() => { const w = (window as any).__morphis.sim.getState().world; return { island: !!w.island, lifts: w.island?.lifts.length, maxH: Math.max(...w.buildings.filter((b: any) => b.type !== 'hq').map((b: any) => b.height)) }; });
  expect(world.island).toBe(true);
  expect(world.lifts).toBeGreaterThan(0);
  expect(world.maxH).toBeLessThan(20); // a low-rise town
  await page.getByTestId('btn-walk').click();
  await expect(page.getByTestId('guest-bar')).toBeVisible();
  // stand at the nearest door and go in
  const door = await page.evaluate(() => {
    const m = (window as any).__morphis;
    const g = m.guestPose;
    let best: any = null;
    let bd = Infinity;
    for (const b of m.sim.getState().world.buildings) {
      if (!b.enterable || b.type === 'hq') continue;
      const d = Math.hypot(b.entrance.x - g.x, b.entrance.z - g.z);
      if (d < bd) { bd = d; best = b; }
    }
    g.x = best.entrance.x;
    g.z = best.entrance.z;
    return best.id;
  });
  await expect(page.getByTestId('door-prompt')).toBeVisible();
  await page.getByTestId('door-prompt').click();
  await expect(page.getByTestId('inside-bar')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__morphis.ui.getState().interior?.buildingId)).toBe(door);
  await page.getByTestId('btn-out').click();
  await expect(page.getByTestId('guest-bar')).toBeVisible();
  // talk to someone walking by
  const id = await page.evaluate(() => {
    const m = (window as any).__morphis;
    const s = m.simClient.sampleMotion();
    for (let i = 0; i < s.cVisible.length; i++) if (s.cVisible[i]) { m.guestPose.x = s.cX[i] + 1; m.guestPose.z = s.cZ[i] + 1; return m.sim.getState().citizens[i].id; }
    return null;
  });
  expect(id).not.toBeNull();
  await page.evaluate((cid) => (window as any).__morphis.ui.getState().select({ kind: 'citizen', id: cid }), id);
  await page.getByTestId('talk-upto').click();
  await expect(page.getByTestId('talk').locator('.talk__line--them')).toHaveCount(1);
  await page.getByTestId('talk-where').click();
  await expect(page.getByTestId('talk').locator('.talk__line--them')).toHaveCount(2);
  await page.getByTestId('talk-input').fill('Hello there');
  await page.getByTestId('talk-send').click();
  await expect(page.getByTestId('talk').locator('.talk__line--them')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('clicking the island from above drops the visitor in at that spot; they cannot walk off the edge', async ({ page }) => {
  await open(page, '&hour=10');
  await expect(page.getByTestId('drop-hint')).toBeVisible();
  const target = await page.evaluate(() => {
    const w = (window as any).__morphis.sim.getState().world;
    const e = w.roads.edges.find((x: any) => x.cls === 'street' && Math.hypot(w.roads.nodes[x.a].x, w.roads.nodes[x.a].z) > 60);
    const a = w.roads.nodes[e.a];
    const b = w.roads.nodes[e.b];
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  });
  await page.waitForTimeout(1500);
  const scr = await page.evaluate((t) => (window as any).__morphis.project(t.x, 0, t.z), target);
  await page.mouse.click(scr.x, scr.y);
  await expect(page.getByTestId('guest-bar')).toBeVisible();
  const pos = await page.evaluate(() => ({ x: (window as any).__morphis.guestPose.x, z: (window as any).__morphis.guestPose.z }));
  expect(Math.hypot(pos.x - target.x, pos.z - target.z)).toBeLessThan(3);
  // put the visitor beyond the railing: the next step brings them back onto the island
  await page.evaluate(() => { const g = (window as any).__morphis.guestPose; g.x = 0; g.z = -400; });
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  const r = await page.evaluate(() => { const g = (window as any).__morphis.guestPose; return Math.hypot(g.x, g.z); });
  expect(r).toBeLessThan(175);
});
