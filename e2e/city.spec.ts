import { expect, test, type Page } from '@playwright/test';

/** Local-mode city (no server needed), low graphics for software WebGL in CI. */
async function open(page: Page, extra = '') {
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
