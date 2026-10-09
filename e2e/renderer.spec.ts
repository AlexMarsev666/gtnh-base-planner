import { expect, test, type Page } from '@playwright/test';

/** Renderer checks against the standalone harness page (`renderer-harness.html`). */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function open(page: Page, query: string): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`renderer-harness.html?${query}`);
  await page.waitForFunction(() => window.__harness?.ready === true);
}

/** Fraction of sampled canvas pixels that are not (near) white. */
function inkRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.querySelector('canvas')!;
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 150;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) ink++;
    return ink / (d.length / 4);
  });
}

test('renders coke ovens, picks units, x-ray, no console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'count=12');
  const canvas = page.getByTestId('scene');
  expect(await inkRatio(page)).toBeGreaterThan(0.05);
  await page.screenshot({ path: 'e2e/screenshots/renderer-simple.png' });

  // Click the middle of the scene: it is covered by blocks.
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => window.__harness!.picks.length)).toBe(1);
  const picked = await page.evaluate(() => window.__harness!.picks[0]);
  expect(picked.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'e2e/screenshots/renderer-selected.png' });

  // Background click (top-right corner) clears the pick.
  await page.mouse.click(box.x + box.width - 10, box.y + 10);
  await expect.poll(() => page.evaluate(() => window.__harness!.picks.length)).toBe(2);
  expect(await page.evaluate(() => window.__harness!.picks[1])).toEqual([]);

  // A drag rotates the view and must not pick.
  await page.mouse.move(box.x + 300, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__harness!.picks.length)).toBe(2);

  await page.evaluate(() => window.__harness!.setXray(true));
  await page.dblclick('canvas', { position: { x: 5, y: 5 } }); // reset view
  await page.waitForTimeout(150);
  expect(await inkRatio(page)).toBeGreaterThan(0.02);
  await page.screenshot({ path: 'e2e/screenshots/renderer-xray.png' });

  expect(errors).toEqual([]);
});

test('detailed mode falls back or loads without console errors', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'count=4&mode=detailed');
  const mode = await page.evaluate(() => window.__harness!.renderer.viewMode);
  expect(['simple', 'detailed']).toContain(mode);
  expect(await inkRatio(page)).toBeGreaterThan(0.05);
  await page.screenshot({ path: 'e2e/screenshots/renderer-detailed.png' });
  expect(errors).toEqual([]);
});

test('renders the chemical reactor casing normally and preserves the intentional x-ray view', async ({
  page,
}) => {
  const errors = trackErrors(page);
  await open(page, 'def=large-chemical-reactor&count=1&pipes=0&mode=detailed');
  await page.evaluate(() => window.__harness!.setViewMode('detailed'));
  expect(await page.evaluate(() => window.__harness!.renderer.viewMode)).toBe('detailed');
  expect(await inkRatio(page)).toBeGreaterThan(0.05);
  await page.screenshot({ path: 'e2e/screenshots/rc2-lcr-opaque.png' });
  await page.evaluate(async () => {
    window.__harness!.setXray(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await inkRatio(page)).toBeGreaterThan(0.02);
  await page.screenshot({ path: 'e2e/screenshots/rc2-lcr-xray.png' });
  expect(errors).toEqual([]);
});

test('60 coke ovens render within budget', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 'count=60');
  expect(await page.evaluate(() => window.__harness!.unitCount)).toBe(60);
  const ms = await page.evaluate(() => window.__harness!.benchmark(60));
  const info = await page.evaluate(() => window.__harness!.renderer.info());
  console.log(`60 units: ${ms.toFixed(2)} ms/frame, ${info.calls} draw calls, ${info.instances} voxels`);
  expect(info.calls).toBeLessThan(80);
  // Headless Chromium renders in software; keep the bound loose, real GPUs are far below 16 ms.
  expect(ms).toBeLessThan(280);
  await page.screenshot({ path: 'e2e/screenshots/renderer-60.png' });
  expect(errors).toEqual([]);
});
