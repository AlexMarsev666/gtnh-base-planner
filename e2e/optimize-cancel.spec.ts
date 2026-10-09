import { expect, test } from '@playwright/test';

for (const fallback of [false, true])
  for (const mode of ['compact', 'neat'])
    test(`Optimize progress and cancellation: ${mode}, ${fallback ? 'fallback' : 'worker'}`, async ({
      page,
    }) => {
      // Large search quota, with ordinary one-unit groups so loading the fixture stays cheap.
      const reference = {
        v: 1,
        kind: 'site',
        size: [64, 32],
        corridor: 2,
        groups: Array.from({ length: 27 }, (_, i) => ({
          id: 'g' + i,
          multiblockId: 'electric-blast-furnace',
          count: 1,
          limits: { x: 1, y: 1, z: 1 },
          limitsLocked: true,
          enabledHatches: ['itemIn', 'itemOut', 'energy', 'maintenance', 'muffler'],
          origin: [5 + (i % 9) * 6, 5 + Math.floor(i / 9) * 6],
          rotation: 0,
        })),
        links: Array.from({ length: 26 }, (_, i) => ({
          id: 'l' + i,
          resource: 'r' + i,
          from: { group: 'g' + i },
          to: { group: 'g' + (i + 1) },
        })),
        resources: Object.fromEntries(
          Array.from({ length: 26 }, (_, i) => [
            'r' + i,
            { name: 'Item ' + i, kind: 'item', color: '#5678ab' },
          ]),
        ),
        ports: [],
        colors: {},
        routing: { mode, depth: 3 },
      };
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
          localStorage.clear();
          localStorage.setItem('gtnh-planner:mode', 'site');
          localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(reference));
        },
        { reference, fallback },
      );
      await page.goto('/');
      await page.getByTestId('site-panel-toggle').click();
      const stats = page.getByTestId('site-stats');
      await expect(stats).toHaveAttribute('aria-busy', 'false');
      const stored = () => page.evaluate(() => localStorage.getItem('gtnh-planner:site:v1'));
      const original = await stored();
      await page.getByTestId('site-optimize').click();
      const progress = page.getByTestId('optimization-progress');
      await expect(progress).toBeVisible();
      await expect(progress).toContainText(/\d+% · \d+ layouts evaluated/);
      await expect(progress.getByRole('progressbar')).toBeVisible();
      if (!fallback && mode === 'neat')
        await page.screenshot({ path: 'e2e/screenshots/site-optimize-progress.png' });
      await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(progress).toBeHidden();
      await expect(page.getByRole('status')).toContainText('Optimization cancelled. Layout unchanged.');
      await expect(stats).toHaveAttribute('aria-busy', 'false');
      expect(await stored()).toEqual(original);
      await expect(page.getByTestId('site-undo')).toBeDisabled();
      // Starting another search after cancellation must use a fresh job and remain cancellable.
      await page.getByTestId('site-optimize').click();
      await expect(progress).toBeVisible();
      await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(progress).toBeHidden();
      expect(await stored()).toEqual(original);
      expect(errors).toEqual([]);
    });
