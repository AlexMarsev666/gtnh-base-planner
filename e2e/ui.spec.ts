import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  // Start every test from a clean plan.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-cleared')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-cleared', '1');
    }
  });
});

test('top bar, picker, count and settings', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');

  await expect(page.getByTestId('scene')).toBeVisible();
  const name = page.getByTestId('multiblock-name');
  await expect(name).toHaveText(/coke oven/i);
  await expect(page.getByTestId('count')).toHaveValue('4');
  await expect(page.getByTestId('settings-toggle')).toHaveText(/settings/i);
  await page.screenshot({ path: 'e2e/screenshots/ui-desktop.png' });

  // Picker
  await name.click();
  const picker = page.getByTestId('picker');
  await expect(picker).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/ui-picker.png' });
  await picker
    .getByTestId('picker-item')
    .filter({ has: page.getByText('Coke Oven', { exact: true }) })
    .click();
  await expect(picker).toBeHidden();
  await expect(name).toHaveText(/coke oven/i);

  // Count
  await page.getByTestId('count-inc').click();
  await expect(page.getByTestId('count')).toHaveValue('5');
  await page.getByTestId('count-dec').click();
  await expect(page.getByTestId('count')).toHaveValue('4');
  await page.getByTestId('count').fill('2500');
  await page.getByTestId('count').press('Enter');
  await expect(page.getByTestId('count')).toHaveValue('2000');
  await page.getByTestId('count').fill('4');
  await page.getByTestId('count').press('Enter');
  await expect(page.getByTestId('count')).toHaveValue('4');

  // Settings drawer + limit field keeps what is typed
  await page.getByTestId('settings-toggle').click();
  const drawer = page.getByTestId('settings');
  await expect(drawer).toBeVisible();
  const limitX = page.getByTestId('limit-x');
  await limitX.click();
  await limitX.pressSequentially('15');
  await expect(limitX).toHaveValue('15');
  await limitX.press('Tab');
  await expect(limitX).toHaveValue('15');
  await page.getByTestId('limit-y').fill('0');
  await page.getByTestId('limit-y').press('Enter');
  await expect(page.getByTestId('limit-y')).toHaveValue('1');
  await page.getByTestId('limit-y').fill('');
  await page.getByTestId('limit-y').press('Enter');
  await page.screenshot({ path: 'e2e/screenshots/ui-settings.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // DETAILED is the only view mode: no Simple / Detailed switch.
  await expect(page.getByTestId('mode-simple')).toHaveCount(0);
  await expect(page.getByTestId('footer')).toBeVisible();

  expect(errors).toEqual([]);
});

test('mobile layout', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.getByTestId('scene')).toBeVisible();
  await expect(page.getByTestId('multiblock-name')).toBeVisible();
  await expect(page.getByTestId('settings-toggle')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'e2e/screenshots/ui-mobile.png' });
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/ui-mobile-settings.png' });
  expect(errors).toEqual([]);
});

test('required blocks checklist', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('scene')).toBeVisible();

  await page.getByTestId('blocks-toggle').click();
  const panel = page.getByTestId('blocks-panel');
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId('bom-row');
  await expect(rows.first()).toContainText('Coke Oven');
  await expect(panel.getByTestId('bom-progress')).toHaveText(/^0\/\d+$/);
  // The block total matches the stats line under the 3D view.
  const total = Number((await panel.getByTestId('bom-progress').innerText()).match(/\/(\d+)/)![1]);
  await expect(page.getByTestId('stats')).toContainText(`${total} blocks`);
  await expect(panel.getByTestId('bom-io-off')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/ui-blocks.png' });

  // The sort button orders rows by amount, most first, then fewest first.
  const amounts = async () =>
    (await rows.locator('.count').allInnerTexts()).slice(0, 3).map((n) => Number(n));
  await expect(panel.getByTestId('bom-sort')).toContainText(/by type/i);
  const most = panel.getByTestId('bom-sort');
  await most.click();
  await expect(most).toContainText(/most first/i);
  const desc = await amounts();
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  await most.click();
  await expect(most).toContainText(/fewest first/i);
  const asc = await amounts();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await most.click();
  await expect(most).toContainText(/by type/i);

  // Ticks count the row's blocks and are remembered.
  await panel.getByTestId('bom-check').first().check();
  await expect(panel.getByTestId('bom-progress')).toHaveText(/^[1-9]\d*\/\d+$/);
  await page.reload();
  await page.getByTestId('blocks-toggle').click();
  // The ticked row has sunk to the end of the list.
  await expect(panel.getByTestId('bom-check').last()).toBeChecked();
  await panel.getByTestId('bom-clear').click();
  await expect(panel.getByTestId('bom-check').last()).not.toBeChecked();

  // Ticked rows sink to the bottom; the search narrows the list.
  const first = rows.first();
  const firstName = await first.locator('.name').innerText();
  await first.getByTestId('bom-check').check();
  await expect(rows.last().locator('.name')).toHaveText(firstName);
  await expect(rows.first().locator('.name')).not.toHaveText(firstName);
  await panel.getByTestId('bom-clear').click();
  await panel.getByTestId('bom-search').fill('zzzz-no-such-block');
  await expect(panel.getByTestId('bom-no-match')).toBeVisible();
  await expect(rows).toHaveCount(0);
  await panel.getByTestId('bom-search').fill(firstName.toLowerCase());
  await expect(rows.first().locator('.name')).toHaveText(firstName);
  await panel.getByTestId('bom-search').fill('');

  // Pipes and cables get their own list once they are switched on.
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('toggle-pipes').click();
  await page.getByTestId('settings').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('blocks-toggle').click();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('bom-io-off')).toBeHidden();
  await expect(panel).toContainText(/pipes/i);

  expect(errors).toEqual([]);
});

test('a large build with pipes keeps the page responsive while it computes', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('scene')).toBeVisible();

  await page.getByTestId('multiblock-name').click();
  await page
    .getByTestId('picker')
    .getByTestId('picker-item')
    .filter({ has: page.getByText('Nanochip Assembly Complex', { exact: true }) })
    .click();
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('toggle-pipes').click();
  await page.getByTestId('settings').getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('count').fill('7');
  await page.getByTestId('count').press('Enter');
  await expect(page.getByTestId('count')).toHaveValue('7');

  // The build runs in a worker: the page answers while it is busy (a blocked main thread would not).
  const stats = page.getByTestId('stats');
  await expect(stats).toContainText(/laying out/i);
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await page.evaluate(() => 1);
    expect(Date.now() - start).toBeLessThan(500);
  }

  // The final build arrives: nothing is computing or waiting for pipes any more, and the scene is shown.
  await expect(stats).not.toContainText(/laying out|routing pipes/i, { timeout: 180_000 });
  await expect(page.getByTestId('preview-notice')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the mirror setting survives a share link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByTestId('settings-toggle').click();
  const mirror = page.getByTestId('toggle-mirror');
  await expect(mirror).toHaveAttribute('aria-checked', 'false');
  await mirror.click();
  await expect(mirror).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('share').click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain('#p=');

  // A fresh page has nothing stored, so the link opens straight away; if it is offered, accept it.
  const other = await context.newPage();
  await other.goto(link);
  const offer = other.getByTestId('shared-confirm').getByRole('button', { name: 'Open' });
  if (await offer.isVisible()) await offer.click();
  await other.getByTestId('settings-toggle').click();
  await expect(other.getByTestId('toggle-mirror')).toHaveAttribute('aria-checked', 'true');
});

test('buildability lists a hatch above the glass and clears when the glass tier is raised', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('scene')).toBeVisible();

  await page.getByTestId('multiblock-name').click();
  await page
    .getByTestId('picker')
    .getByTestId('picker-item')
    .filter({ has: page.getByText('Mega Oil Cracker', { exact: true }) })
    .click();
  await page.getByTestId('settings-toggle').click();
  const drawer = page.getByTestId('settings');
  await drawer.getByTestId('machine-tier').selectOption('IV');

  await drawer.getByTestId('machine-glass').selectOption('HV');
  await expect(drawer.getByTestId('buildability-verdict')).toContainText(/won't form/i);
  await expect(drawer.getByTestId('buildability-errors')).toContainText(/above the glass \(HV\)/);
  await expect(page.getByTestId('stats')).toContainText(/won't form/i);

  await drawer.getByTestId('machine-glass').selectOption('IV');
  // With no errors left the list is gone and the verdict says so.
  await expect(drawer.getByTestId('buildability-verdict')).toContainText(/will form/i);
  await expect(drawer.getByTestId('buildability-errors')).toHaveCount(0);

  expect(errors).toEqual([]);
});
