import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-cleared')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-cleared', '1');
    }
  });
});

test('limited support has a reason in the picker, machine settings and template editor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('multiblock-name').click();
  const picker = page.getByTestId('picker');
  await picker.getByRole('searchbox').fill('Coke Oven');
  const tile = picker
    .getByTestId('picker-item')
    .filter({ has: page.getByText('Coke Oven', { exact: true }) });
  await expect(tile.getByTestId('catalog-support')).toHaveText('Not verified in game');
  await expect(tile.getByTestId('catalog-support')).toHaveAttribute('data-status', 'unverified');
  await expect(tile.getByTestId('catalog-support')).toHaveAttribute('title', /RC2 export is incomplete/);
  await page.screenshot({ path: 'e2e/screenshots/catalog-support-picker.png' });
  await tile.click();
  await page.getByTestId('settings-toggle').click();
  const settings = page.getByTestId('settings');
  await expect(settings.getByTestId('catalog-support')).toContainText('No successful construction check');
  await page.screenshot({ path: 'e2e/screenshots/catalog-support-settings.png' });
  await settings.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  const panel = page.getByTestId('site-panel');
  await panel.getByTestId('site-group').first().click();
  const editor = panel.getByTestId('site-group-editor');
  await expect(editor.getByTestId('catalog-support')).toHaveAttribute('data-machine', 'coke-oven');
  await expect(editor.getByTestId('catalog-support')).toContainText('RC2 export is incomplete');
  await page.screenshot({ path: 'e2e/screenshots/catalog-support-template.png' });
  await page.waitForTimeout(500); // Existing persistence debounce.
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByTestId('site-panel-toggle').click();
  await page.getByTestId('site-panel').getByTestId('site-group').first().click();
  await expect(page.getByTestId('site-group-editor').getByTestId('catalog-support')).toContainText(
    'RC2 export is incomplete',
  );
  expect(errors).toEqual([]);
});

test('retained legacy shape remains selectable and carries its integration-mod reason', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('count').fill('1');
  await page.getByTestId('count').press('Enter');
  await page.getByTestId('multiblock-name').click();
  const picker = page.getByTestId('picker');
  await picker.getByRole('searchbox').fill('Extreme Entity Crusher');
  const tile = picker.getByTestId('picker-item');
  await expect(tile).toHaveCount(1);
  await expect(tile.getByTestId('catalog-support')).toHaveAttribute('title', /integration mods/);
  await tile.click();
  await expect(page.getByTestId('multiblock-name')).toHaveText('Extreme Entity Crusher');
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('settings').getByTestId('catalog-support')).toContainText('older conversion');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('multiblock-name')).toHaveText('Extreme Entity Crusher');
  await expect(page.getByTestId('count')).toHaveValue('1');
});

test('rejected shapes and exceptions carry known issues while Boldarnator retains its label', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('multiblock-name').click();
  const picker = page.getByTestId('picker');
  for (const [id, search, label, status] of [
    ['elemental-duplicator', 'Elemental Duplicator', 'Known issue', 'known-problem'],
    ['bose-einstein-condensate-maxwell-gate', 'Maxwell Gate', 'Known issue', 'known-problem'],
    ['boldarnator', 'Boldarnator', 'Limited support', 'limited'],
    ['pyrolyse-oven', 'Pyrolyse Oven', 'Not verified in game', 'unverified'],
  ]) {
    await picker.getByRole('searchbox').fill(search);
    const exact = picker.locator(`[data-testid="catalog-support"][data-machine="${id}"]`);
    await expect(exact).toHaveText(label);
    await expect(exact).toHaveAttribute('data-status', status);
    if (id === 'elemental-duplicator')
      await page.screenshot({ path: 'e2e/screenshots/catalog-support-known-problem.png' });
  }
});
