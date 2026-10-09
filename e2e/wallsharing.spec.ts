import { expect, test } from '@playwright/test';

const reference = {
  v: 2,
  kind: 'site',
  size: [32, 24],
  corridor: 2,
  colors: {},
  routing: { mode: 'neat', depth: 3 },
  groups: [
    {
      id: 'crackers',
      multiblockId: 'oil-cracking-unit',
      count: 2,
      limits: { x: 2, y: 1, z: 1 },
      limitsLocked: true,
      enabledHatches: ['fluidIn', 'fluidOut', 'energy', 'maintenance'],
      origin: [8, 8],
      rotation: 0,
      voltageTier: 'HV',
      wallsharing: 'side',
      resourceBindings: [
        { kind: 'fluidIn', resource: 'feed', role: 'feed', unitIds: [0, 1] },
        { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
      ],
    },
  ],
  resources: Object.fromEntries(
    ['feed', 'agent', 'product'].map((id) => [id, { kind: 'fluid', name: id, color: '#123456' }]),
  ),
  ports: [
    { id: 'feed', dir: 'in', resource: 'feed' },
    { id: 'agent', dir: 'in', resource: 'agent' },
    { id: 'product', dir: 'out', resource: 'product' },
  ],
  links: [
    { id: 'feed', from: { port: 'feed' }, to: { group: 'crackers' }, resource: 'feed' },
    { id: 'agent', from: { port: 'agent' }, to: { group: 'crackers' }, resource: 'agent' },
    { id: 'product', from: { group: 'crackers' }, to: { port: 'product' }, resource: 'product' },
  ],
};

for (const fallback of [false, true])
  test(`mirror and wallsharing preferences persist through ${fallback ? 'fallback' : 'worker'}, commands and undo`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(
      ({ reference, fallback }) => {
        if (fallback)
          window.Worker = class {
            constructor() {
              throw new Error('Worker blocked by test');
            }
          } as unknown as typeof Worker;
        if (sessionStorage.getItem('wallsharing-seeded')) return;
        localStorage.clear();
        localStorage.setItem('gtnh-planner:mode', 'site');
        localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(reference));
        sessionStorage.setItem('wallsharing-seeded', '1');
      },
      { reference, fallback },
    );
    await page.goto('/');
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-group').first().click();
    const stats = page.getByTestId('site-stats');
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    const variant = page.getByTestId('wallsharing-variant');
    const mirrors = page.getByTestId('unit-mirror');
    await expect(variant).toHaveValue('side');
    await expect(mirrors).toHaveCount(2);
    await mirrors.nth(1).selectOption('true');
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('site-problems')).toHaveCount(0);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!));
    await expect.poll(async () => (await stored()).groups[0].unitMirrors).toEqual({ '1': true });
    await variant.selectOption('stack');
    await expect(page.getByTestId('wallsharing-fallback')).toBeVisible();
    await expect.poll(async () => (await stored()).groups[0].wallsharing).toBe('stack');
    await page.getByTestId('site-undo').click();
    await expect(variant).toHaveValue('side');
    await page.getByTestId('site-redo').click();
    await expect(variant).toHaveValue('stack');
    await variant.selectOption('side');
    await expect.poll(async () => (await stored()).groups[0].wallsharing).toBe('side');
    const assignments = (await stored()).groups[0];
    await page.getByTestId('site-neat').click();
    await expect(page.getByRole('status')).toContainText('Neat:');
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    const next = (await stored()).groups[0];
    for (const field of ['unitMirrors', 'wallsharing', 'resourceBindings', 'voltageTier', 'limits'])
      expect(next[field]).toEqual(assignments[field]);
    await expect(page.getByTestId('site-problems')).toHaveCount(0);
    if (!fallback) await page.screenshot({ path: 'e2e/screenshots/stage3-wallsharing.png' });
    await page.reload();
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-group').first().click();
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByTestId('unit-mirror').nth(1)).toHaveValue('true');
    await expect(page.getByTestId('wallsharing-variant')).toHaveValue('side');
    if (!fallback) {
      await page.getByTestId('unit-mirror').nth(1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'e2e/screenshots/stage3-wallsharing-controls.png' });
    }
    expect(errors).toEqual([]);
  });
