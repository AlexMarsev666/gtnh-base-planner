import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const reference = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/fixtures/reference-01-oil-refinery.json'), 'utf8'),
);

test('legacy refinery exposes routing controls and persists mode, depth and seed', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('routing-reference-seeded')) return;
    localStorage.clear();
    localStorage.setItem('gtnh-planner:mode', 'site');
    localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(value));
    sessionStorage.setItem('routing-reference-seeded', '1');
  }, reference);
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  await expect(page.getByTestId('routing-controls')).toBeInViewport();
  await expect(page.getByTestId('routing-mode')).toHaveValue('compact');
  await expect(page.getByTestId('legacy-routing-hint')).toBeVisible();
  await page.getByTestId('routing-mode').selectOption('neat');
  await expect(page.getByTestId('routing-depth-hint')).toContainText('Prefer −1');
  await expect(page.getByTestId('routing-depth-hint')).toContainText('surface');
  const depth = page.getByTestId('routing-depth');
  await depth.fill('4');
  await depth.press('Enter');
  await page.getByTestId('underground-view').click();
  await expect(page.getByTestId('underground-view')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('legacy-routing-hint')).toHaveCount(0);
  // This real 27-group plan must finish routing before the screenshot records the new depth.
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  await page.screenshot({ path: 'e2e/screenshots/site-routing-controls.png' });
  const seed = page.getByTestId('optimization-seed');
  await seed.fill('73');
  await seed.press('Enter');
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).routing))
    .toEqual({ mode: 'neat', depth: 4 });
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await expect(page.getByTestId('routing-mode')).toHaveValue('neat');
  await expect(depth).toHaveValue('4');
  await expect(page.getByTestId('routing-depth-hint')).toBeVisible();
  await expect(seed).toHaveValue('73');
  const storedGroups = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!).groups,
  );
  for (let i = 0; i < reference.groups.length; i++) {
    for (const key of [
      'resourceBindings',
      'hatchTiers',
      'voltageTier',
      'structureGlassTier',
      'limits',
      'count',
    ])
      expect(storedGroups[i][key], `${reference.groups[i].id}: ${key}`).toEqual(reference.groups[i][key]);
  }
  expect(errors).toEqual([]);
});
