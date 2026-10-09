import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const reference = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/fixtures/user-shared-cracker-overload.json'), 'utf8'),
);

test('auto refinery reports one capacity cause and preserves two separate shared catalysts after reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    if (sessionStorage.getItem('shared-cracker-seeded')) return;
    localStorage.clear();
    localStorage.setItem('gtnh-planner:mode', 'site');
    localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(value));
    sessionStorage.setItem('shared-cracker-seeded', '1');
  }, reference);
  await page.goto('/');
  await page.getByTestId('site-panel-toggle').click();
  const problems = page.getByTestId('site-panel').locator('.problems li');
  await expect(problems).toHaveCount(1);
  await expect(problems.first()).toContainText('16 hatch slots required; total structure capacity 14');
  await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
  await problems.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/screenshots/shared-cracker-overload.png' });
  await page.getByTestId('site-group').filter({ hasText: 'Oil Cracking Unit HV' }).click();
  for (const resource of ['Hydrogen', 'Steam']) {
    const machine = page
      .locator('label')
      .filter({ hasText: `${resource} · Machine` })
      .getByTestId('resource-machine');
    await expect(machine).toHaveValue('shared');
  }
  await page.reload();
  await page.getByTestId('site-panel-toggle').click();
  await expect(problems).toHaveCount(1);
  await expect(problems.first()).toContainText('16 hatch slots required; total structure capacity 14');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('gtnh-planner:site:v1')!));
  expect(stored.groups).toEqual(reference.groups);
  expect(errors).toEqual([]);
});
