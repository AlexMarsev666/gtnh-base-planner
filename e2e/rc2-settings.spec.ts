import { expect, test } from '@playwright/test';

test('Quantum Computer keeps computational interfaces, length and an independent resolver tier', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('computation-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'quantum-computer',
        count: 1,
        size: 5,
        limits: { x: null, y: 1, z: null },
        colors: {},
        voltageTier: 'LV',
        enabledHatches: ['energy', 'maintenance', 'computationOut', 'uncertainty', 'computerRack'],
      }),
    );
    sessionStorage.setItem('computation-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const resolver = page
    .locator('label.hatch-setting')
    .filter({ hasText: 'Uncertainty Resolver' })
    .locator('select');
  await expect(resolver.locator('option')).toHaveText(['Default (IV)', 'IV', 'ZPM']);
  await resolver.selectOption('ZPM');
  await page.getByTestId('hatch-computationOut').click();
  await page.getByTestId('hatch-wirelessComputationOut').click();
  await page.getByTestId('hatch-wirelessComputationIn').click();
  await page.getByTestId('size').fill('16');
  await page.getByTestId('size').press('Enter');
  await expect(resolver).toHaveValue('ZPM');
  await resolver.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-computation-plan.png' });
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const siteResolver = page
    .getByTestId('individual-hatches')
    .locator('label')
    .filter({ hasText: 'Uncertainty Resolver' })
    .locator('select');
  await expect(siteResolver).toHaveValue('ZPM');
  await siteResolver.selectOption('IV');
  await page.getByTestId('site-group-rotate').click();
  await expect(siteResolver).toHaveValue('IV');
  await siteResolver.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-computation-site.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(siteResolver).toHaveValue('IV');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0]))
    .toMatchObject({
      size: 16,
      rotation: 1,
      enabledHatches: expect.arrayContaining([
        'wirelessComputationIn',
        'wirelessComputationOut',
        'computerRack',
      ]),
    });
  expect(errors).toEqual([]);
});

test('Arc Furnace retains operating, additional and recipe item roles after rotation and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('arc-furnace-site-seeded')) return;
    localStorage.clear();
    const resources = Object.fromEntries(
      ['working', 'reserve', 'ore', 'product'].map((key) => [
        key,
        { kind: 'item', name: key, color: '#bc9b63' },
      ]),
    );
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        name: 'Industrial Arc Furnace',
        size: [64, 64],
        corridor: 2,
        colors: {},
        resources,
        groups: [
          {
            id: 'arc',
            multiblockId: 'industrial-arc-furnace',
            count: 1,
            origin: [16, 14],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            voltageTier: 'IV',
            enabledHatches: ['energy', 'maintenance', 'electrodeIn', 'electrodeDetector'],
          },
        ],
        ports: [
          { id: 'working', dir: 'in', resource: 'working', pos: [0, 6] },
          { id: 'reserve', dir: 'in', resource: 'reserve', pos: [0, 18] },
          { id: 'ore', dir: 'in', resource: 'ore', pos: [0, 30] },
          { id: 'product', dir: 'out', resource: 'product', pos: [63, 42] },
        ],
        links: [
          ...['working', 'reserve', 'ore'].map((resource) => ({
            id: resource,
            resource,
            from: { port: resource },
            to: { group: 'arc' },
          })),
          { id: 'product', resource: 'product', from: { group: 'arc' }, to: { port: 'product' } },
        ],
      }),
    );
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('arc-furnace-site-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('site-problems')).toBeVisible();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await page.getByTestId('locked-item-input').nth(0).selectOption('electrodeIn');
  await page.getByTestId('locked-item-input').nth(1).selectOption('electrodeBus');
  await page.getByTestId('locked-item-input').nth(2).selectOption('itemIn');
  await expect(page.getByTestId('site-stats')).toContainText('8/8 connected');
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await page.getByTestId('site-group-rotate').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(page.getByTestId('site-stats')).toContainText('8/8 connected');
  await page.getByTestId('locked-item-input').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-arc-furnace-resources.png' });
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('8/8 connected');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0]))
    .toMatchObject({
      resourceBindings: [
        { resource: 'working', kind: 'electrodeIn' },
        { resource: 'reserve', kind: 'electrodeBus' },
        { resource: 'ore', kind: 'itemIn' },
      ],
      enabledHatches: expect.arrayContaining(['electrodeDetector']),
      rotation: 1,
    });
  expect(errors).toEqual([]);
});

test('Water Pump keeps uniform steel frames and an individual output tier across both views', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('water-pump-plan-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'water-pump',
        count: 1,
        limits: { x: null, y: 1, z: null },
        colors: {},
        voltageTier: 'LV',
        enabledHatches: ['steamIn', 'fluidOut'],
      }),
    );
    sessionStorage.setItem('water-pump-plan-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('steam-frame-tier')).toHaveValue('bronze');
  await page.getByTestId('steam-frame-tier').selectOption('steel');
  const output = page.locator('label.hatch-setting').filter({ hasText: 'Fluid out' }).locator('select');
  await output.selectOption('HV');
  await expect(output).toHaveValue('HV');
  await page.screenshot({ path: 'e2e/screenshots/rc2-water-pump-plan.png' });
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('steam-frame-tier')).toHaveValue('steel');
  await page.getByTestId('site-group-rotate').click();
  await page.getByTestId('steam-frame-tier').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-water-pump-site.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('steam-frame-tier')).toHaveValue('steel');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0]))
    .toMatchObject({ steamFrameTier: 'steel', hatchTiers: { '[0,"fluidOut",null,0]': 'HV' } });
  expect(errors).toEqual([]);
});

test('Water Pump manual fluids require Steam and Water roles, saved with the original links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('water-pump-site-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        name: 'Water Pump',
        size: [32, 32],
        corridor: 2,
        colors: {},
        groups: [
          {
            id: 'pump',
            multiblockId: 'water-pump',
            count: 1,
            origin: [8, 8],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            enabledHatches: ['steamIn', 'fluidOut'],
            voltageTier: 'LV',
            steamFrameTier: 'steel',
          },
        ],
        resources: {
          feed: { kind: 'fluid', name: 'Manual steam', color: '#aaaaaa' },
          product: { kind: 'fluid', name: 'Manual water', color: '#3388ff' },
        },
        ports: [
          { id: 'in', dir: 'in', resource: 'feed', pos: [0, 6] },
          { id: 'out', dir: 'out', resource: 'product', pos: [0, 22] },
        ],
        links: [
          { id: 'feed', resource: 'feed', from: { port: 'in' }, to: { group: 'pump' } },
          { id: 'water', resource: 'product', from: { group: 'pump' }, to: { port: 'out' } },
        ],
      }),
    );
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('water-pump-site-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('site-problems')).toBeVisible();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await page.getByTestId('locked-fluid-input').selectOption('steamIn');
  await page.getByTestId('fixed-fluid-output-role').selectOption('water');
  await expect(page.getByTestId('site-stats')).toContainText('4/4 connected');
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/rc2-water-pump-resources.png' });
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('4/4 connected');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!)))
    .toMatchObject({
      groups: [
        {
          resourceBindings: [
            { resource: 'feed', kind: 'steamIn' },
            { resource: 'product', kind: 'fluidOut', role: 'water' },
          ],
        },
      ],
      links: [{ id: 'feed' }, { id: 'water' }],
    });
  expect(errors).toEqual([]);
});

test('Source Chamber routes a fluid input and its mandatory bottom bus without retaining a phantom item input', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('source-chamber-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        name: 'Source Chamber',
        size: [32, 32],
        corridor: 2,
        colors: {},
        groups: [
          {
            id: 'source',
            multiblockId: 'source-chamber',
            count: 1,
            origin: [8, 8],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            enabledHatches: ['itemOut', 'energy', 'maintenance'],
            voltageTier: 'LV',
          },
        ],
        resources: {
          feed: { kind: 'fluid', name: 'Source fluid', color: '#33aaee' },
          spent: { kind: 'item', name: 'Source waste', color: '#dd8833' },
        },
        ports: [
          { id: 'in', dir: 'in', resource: 'feed', pos: [0, 6] },
          { id: 'out', dir: 'out', resource: 'spent', pos: [0, 22] },
        ],
        links: [
          { id: 'feed', resource: 'feed', from: { port: 'in' }, to: { group: 'source' } },
          { id: 'waste', resource: 'spent', from: { group: 'source' }, to: { port: 'out' } },
        ],
      }),
    );
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('source-chamber-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('site-stats')).toContainText('4/4 connected');
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('individual-hatches')).toContainText('Fluid in');
  await expect(page.getByTestId('individual-hatches')).toContainText('Item out');
  await expect(page.getByTestId('individual-hatches')).not.toContainText('Item in');
  await page.screenshot({ path: 'e2e/screenshots/rc2-source-chamber.png' });
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('4/4 connected');
  expect(errors).toEqual([]);
});

test('Linear Accelerator preserves the old default and saves a long source-defined structure in both views', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('linac-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'linear-accelerator',
        count: 1,
        limits: { x: 1, y: 1, z: 1 },
        enabledHatches: ['fluidIn', 'fluidOut', 'energy', 'maintenance'],
        colors: {},
        voltageTier: 'LV',
        structureGlassTier: 'LuV',
      }),
    );
    sessionStorage.setItem('linac-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const length = page.getByTestId('size');
  await expect(length).toHaveValue('19');
  await length.fill('135');
  await length.press('Enter');
  await expect(length).toHaveValue('135');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:v1')!).size))
    .toBe(135);
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(length).toHaveValue('135');
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('structure-glass-tier')).toHaveValue('LuV');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].size))
    .toBe(135);
  await page.getByTestId('site-group-editor').getByRole('button', { name: 'Frame', exact: true }).click();
  await page.screenshot({ path: 'e2e/screenshots/rc2-linear-accelerator.png' });
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  expect(errors).toEqual([]);
});

for (const [id, kind] of [
  ['cryogenic-freezer', 'cryotheumIn'],
  ['volcanus', 'pyrotheumIn'],
] as const) {
  test(`${id}: chooses a locked coolant interface separately from recipe feed and retains it`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ id, kind }) => {
        if (sessionStorage.getItem('locked-fluid-seeded')) return;
        localStorage.clear();
        localStorage.setItem(
          'gtnh-planner:site:v1',
          JSON.stringify({
            v: 2,
            kind: 'site',
            name: id,
            size: [32, 32],
            corridor: 2,
            colors: {},
            routing: { mode: 'neat', depth: 3 },
            groups: [
              {
                id: 'machine',
                multiblockId: id,
                count: 1,
                origin: [8, 8],
                rotation: 0,
                limits: { x: 1, y: 1, z: 1 },
                enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance', 'muffler', kind],
                voltageTier: 'LV',
              },
            ],
            resources: {
              coolant: { kind: 'fluid', name: 'Custom coolant', color: '#abcdef' },
              feed: { kind: 'fluid', name: 'Recipe feed', color: '#123456' },
            },
            ports: [
              { id: 'coolant-port', dir: 'in', resource: 'coolant', pos: [0, 5] },
              { id: 'feed-port', dir: 'in', resource: 'feed', pos: [0, 20] },
            ],
            links: [
              {
                id: 'coolant-link',
                resource: 'coolant',
                from: { port: 'coolant-port' },
                to: { group: 'machine' },
              },
              { id: 'feed-link', resource: 'feed', from: { port: 'feed-port' }, to: { group: 'machine' } },
            ],
          }),
        );
        localStorage.setItem('gtnh-planner:mode', 'site');
        sessionStorage.setItem('locked-fluid-seeded', '1');
      },
      { id, kind },
    );
    await page.goto('/');
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-group').first().click();
    const coolant = page.getByRole('combobox', { name: 'Custom coolant · Resource role' });
    const feed = page.getByRole('combobox', { name: 'Recipe feed · Resource role' });
    await expect(coolant).toHaveValue('');
    await coolant.selectOption(kind);
    await feed.selectOption('fluidIn');
    await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await expect(page.getByTestId('site-problems')).toHaveCount(0);
    await coolant.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `e2e/screenshots/rc2-${id}-locked-fluid.png` });
    await page.reload();
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-group').first().click();
    await expect(coolant).toHaveValue(kind);
    await expect(feed).toHaveValue('fluidIn');
    expect(errors).toEqual([]);
  });
}

test('changes Beam Mirror between exact T1 and T2 forms and keeps T2 after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('beam-mirror-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'beam-mirror',
        count: 1,
        limits: { x: 1, y: 1, z: 1 },
        enabledHatches: [],
        colors: {},
        voltageTier: 'LV',
      }),
    );
    sessionStorage.setItem('beam-mirror-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('multiblock-name')).toHaveText(/Beam Mirror/i);
  await page.getByTestId('settings-toggle').click();
  const height = page.getByTestId('size');
  await expect(height).toHaveValue('5');
  await height.fill('6');
  await height.press('Enter');
  await expect(height).toHaveValue('6');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:v1')!).size))
    .toBe(6);
  await page.screenshot({ path: 'e2e/screenshots/rc2-beam-mirror-t2.png' });
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(height).toHaveValue('6');
  await height.fill('5');
  await height.press('Enter');
  await expect(height).toHaveValue('5');
  expect(errors).toEqual([]);
});

test('assigns the five dedicated HTGCR fluid roles and preserves them after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('htgr-seeded')) return;
    localStorage.clear();
    const resources = ['helium', 'coolant', 'water', 'hotCoolant', 'steam'];
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        name: 'HTGCR',
        size: [64, 64],
        corridor: 2,
        colors: {},
        routing: { mode: 'neat', depth: 3 },
        groups: [
          {
            id: 'reactor',
            multiblockId: 'high-temperature-gas-cooled-reactor',
            count: 1,
            origin: [8, 8],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            voltageTier: 'LV',
            enabledHatches: ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'energy', 'maintenance'],
          },
        ],
        ports: resources.map((resource, i) => ({
          id: `port-${i}`,
          resource,
          dir: i < 3 ? 'in' : 'out',
          pos: [i < 3 ? 0 : 63, 10 + i * 7],
        })),
        links: resources.map((resource, i) => ({
          id: `link-${i}`,
          resource,
          from: i < 3 ? { port: `port-${i}` } : { group: 'reactor' },
          to: i < 3 ? { group: 'reactor' } : { port: `port-${i}` },
        })),
        resources: Object.fromEntries(
          resources.map((name, i) => [
            name,
            { kind: 'fluid', name, color: ['#456789', '#987654', '#234567', '#765432', '#abc123'][i] },
          ]),
        ),
      }),
    );
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('htgr-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const roles = [
    ['helium', 'helium'],
    ['coolant', 'coolant'],
    ['water', 'water'],
    ['hotCoolant', 'hotFluid'],
    ['steam', 'steam'],
  ];
  const selector = (name: string) =>
    page.getByRole('combobox', { name: `${name} · Resource role`, exact: true });
  await expect(page.getByTestId('resource-structural-role')).toHaveCount(5);
  for (const [resource, role] of roles) await selector(resource).selectOption(role);
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await selector('helium').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-htgr-roles.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  for (const [resource, role] of roles) await expect(selector(resource)).toHaveValue(role);
  expect(errors).toEqual([]);
});

test('keeps Target Chamber mask and ordinary input roles with LuV glass after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('target-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:site:v1',
      JSON.stringify({
        v: 2,
        kind: 'site',
        name: 'Target Chamber',
        size: [32, 32],
        corridor: 2,
        routing: { mode: 'neat', depth: 3 },
        colors: {},
        groups: [
          {
            id: 'target',
            multiblockId: 'target-chamber',
            count: 1,
            origin: [8, 8],
            rotation: 0,
            limits: { x: 1, y: 1, z: 1 },
            voltageTier: 'LuV',
            structureGlassTier: 'LuV',
            enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance'],
          },
        ],
        ports: [
          { id: 'mask', dir: 'in', pos: [0, 8], resource: 'mask' },
          { id: 'feed', dir: 'in', pos: [31, 12], resource: 'feed' },
        ],
        links: [
          { id: 'mask', from: { port: 'mask' }, to: { group: 'target' }, resource: 'mask' },
          { id: 'feed', from: { port: 'feed' }, to: { group: 'target' }, resource: 'feed' },
        ],
        resources: {
          mask: { kind: 'item', name: 'Photolithographic mask', color: '#345678' },
          feed: { kind: 'item', name: 'Wafer', color: '#987654' },
        },
      }),
    );
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('target-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const mask = page.getByRole('combobox', { name: /^Photolithographic mask · Resource role/ });
  const feed = page.getByRole('combobox', { name: /^Wafer · Resource role/ });
  await mask.selectOption('mask');
  await feed.selectOption('feed');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await expect(page.getByTestId('structure-glass-tier')).toHaveValue('LuV');
  await mask.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-target-chamber.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(mask).toHaveValue('mask');
  await expect(feed).toHaveValue('feed');
  await expect(page.getByTestId('structure-glass-tier')).toHaveValue('LuV');
  expect(errors).toEqual([]);
});

test('chooses dedicated heat exchanger resource roles and preserves them after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = {
    v: 2,
    kind: 'site',
    name: 'Dedicated heat exchanger',
    size: [48, 48],
    corridor: 2,
    routing: { mode: 'neat', depth: 3 },
    groups: [
      {
        id: 'ehe',
        multiblockId: 'extreme-heat-exchanger',
        count: 1,
        origin: [8, 8],
        rotation: 0,
        limits: { x: 1, y: 1, z: 1 },
        enabledHatches: ['maintenance', 'fluidIn', 'fluidOut'],
        voltageTier: 'LV',
      },
    ],
    ports: [
      { id: 'hot', dir: 'in', pos: [0, 10], resource: 'hot' },
      { id: 'water', dir: 'in', pos: [0, 15], resource: 'water' },
      { id: 'cooled', dir: 'out', pos: [47, 10], resource: 'cooled' },
      { id: 'steam', dir: 'out', pos: [47, 15], resource: 'steam' },
    ],
    links: [
      { id: 'hot', from: { port: 'hot' }, to: { group: 'ehe' }, resource: 'hot' },
      { id: 'water', from: { port: 'water' }, to: { group: 'ehe' }, resource: 'water' },
      { id: 'cooled', from: { group: 'ehe' }, to: { port: 'cooled' }, resource: 'cooled' },
      { id: 'steam', from: { group: 'ehe' }, to: { port: 'steam' }, resource: 'steam' },
    ],
    resources: {
      hot: { kind: 'fluid', name: 'Hot salt', color: '#a65432' },
      water: { kind: 'fluid', name: 'Water', color: '#234567' },
      cooled: { kind: 'fluid', name: 'Cooled salt', color: '#456789' },
      steam: { kind: 'fluid', name: 'Steam', color: '#765432' },
    },
    colors: {},
  };
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem('dedicated-seeded')) return;
    localStorage.clear();
    localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(saved));
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('dedicated-seeded', '1');
  }, initial);
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const roles = page.getByTestId('resource-structural-role');
  await expect(roles).toHaveCount(4);
  const roleFor = (name: string) =>
    page
      .getByTestId('site-group-editor')
      .getByRole('combobox', { name: new RegExp(`^${name} · Resource role`) });
  for (const [name, role] of [
    ['Hot salt', 'hotFluid'],
    ['Water', 'water'],
    ['Cooled salt', 'coldFluid'],
    ['Steam', 'steam'],
  ])
    await roleFor(name).selectOption(role);
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await roleFor('Hot salt').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-dedicated-hatch-roles.png' });
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].resourceBindings?.length,
      ),
    )
    .toBe(4);
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(roleFor('Hot salt')).toHaveValue('hotFluid');
  await expect(roleFor('Cooled salt')).toHaveValue('coldFluid');
  expect(errors).toEqual([]);
});

test('Assembly Line exposes every mandatory bus and retains its tier through resize, rotation and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('assembly-buses-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'assembly-line',
        count: 1,
        size: 5,
        limits: { x: null, y: 1, z: null },
        enabledHatches: ['energy', 'maintenance', 'itemIn', 'itemOut', 'fluidIn'],
        voltageTier: 'LV',
        colors: {},
      }),
    );
    sessionStorage.setItem('assembly-buses-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const buses = page.locator('label.hatch-setting').filter({ hasText: 'Item in' }).locator('select');
  await expect(buses).toHaveCount(5);
  await buses.nth(2).selectOption('EV');
  await page.getByTestId('size').fill('9');
  await page.getByTestId('size').press('Enter');
  await expect(buses).toHaveCount(9);
  await expect(buses.filter({ has: page.locator('option:checked[value="EV"]') })).toHaveCount(1);
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const siteBuses = page
    .getByTestId('individual-hatches')
    .locator('label')
    .filter({ hasText: 'Item in' })
    .locator('select');
  await expect(siteBuses).toHaveCount(9);
  await page.getByTestId('site-group-rotate').click();
  await expect(siteBuses.filter({ has: page.locator('option:checked[value="EV"]') })).toHaveCount(1);
  await siteBuses.filter({ has: page.locator('option:checked[value="EV"]') }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-assembly-line-buses.png' });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].hatchTiers),
      ),
    )
    .toEqual(['EV']);
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(siteBuses).toHaveCount(9);
  await expect(siteBuses.filter({ has: page.locator('option:checked[value="EV"]') })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('new component line chooses UV glass while legacy JSON keeps its original glass and reports the minimum', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('glass-minimum-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 1,
        multiblockId: 'component-assembly-line',
        count: 1,
        colors: {},
        limits: { x: null, y: 1, z: null },
        enabledHatches: ['energy', 'maintenance', 'itemIn', 'itemOut'],
        voltageTier: 'UHV',
      }),
    );
    sessionStorage.setItem('glass-minimum-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-structure-glass-tier')).toHaveValue('');
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.getByTestId('site-problems').click();
  await expect(page.getByTestId('site-panel')).toContainText('RC2 requires at least UV');
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('structure-glass-tier')).toHaveValue('');
  await page.getByTestId('structure-glass-tier').selectOption('UV');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/screenshots/rc2-minimum-glass.png' });
  // Select a new mechanism through the normal picker, which initializes its required glass.
  await page.getByTestId('mode-machine').click();
  await page.getByTestId('multiblock-name').click();
  await page.getByTestId('picker').getByRole('searchbox').fill('precise-auto-assembler-mt-3662');
  await page.getByTestId('picker-item').click();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-structure-glass-tier')).toHaveValue('EV');
  await page.getByTestId('multiblock-name').click();
  await page.getByTestId('picker').getByRole('searchbox').fill('Component Assembly Line');
  await page.getByTestId('picker-item').click();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-structure-glass-tier')).toHaveValue('UV');
  expect(errors).toEqual([]);
});

test('selects stronger structure glass, retains it after reload and validates an explicit downgrade', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('glass-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'algae-farm',
        count: 1,
        colors: {},
        limits: { x: null, y: 1, z: null },
        enabledHatches: ['energy', 'maintenance', 'itemIn', 'itemOut'],
        voltageTier: 'EV',
      }),
    );
    sessionStorage.setItem('glass-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-structure-glass-tier').locator('option')).toHaveCount(12);
  await page.getByTestId('plan-structure-glass-tier').selectOption('EV');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:v1')!).structureGlassTier))
    .toBe('EV');
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-structure-glass-tier')).toHaveValue('EV');
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('structure-glass-tier')).toHaveValue('EV');
  await page.getByTestId('structure-glass-tier').selectOption('HV');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toBeVisible();
  await page.getByTestId('structure-glass-tier').selectOption('IV');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('gtnh-planner:site:v1') ?? 'null')?.groups?.[0]?.structureGlassTier,
      ),
    )
    .toBe('IV');
  await page.screenshot({ path: 'e2e/screenshots/rc2-structure-glass.png' });
  expect(errors).toEqual([]);
});

test('sets Manual Transformer winding height and direct mode, retains them in the template and after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('manual-trafo-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'manual-transformer',
        count: 1,
        limits: { x: null, y: 1, z: null },
        colors: {},
        enabledHatches: ['energy', 'dynamo', 'maintenance'],
        voltageTier: 'EV',
      }),
    );
    sessionStorage.setItem('manual-trafo-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('multiblock-name')).toHaveText(/Manual Transformer/i);
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('size').fill('5');
  await page.getByTestId('size').press('Enter');
  await page.getByTestId('plan-manual-transformer-mode').selectOption('down');
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('manual-transformer-mode')).toHaveValue('down');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByTestId('site-problems')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /Dynamo/ }).locator('option:checked')).toHaveText(
    'Follow machine tier (LV)',
  );
  await page.screenshot({ path: 'e2e/screenshots/rc2-manual-transformer.png' });
  await page.getByTestId('manual-transformer-mode').selectOption('up');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: /Dynamo/ }).locator('option:checked')).toHaveText(
    'Follow machine tier (ZPM)',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].manualTransformerMode,
      ),
    )
    .toBe('up');
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('manual-transformer-mode')).toHaveValue('up');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].size))
    .toBe(5);
  expect(errors).toEqual([]);
});

const site = {
  v: 2,
  kind: 'site',
  name: 'RC2 settings',
  size: [48, 48],
  corridor: 2,
  routing: { mode: 'neat', depth: 3 },
  groups: [
    {
      id: 'single',
      multiblockId: 'single-block',
      machine: 'assembler',
      count: 1,
      origin: [8, 8],
      rotation: 0,
      limits: { x: null, y: 1, z: null },
      enabledHatches: [],
      voltageTier: 'LV',
    },
    {
      id: 'furnace',
      multiblockId: 'electric-blast-furnace',
      count: 2,
      origin: [16, 8],
      rotation: 0,
      limits: { x: null, y: 1, z: null },
      enabledHatches: ['energy', 'maintenance', 'muffler'],
      voltageTier: 'LV',
    },
    {
      id: 'chemical',
      multiblockId: 'large-chemical-reactor',
      count: 1,
      origin: [8, 16],
      rotation: 0,
      limits: { x: null, y: 1, z: null },
      enabledHatches: ['energy', 'maintenance'],
      voltageTier: 'LV',
    },
  ],
  ports: [{ id: 'in', dir: 'in', pos: [0, 10], resource: 'ore' }],
  links: [{ id: 'input', from: { port: 'in' }, to: { group: 'furnace' }, resource: 'ore' }],
  resources: { ore: { kind: 'item', name: 'Ore', color: '#785634' } },
  colors: {},
};

test('edits machine variants, individual hatches, transformers and underground routing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((initial) => {
    if (sessionStorage.getItem('rc2-seeded')) return;
    localStorage.clear();
    localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(initial));
    localStorage.setItem('gtnh-planner:mode', 'site');
    sessionStorage.setItem('rc2-seeded', '1');
  }, site);
  await page.goto('/');
  await expect(page.getByTestId('site-stats')).toContainText('3 groups');
  await page.getByTestId('site-panel-toggle').click();
  const panel = page.getByTestId('site-panel');
  await panel.getByTestId('site-group').nth(0).click();
  await page.getByTestId('single-machine-search').fill('macerator');
  await page.getByTestId('single-machine-select').selectOption('macerator');
  await page.getByTestId('machine-voltage-tier').selectOption('MV');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.screenshot({ path: 'e2e/screenshots/rc2-machine-variant.png' });

  await panel.getByTestId('site-group').nth(1).click();
  const hatches = page.getByTestId('individual-hatch-tier');
  await expect(hatches.first()).toBeVisible();
  await hatches.first().selectOption('HV');
  await page.getByTestId('site-group-rotate').click();
  await expect(hatches.filter({ has: page.locator('option:checked[value="HV"]') })).toHaveCount(1);
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.screenshot({ path: 'e2e/screenshots/rc2-individual-hatch.png' });

  await page.getByTestId('add-transformer').click();
  await expect(page.getByTestId('transformer-tier')).toBeVisible();
  await page.getByTestId('transformer-tier').selectOption('HV');
  await page.getByTestId('transformer-mode').selectOption('up');
  await page.getByTestId('transformer-facing').selectOption('down');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.screenshot({ path: 'e2e/screenshots/rc2-transformer.png' });
  const previousRequest = Number(await page.getByTestId('site-stats').getAttribute('data-request-id'));
  await page.getByTestId('routing-depth').fill('6');
  await page.getByTestId('routing-depth').press('Enter');
  await page.getByTestId('underground-view').click();
  await expect(page.getByTestId('underground-view')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => Number(await page.getByTestId('site-stats').getAttribute('data-request-id')))
    .toBeGreaterThan(previousRequest);
  await expect(page.getByTestId('site-stats')).toHaveAttribute('data-pending', 'false');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.screenshot({ path: 'e2e/screenshots/rc2-underground.png' });

  // Persistence retains logical assignments and all transformer fields, without automatic placement.
  await expect
    .poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).routing.depth),
    )
    .toBe(6);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!));
  expect(saved.v).toBe(2);
  expect(saved.groups[0]).toMatchObject({ machine: 'macerator', voltageTier: 'MV' });
  expect(Object.values(saved.groups[1].hatchTiers)).toContain('HV');
  expect(saved.groups[3].transformer).toEqual({ lowTier: 'HV', mode: 'up', facing: 'down' });
  await page.reload();
  // Cold routing at depth six can exceed the default assertion timeout while other browsers build imports.
  await expect(page.getByTestId('site-stats')).toContainText('4 groups', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('assigns Mega Oil Cracker fluid roles and reverses its side zones', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const initial = {
    ...site,
    groups: [{ ...site.groups[2], id: 'cracker', multiblockId: 'mega-oil-cracker', voltageTier: 'HV' }],
    ports: [
      { id: 'oil-in', dir: 'in', resource: 'oil', pos: [0, 8] },
      { id: 'agent-in', dir: 'in', resource: 'agent', pos: [0, 12] },
      { id: 'product-out', dir: 'out', resource: 'product', pos: [47, 8] },
    ],
    links: [
      { id: 'feed', from: { port: 'oil-in' }, to: { group: 'cracker' }, resource: 'oil' },
      { id: 'agent', from: { port: 'agent-in' }, to: { group: 'cracker' }, resource: 'agent' },
      { id: 'product', from: { group: 'cracker' }, to: { port: 'product-out' }, resource: 'product' },
    ],
    resources: {
      oil: { kind: 'fluid', name: 'Hydrocarbon', color: '#675d43' },
      agent: { kind: 'fluid', name: 'Hydrogen', color: '#6481b3' },
      product: { kind: 'fluid', name: 'Product', color: '#72523b' },
    },
  };
  await page.addInitScript((value) => {
    localStorage.clear();
    localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(value));
    localStorage.setItem('gtnh-planner:mode', 'site');
  }, initial);
  await page.goto('/');
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await page.getByRole('combobox', { name: 'Hydrocarbon · Resource role', exact: true }).selectOption('feed');
  await page
    .getByRole('combobox', { name: 'Hydrogen · Resource role', exact: true })
    .selectOption('catalyst');
  const previous = Number(await page.getByTestId('site-stats').getAttribute('data-request-id'));
  await page.getByTestId('cracking-feed-side').selectOption('left');
  await expect
    .poll(async () => Number(await page.getByTestId('site-stats').getAttribute('data-request-id')))
    .toBeGreaterThan(previous);
  await expect(page.getByTestId('site-stats')).toHaveAttribute('data-pending', 'false');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].crackingFeedSide,
      ),
    )
    .toBe('left');
  const group = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0],
  );
  expect(group.resourceBindings).toEqual([
    { kind: 'fluidIn', resource: 'oil', role: 'feed' },
    { kind: 'fluidIn', resource: 'agent', role: 'catalyst' },
  ]);
  await page.screenshot({ path: 'e2e/screenshots/rc2-mega-cracking-roles.png' });
  expect(errors).toEqual([]);
});

for (const [id, height, lastSlot] of [
  ['distillation-tower', 5, 3],
  ['mega-distillation-tower', 36, 4],
] as const) {
  test(`edits separate ${id} output slots containing the same fluid`, async ({ page }) => {
    const initial = {
      ...site,
      groups: [{ ...site.groups[2], id: 'tower', multiblockId: id, size: height }],
      ports: [{ id: 'out', dir: 'out', resource: 'fluid' }],
      links: [{ id: 'output', from: { group: 'tower' }, to: { port: 'out' }, resource: 'fluid' }],
      resources: { fluid: { kind: 'fluid', name: 'Repeated fluid', color: '#547896' } },
    };
    await page.addInitScript((value) => {
      localStorage.clear();
      localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(value));
      localStorage.setItem('gtnh-planner:mode', 'site');
    }, initial);
    await page.goto('/');
    await expect(page.getByTestId('site-stats')).toContainText('1 group');
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-group').first().click();
    const slots = page.getByTestId('resource-structural-role');
    await expect(slots).toHaveCount(1);
    await slots.first().selectOption('0');
    await expect(slots.first()).toHaveValue('0');
    await page.getByRole('button', { name: /Add another output slot/ }).click();
    await expect(slots).toHaveCount(2);
    // Labels count layers from 1; recipe slot values start at 0. Select by value explicitly.
    await slots.nth(1).selectOption({ value: String(lastSlot) });
    await expect(slots.first()).toHaveValue('0');
    await expect(slots.nth(1)).toHaveValue(String(lastSlot));
    await expect
      .poll(async () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0].resourceBindings,
        ),
      )
      .toEqual([
        { kind: 'fluidOut', resource: 'fluid', role: 'product', outputSlot: 0 },
        { kind: 'fluidOut', resource: 'fluid', role: 'product', outputSlot: lastSlot },
      ]);
    await expect(slots.first().locator('option')).toHaveCount(lastSlot + 2); // Slots plus the unresolved option.
    await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
    await page.screenshot({ path: `e2e/screenshots/rc2-${id}-slots.png` });
  });
}

test('Data Bank preserves fixed recipe connectors and its controller wireless switch in both modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('data-bank-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'data-bank',
        count: 1,
        limits: { x: null, y: 1, z: null },
        colors: {},
        voltageTier: 'LuV',
        enabledHatches: ['energy', 'maintenance', 'dataAccess', 'assemblyDataOut'],
      }),
    );
    sessionStorage.setItem('data-bank-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const wireless = page.getByTestId('data-bank-wireless');
  await expect(wireless).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('hatch-dataAccess').click();
  await page.getByTestId('hatch-assemblyDataIn').click();
  await page.getByTestId('hatch-assemblyDataOut').click();
  await page.getByTestId('hatch-wirelessAssemblyDataOut').click();
  await wireless.click();
  await expect(wireless).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'e2e/screenshots/rc2-data-bank-plan.png' });
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(wireless).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('site-hatch-assemblyDataIn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('site-hatch-wirelessAssemblyDataOut')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('site-group-rotate').click();
  await expect(wireless).toHaveAttribute('aria-pressed', 'true');
  await wireless.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-data-bank-site.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(wireless).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('site-hatch-wirelessAssemblyDataOut')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(errors).toEqual([]);
});

test('Data Access exposes only registered tiers and preserves its optional service assignment', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('data-access-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'advanced-assembly-line',
        count: 1,
        size: 5,
        limits: { x: null, y: 1, z: null },
        colors: {},
        enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance'],
      }),
    );
    sessionStorage.setItem('data-access-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const toggle = page.getByTestId('hatch-dataAccess');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const data = page.locator('label.hatch-setting').filter({ hasText: 'Data Access' }).locator('select');
  await expect(data).toHaveCount(0);
  await toggle.click();
  await expect(data).toHaveCount(1);
  await expect(data.locator('option')).toHaveText(['Default (EV)', 'EV', 'LuV', 'UV']);
  await data.selectOption('LuV');
  await page.getByTestId('size').fill('16');
  await page.getByTestId('size').press('Enter');
  await expect(data).toHaveValue('LuV');
  await data.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-data-access-plan.png' });
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  const siteData = page
    .getByTestId('individual-hatches')
    .locator('label')
    .filter({ hasText: 'Data Access' })
    .locator('select');
  await expect(siteData).toHaveValue('LuV');
  await siteData.selectOption('UV');
  await page.getByTestId('site-group-rotate').click();
  await expect(siteData).toHaveValue('UV');
  await siteData.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-data-access-site.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(siteData).toHaveValue('UV');
  expect(errors).toEqual([]);
});

test('Circuit Assembly Line preserves length, growth, glass and individual output tier in both views', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('circuit-line-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'circuit-assembly-line',
        count: 1,
        limits: { x: null, y: 1, z: null },
        colors: {},
        voltageTier: 'LV',
        structureGlassTier: 'EV',
        enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance'],
      }),
    );
    sessionStorage.setItem('circuit-line-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('size')).toHaveValue('2');
  await page.getByTestId('size').fill('7');
  await page.getByTestId('size').press('Enter');
  const output = page.locator('label.hatch-setting').filter({ hasText: 'Item out' }).locator('select');
  await output.selectOption('MV');
  await page.getByTestId('assembly-growth').selectOption('right');
  await page.getByTestId('plan-structure-glass-tier').selectOption('HV');
  await expect(output).toHaveValue('MV');
  await page.screenshot({ path: 'e2e/screenshots/rc2-circuit-assembly-line-plan.png' });
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('assembly-growth')).toHaveValue('right');
  await page.getByTestId('site-group-rotate').click();
  await page.getByTestId('assembly-growth').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/rc2-circuit-assembly-line-site.png' });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-group').first().click();
  await expect(page.getByTestId('assembly-growth')).toHaveValue('right');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups[0]))
    .toMatchObject({ size: 7, assemblyGrowth: 'right', structureGlassTier: 'HV' });
  expect(errors).toEqual([]);
});

test('Advanced Assembly Line preserves implicit length and keeps its terminating output after resize', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('advanced-line-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'advanced-assembly-line',
        count: 1,
        limits: { x: null, y: 1, z: null },
        colors: {},
        voltageTier: 'LV',
        enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance'],
      }),
    );
    sessionStorage.setItem('advanced-line-seeded', '1');
  });
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('size')).toHaveValue('5');
  const inputs = page.locator('label.hatch-setting').filter({ hasText: 'Item in' }).locator('select');
  const outputs = page.locator('label.hatch-setting').filter({ hasText: 'Item out' }).locator('select');
  await expect(inputs).toHaveCount(5);
  await expect(outputs).toHaveCount(1);
  await outputs.first().selectOption('EV');
  for (const length of ['2', '16']) {
    await page.getByTestId('size').fill(length);
    await page.getByTestId('size').press('Enter');
    await expect(inputs).toHaveCount(Number(length));
    await expect(outputs).toHaveCount(1);
    await expect(outputs.first()).toHaveValue('EV');
  }
  await page.screenshot({ path: 'e2e/screenshots/rc2-advanced-assembly-line.png' });
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(inputs).toHaveCount(16);
  await expect(outputs.first()).toHaveValue('EV');
  expect(errors).toEqual([]);
});

test('edits voltage and individual hatch tiers in machine mode and retains them after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('plan-tiers-seeded')) return;
    localStorage.clear();
    localStorage.setItem(
      'gtnh-planner:v1',
      JSON.stringify({
        v: 2,
        multiblockId: 'vacuum-freezer',
        count: 1,
        limits: { x: null, y: 1, z: null },
        enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance'],
        colors: {},
        voltageTier: 'LV',
      }),
    );
    sessionStorage.setItem('plan-tiers-seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByTestId('multiblock-name')).toHaveText(/Vacuum Freezer/i);
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('plan-voltage-tier').selectOption('HV');
  const hatches = page.getByTestId('plan-individual-hatch-tier');
  await expect(hatches).toHaveCount(3);
  await hatches.first().selectOption('MV');
  await expect(hatches.filter({ has: page.locator('option:checked[value="MV"]') })).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:v1')!).voltageTier))
    .toBe('HV');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(JSON.parse(localStorage.getItem('gtnh-planner:v1')!).hatchTiers ?? {}),
      ),
    )
    .toEqual(['MV']);
  await page.screenshot({ path: 'e2e/screenshots/rc2-machine-hatch-tiers.png' });
  await page.reload();
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('plan-voltage-tier')).toHaveValue('HV');
  await expect(hatches.filter({ has: page.locator('option:checked[value="MV"]') })).toHaveCount(1);
  expect(errors).toEqual([]);
});
