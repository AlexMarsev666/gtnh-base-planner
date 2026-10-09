import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

for (const fallback of [false, true])
  test(`Neat is one checked, persistent undo step through ${fallback ? 'fallback' : 'worker'}`, async ({
    page,
  }) => {
    const reference = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/fixtures/reference-04-crackers-towers.json'), 'utf8'),
    );
    delete reference.routing;
    reference.groups[0].resourceBindings[0].unitId = 0;
    reference.groups[0].resourceBindings[1].unitId = 1;
    reference.groups[0].resourceBindings[2].unitIds = [0, 1];
    reference.groups[0].hatchTiers = { '[0,"fluidIn","feed-a",0]': 'EV' };
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
        if (sessionStorage.getItem('neat-seeded')) return;
        localStorage.clear();
        localStorage.setItem('gtnh-planner:mode', 'site');
        localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(reference));
        sessionStorage.setItem('neat-seeded', '1');
      },
      { reference, fallback },
    );
    await page.goto('/');
    await page.getByTestId('site-panel-toggle').click();
    const stats = page.getByTestId('site-stats');
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!));
    const original = await stored();
    await expect(page.getByTestId('routing-mode')).toHaveValue('compact');
    await page.getByTestId('site-neat').click();
    await expect(page.getByRole('status')).toContainText(
      /Neat: \d+ bends, \d+ surface blocks, \d+ pipe and cable blocks, 0 unconnected terminals\./,
    );
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    await expect(stats).toContainText(/(\d+)\/\1 connected/);
    await expect(page.getByTestId('site-problems')).toHaveCount(0);
    await expect.poll(async () => (await stored()).routing).toEqual({ mode: 'neat', depth: 3 });
    const neat = await stored();
    expect(neat.routing).toEqual({ mode: 'neat', depth: 3 });
    expect(neat.size).toEqual(original.size);
    for (const [i, group] of original.groups.entries()) {
      const { origin: _origin, rotation: _rotation, elevation: _elevation, ...settings } = group;
      const {
        origin: _nextOrigin,
        rotation: _nextRotation,
        elevation: _nextElevation,
        ...nextSettings
      } = neat.groups[i];
      expect(nextSettings).toEqual(settings);
    }
    if (!fallback) await page.screenshot({ path: 'e2e/screenshots/site-neat-command.png' });
    await page.getByTestId('site-neat').click();
    await expect(page.getByRole('status')).toContainText('Neat:');
    await expect(stats).toHaveAttribute('aria-busy', 'false');
    expect(await stored()).toEqual(neat);
    await page.getByTestId('site-undo').click();
    await expect.poll(stored).toEqual(original);
    await page.getByTestId('site-redo').click();
    await expect.poll(stored).toEqual(neat);
    await page.reload();
    await page.getByTestId('site-panel-toggle').click();
    await expect(page.getByTestId('routing-mode')).toHaveValue('neat');
    await expect(page.getByTestId('routing-depth')).toHaveValue('3');
    expect(await stored()).toEqual(neat);
    // Depth is a user choice. Re-running Neat must keep it.
    await page.getByTestId('routing-depth').fill('5');
    await page.getByTestId('routing-depth').press('Enter');
    await page.getByTestId('site-neat').click();
    await expect(page.getByRole('status')).toContainText('Neat:');
    await expect.poll(async () => (await stored()).routing).toEqual({ mode: 'neat', depth: 5 });
    expect(errors).toEqual([]);
  });
