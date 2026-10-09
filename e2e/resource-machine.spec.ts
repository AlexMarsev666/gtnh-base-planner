import { expect, test } from '@playwright/test';

test('manual resource machine survives roles, count changes, undo, reload and duplication', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('resource-machine-seeded')) return;
    localStorage.clear();
    const inputs = ['feed-a', 'feed-b', 'hydrogen'];
    const outputs = ['out-a', 'out-b'];
    const all = [...inputs, ...outputs];
    localStorage.setItem('gtnh-planner:mode', 'site');
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        size: [40, 30],
        corridor: 2,
        colors: {},
        routing: { mode: 'neat', depth: 3 },
        groups: [
          {
            id: 'crackers',
            multiblockId: 'oil-cracking-unit',
            count: 2,
            limits: { x: null, y: null, z: null },
            enabledHatches: ['energy', 'maintenance', 'fluidIn', 'fluidOut'],
            origin: [8, 8],
            rotation: 0,
            voltageTier: 'HV',
            crackingFeedSide: 'right',
            resourceBindings: inputs.map((resource) => ({
              kind: 'fluidIn',
              resource,
              role: resource === 'hydrogen' ? 'catalyst' : 'feed',
            })),
          },
        ],
        resources: Object.fromEntries(
          all.map((resource) => [resource, { kind: 'fluid', name: resource, color: '#123456' }]),
        ),
        ports: all.map((resource, i) => ({
          id: 'p' + i,
          resource,
          dir: inputs.includes(resource) ? 'in' : 'out',
          pos: [inputs.includes(resource) ? 0 : 39, 2 + 2 * i],
        })),
        links: all.map((resource, i) => ({
          id: 'l' + i,
          resource,
          from: inputs.includes(resource) ? { port: 'p' + i } : { group: 'crackers' },
          to: inputs.includes(resource) ? { group: 'crackers' } : { port: 'p' + i },
        })),
      }),
    );
    sessionStorage.setItem('resource-machine-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const machine = page
    .locator('label')
    .filter({ hasText: 'hydrogen · Machine' })
    .getByTestId('resource-machine');
  await machine.selectOption('1');
  const role = page
    .locator('label')
    .filter({ hasText: 'hydrogen · Resource role' })
    .getByTestId('resource-structural-role');
  await role.selectOption('catalyst');
  const count = page.getByTestId('site-group-count');
  await count.fill('1');
  await count.press('Enter');
  await expect(machine).toHaveValue('1');
  await expect(machine.locator('option:checked')).toContainText('unavailable (automatic)');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await page.getByTestId('site-undo').click();
  await expect(count).toHaveValue('2');
  await expect(machine).toHaveValue('1');
  await machine.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.tool-cache/plan-v3-stage2-resource-machines.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(machine).toHaveValue('1');
  await page.getByTestId('site-group-duplicate').click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups))
    .toMatchObject([
      {
        resourceBindings: expect.arrayContaining([
          expect.objectContaining({ resource: 'hydrogen', unitId: 1 }),
        ]),
      },
      {
        resourceBindings: expect.arrayContaining([
          expect.objectContaining({ resource: 'hydrogen', unitId: 1 }),
        ]),
      },
    ]);
  expect(errors).toEqual([]);
});
