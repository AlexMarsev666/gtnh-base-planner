import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ids = ['01-oil-refinery', '02-small', '03-medium', '04-crackers-towers', '05-wallsharing'];
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

for (const id of ids) {
  // Keep one actual loaded/arranged document while reviewing its four views.
  test.describe.serial(id, () => {
    let context: BrowserContext;
    let page: Page;
    let textured: Buffer;
    let stored: string;
    const errors: string[] = [];

    async function closePanel() {
      await page.getByTestId('site-panel').getByRole('button', { name: 'Close', exact: true }).click();
    }

    async function assertDocument() {
      expect(await page.evaluate(() => localStorage.getItem('gtnh-planner:site:v1'))).toBe(stored);
      expect(errors).toEqual([]);
    }

    test.beforeAll(async ({ browser }) => {
      // This new 27-group visual fixture routes its source and the proposed layout while
      // Chromium also renders it. The parallel E2E run exceeded the initial 20-second wait.
      // Keep ordinary cases/tests unchanged; allow its setup 45 s and its command 30 s.
      if (id.startsWith('01')) test.setTimeout(45000);
      const plan = JSON.parse(readFileSync(`docs/fixtures/reference-${id}.json`, 'utf8'));
      // Preserve the attachment; only the two accepted assignment corrections are applied.
      if (id.startsWith('01')) {
        for (const binding of plan.groups.find((g: { id: string }) => g.id === 'g9').resourceBindings)
          if (['fluid:resource', 'fluid:light-steam-cracked-napthta'].includes(binding.resource))
            binding.unitId = 1;
      }
      plan.routing = { mode: 'neat', depth: 3 };
      context = await browser.newContext({
        baseURL: test.info().project.use.baseURL,
        viewport: { width: 1440, height: 900 },
      });
      page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.text().includes('texture atlas failed'))
          errors.push(message.text());
      });
      await page.route('https://gtnhplanner.com/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: pixel }),
      );
      await page.addInitScript((value) => {
        localStorage.clear();
        localStorage.setItem('gtnh-planner:mode', 'site');
        localStorage.setItem('gtnh-planner:site:v1', JSON.stringify(value));
      }, plan);
      const atlas = page.waitForResponse((response) => response.url().endsWith('/textures/atlas.png'));
      await page.goto('/');
      expect((await atlas).ok()).toBe(true);
      await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
      await expect(page.getByTestId('site-stats')).toContainText(/(\d+)\/\1 connected/);
      await page.getByTestId('site-panel-toggle').click();
      await page.getByTestId('site-arrange').click();
      await expect(page.getByRole('status')).not.toContainText('Arranging', {
        timeout: id.startsWith('01') ? 30000 : 20000,
      });
      await expect(page.getByTestId('site-stats')).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
      await expect(page.getByTestId('site-stats')).toContainText(/(\d+)\/\1 connected/);
      await closePanel();
      await page.getByTestId('scene').dblclick({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(250);
      stored = await page.evaluate(() => localStorage.getItem('gtnh-planner:site:v1')!);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('textures and x-ray', async () => {
      textured = await page.screenshot({ path: `e2e/screenshots/stage5-${id}-textures.png` });
      await page.getByTestId('site-panel-toggle').click();
      await page.getByTestId('site-xray').click();
      await expect(page.getByTestId('site-xray')).toHaveAttribute('aria-pressed', 'true');
      await closePanel();
      await page.waitForTimeout(150);
      const xray = await page.screenshot({ path: `e2e/screenshots/stage5-${id}-xray.png` });
      expect(xray.equals(textured)).toBe(false);
      await assertDocument();
    });

    test('underground and isolated net', async () => {
      await page.getByTestId('site-panel-toggle').click();
      await page.getByTestId('site-xray').click();
      await page.getByTestId('underground-view').click();
      await expect(page.getByTestId('underground-view')).toHaveAttribute('aria-pressed', 'true');
      await closePanel();
      await page.waitForTimeout(150);
      const underground = await page.screenshot({ path: `e2e/screenshots/stage5-${id}-underground.png` });
      expect(underground.equals(textured)).toBe(false);
      await page.getByTestId('site-panel-toggle').click();
      await page.getByTestId('underground-view').click();
      await closePanel();
      const net = page.getByTestId('site-legend').getByRole('button').first();
      await net.click();
      await expect(net).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(150);
      const isolated = await page.screenshot({ path: `e2e/screenshots/stage5-${id}-isolated.png` });
      expect(isolated.equals(textured)).toBe(false);
      await assertDocument();
    });
  });
}
