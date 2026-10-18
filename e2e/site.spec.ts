import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const SITE_LINK = readFileSync(join(process.cwd(), 'src/share/fixtures/site.link.txt'), 'utf8').trim();

const FIXTURE = readFileSync(
  join(process.cwd(), 'src/import/__fixtures__/gtnhplanner-titanium.json'),
  'utf8',
);

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** A 1×1 transparent PNG: icon requests to gtnhplanner.com are answered locally, tests never use the network. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let iconRequests = 0;

test.beforeEach(async ({ page }) => {
  iconRequests = 0;
  await page.route('https://gtnhplanner.com/**', (route) => {
    iconRequests++;
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-cleared')) {
      localStorage.clear();
      sessionStorage.setItem('e2e-cleared', '1');
    }
  });
});

/**
 * Imports the fixture through the dialog. The optimisation that follows an import is switched off unless
 * `optimize`: it swaps the layout a few seconds later, which would make the other tests wait on it.
 */
async function importFixture(page: Page, viaPanel = false, optimize = false): Promise<void> {
  await page.getByTestId('mode-site').click();
  if (viaPanel) {
    await page.getByTestId('site-panel-toggle').click();
    await page.getByTestId('site-panel').getByRole('button', { name: 'Import from GTNH Planner' }).click();
  } else await page.getByTestId('site-import').click();
  const dialog = page.getByTestId('import-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('import-text').fill(FIXTURE);
  await page.getByTestId('import-read').click();
  await expect(page.getByTestId('import-rows').locator('tbody tr')).toHaveCount(8);
  await page.screenshot({ path: 'e2e/screenshots/site-import-dialog.png' });
  const toggle = page.getByTestId('import-optimize');
  await expect(toggle).toBeChecked();
  if (!optimize) await toggle.uncheck();
  await page.getByTestId('import-build').click();
  await expect(dialog).toBeHidden();
}

test('imports a GTNH Planner chain into a routed site', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await importFixture(page);

  const stats = page.getByTestId('site-stats');
  await expect(stats).toContainText('6 groups');
  await expect(stats).toContainText('11 units');
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  await expect(page.getByTestId('site-legend')).toContainText('Chlorine');
  // Resources carry GTNH Planner icon paths, so the legend shows their icons.
  await expect(page.getByTestId('site-legend').locator('img').first()).toBeVisible();
  expect(iconRequests).toBeGreaterThan(0);
  // Let a few flow-arrow frames run before the picture.
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/site-imported.png' });

  // Isolate one resource from the legend.
  await page
    .getByTestId('site-legend')
    .getByRole('button', { name: /Chlorine/ })
    .click();
  await expect(page.getByTestId('site-legend').getByRole('button', { name: /Chlorine/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'e2e/screenshots/site-isolated.png' });

  // Select a group in the panel, move and turn it from the keyboard.
  await page.getByTestId('site-panel-toggle').click();
  const panel = page.getByTestId('site-panel');
  // The groups and links list is the docked outline at the left, not part of the panel.
  const outline = page.getByTestId('site-outline');
  await expect(panel).toBeVisible();
  await outline.getByTestId('site-group').first().click();
  await expect(panel.getByTestId('site-group-editor')).toBeVisible();
  // The template's size is in the template settings, which show while nothing is selected.
  const readWidth = async () => {
    await panel.getByRole('button', { name: 'Deselect' }).click();
    await panel.getByTestId('site-template-tabs-layout').click();
    const w = await panel.getByTestId('site-width').inputValue();
    await outline.getByTestId('site-group').first().click();
    await panel.getByTestId('site-group-tabs-placement').click();
    return w;
  };
  await panel.getByTestId('site-group-tabs-placement').click();
  const x = panel.getByTestId('site-group-x');
  const width = await readWidth();
  const before = Number(await x.inputValue());
  await outline.getByTestId('site-group').first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(x).toHaveValue(String(before + 1));
  await page.keyboard.press('Shift+ArrowRight');
  await expect(x).toHaveValue(String(before + 6));
  // Both key moves were quick repeats of one move: one undo step takes them back, redo repeats them.
  await page.keyboard.press('Control+z');
  await expect(x).toHaveValue(String(before));
  await page.keyboard.press('Control+Shift+z');
  await expect(x).toHaveValue(String(before + 6));
  // The nudge pad moves the same way as the keys.
  await panel.getByTestId('nudge-ArrowLeft').click();
  await expect(x).toHaveValue(String(before + 5));
  // Past the west edge the template grows that way: the group stays inside, everything moves east.
  // The nudge, the arrow keys and the undo follow each other at once: no selection changes in between.
  await outline.getByTestId('site-group').first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('site-name').locator('xpath=..')).not.toContainText(`${width} ×`);
  expect(Number(await x.inputValue())).toBeGreaterThanOrEqual(0);
  // One undo step (these moves and the nudge just before them follow each other quickly).
  await page.keyboard.press('Control+z');
  expect(await readWidth()).toBe(width);
  await expect(x).toHaveValue(String(before + 6));
  await panel.getByTestId('site-group-rotate').click();
  await page.screenshot({ path: 'e2e/screenshots/site-panel.png' });

  // Arrange, Optimize and the view chips are in the toolbar over the scene.
  // Arrange puts the chain back in order and everything stays connected.
  await page.getByTestId('site-arrange').click();
  await expect(stats).toContainText(/(\d+)\/\1 connected/);

  // Optimize searches for a tighter layout and keeps it only if the router connects everything.
  await page.getByTestId('site-optimize').click();
  await expect(page.getByText(/Optimized:|nothing changed/)).toBeVisible({ timeout: 60000 });
  await expect(stats).toContainText(/(\d+)\/\1 connected/);

  // Icons can be switched off: colour swatches only.
  await page.getByTestId('site-icons').click();
  await expect(page.getByTestId('site-icons')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('site-legend').locator('img')).toHaveCount(0);
  await page.getByTestId('site-icons').click();
  await expect(page.getByTestId('site-icons')).toHaveAttribute('aria-pressed', 'true');

  // The site survives a reload; the view comes back in site mode.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('site-stats')).toContainText('6 groups');

  expect(errors).toEqual([]);
});

test('optimises the template by itself after an import, once it is shown', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await importFixture(page, false, true);
  const stats = page.getByTestId('site-stats');
  // The plain layout is on screen first ...
  await expect(stats).toContainText('6 groups');
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  // ... and the optimised one replaces it, with its own notice and an Undo.
  const notice = page.getByText(/Optimized:|nothing changed/);
  await expect(notice).toBeVisible({ timeout: 60000 });
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  expect(errors).toEqual([]);
});

test('an empty template offers a start card that goes away with the first group', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('mode-site').click();
  const card = page.getByTestId('site-empty');
  await expect(card).toBeVisible();
  await page.getByTestId('site-empty-current').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('builds a site by hand and switches back to the machine view', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  // The current machine plan (4 Coke Ovens) becomes the first group.
  await page.getByTestId('settings-toggle').click();
  await page.getByTestId('add-to-site').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');

  await page.getByTestId('site-panel-toggle').click();
  const panel = page.getByTestId('site-panel');
  const outline = page.getByTestId('site-outline');
  await outline.getByTestId('site-add-menu').click();
  await outline.getByTestId('site-add-group').click();
  await page
    .getByTestId('picker')
    .getByTestId('picker-item')
    .filter({ hasText: 'Electric Blast Furnace' })
    .click();
  await expect(page.getByTestId('site-stats')).toContainText('2 groups');

  // Its limits can be kept: Arrange and Optimize leave a kept group's packing alone.
  await panel.getByTestId('site-group-tabs-packing').click();
  const lock = panel.getByTestId('site-lock-limits');
  await expect(lock).toHaveAttribute('aria-checked', 'false');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'false');

  // A link from a site input to the furnace, with a new resource.
  // The form is in the inspector (the panel), opened from the outline.
  await outline.getByTestId('site-link-open').click();
  const form = panel.getByTestId('site-link-form');
  await form.getByLabel('From').selectOption({ label: 'Template input' });
  await form.getByLabel('To').selectOption({ label: 'Electric Blast Furnace' });
  await form.getByLabel('Resource name').fill('Iron Dust');
  await form.getByTestId('site-add-link').click();
  await expect(page.getByTestId('site-legend')).toContainText('Iron Dust');
  await expect(page.getByTestId('site-stats')).toContainText('2/2 connected');
  // The new link is selected: the inspector shows it and its resource is isolated.
  await expect(form).toBeHidden();
  await expect(panel.getByTestId('site-link-inspector')).toContainText('Iron Dust');
  await expect(page.getByTestId('site-legend').getByRole('button', { name: /Iron Dust/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Clicking the selected link row again deselects it and ends the isolation.
  await outline.getByTestId('site-link').getByRole('button').first().click();
  await expect(panel.getByTestId('site-link-inspector')).toBeHidden();
  await expect(page.getByTestId('site-legend').getByRole('button', { name: /Iron Dust/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await outline.getByTestId('site-group').filter({ hasText: 'Electric Blast Furnace' }).click();

  // Removing a group is undone from its notice (the furnace is still selected since it was added).
  await panel.getByTestId('site-group-remove').click();
  await expect(page.getByTestId('site-stats')).toContainText('1 group');
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('site-stats')).toContainText('2 groups');

  await panel.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('mode-machine').click();
  await expect(page.getByTestId('multiblock-name')).toHaveText(/coke oven/i);
  expect(errors).toEqual([]);
});

test('site view on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importFixture(page, true);
  await expect(page.getByTestId('site-stats')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/site-mobile.png' });
});

test('imports into a size of its own and builds on floors what does not fit', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('mode-site').click();
  await page.getByTestId('site-import').click();
  const dialog = page.getByTestId('import-dialog');
  await page.getByTestId('import-text').fill(FIXTURE);
  await page.getByTestId('import-read').click();
  await expect(page.getByTestId('import-rows').locator('tbody tr')).toHaveCount(8);

  // Autosizing is the default; turning it off asks for a size and says what happens to a big chain.
  await expect(page.getByTestId('import-fixed-hint')).toBeHidden();
  await dialog.getByLabel('Size the template to the chain').uncheck();
  await expect(page.getByTestId('import-fixed-hint')).toBeVisible();
  for (const name of ['Width', 'Depth']) {
    const field = dialog.getByRole('textbox', { name });
    await field.fill('20');
    await field.press('Enter');
  }
  await page.getByTestId('import-build').click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId('site-name').locator('xpath=..')).toContainText('20 × 20');
  const stats = page.getByTestId('site-stats');
  await expect(stats).toContainText('6 groups');
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  await expect(page.getByText(/built on \d+ floors/i)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'e2e/screenshots/site-floors.png' });
  expect(errors).toEqual([]);
});

/** The autosaved template (autosave runs 300 ms after the last change). */
type Saved = { groups: { id: string; origin: number[] }[]; routing?: { style?: string } };
async function readSaved(page: Page): Promise<Saved> {
  const raw = await page.evaluate(() => localStorage.getItem('gtnh-planner:site:v1'));
  return JSON.parse(raw ?? '{"groups":[]}');
}
const originsOf = (s: Saved) => s.groups.map((g) => g.origin);

async function savedSite(page: Page): Promise<Saved> {
  // The import has been saved once it is there; wait for it to settle on a value.
  await expect.poll(async () => (await readSaved(page)).groups.length).toBeGreaterThan(0);
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await readSaved(page));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return readSaved(page);
}

test('Neat arranges and routes underground in one undo step', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await importFixture(page);
  const stats = page.getByTestId('site-stats');
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  const before = await savedSite(page);

  await page.getByTestId('site-neat').click();
  await expect(page.getByRole('status').getByRole('button', { name: 'Undo' })).toBeVisible({
    timeout: 60000,
  });
  await expect(stats).toContainText(/(\d+)\/\1 connected/);
  await expect.poll(async () => (await readSaved(page)).routing?.style).toBe('neat');
  // The imported template is already arranged, and arranging is idempotent, so the groups may stay where they
  // are; that Neat applies layout and routing as one store update is covered by siteCommands.test.ts.

  // One undo takes back the layout and the routing together.
  await page.getByTestId('site-undo').click();
  await expect.poll(async () => (await readSaved(page)).routing).toEqual(before.routing);
  expect(originsOf(await readSaved(page))).toEqual(originsOf(before));
  expect(errors).toEqual([]);
});

test('Cancel stops Optimize and leaves the template as it was', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await importFixture(page);
  await expect(page.getByTestId('site-stats')).toContainText(/(\d+)\/\1 connected/);
  const before = await savedSite(page);

  await page.getByTestId('site-optimize').click();
  await expect(page.getByTestId('arrange-progress')).toBeVisible();
  await page.getByTestId('arrange-cancel').click();
  await expect(page.getByTestId('arrange-progress')).toBeHidden();
  await expect(page.getByText('Stopped; the template is unchanged.')).toBeVisible();

  const after = await savedSite(page);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('Arrange, Optimize and Neat say why they are unavailable on an empty template', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.getByTestId('mode-site').click();
  const arrange = page.getByTestId('site-arrange');
  await expect(arrange).toHaveAttribute('aria-disabled', 'true');
  await arrange.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Add a group first');
  expect(errors).toEqual([]);
});

test('an old share link opens without rearranging the groups', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#s=' + SITE_LINK);
  await expect(page.getByTestId('site-stats')).toContainText('4 groups');
  const expected = JSON.parse(
    readFileSync(join(process.cwd(), 'src/share/fixtures/site.expected.json'), 'utf8'),
  ) as { groups: { origin: number[] }[] };
  // Let any unwanted arrangement happen: the saved origins must stay the ones in the link.
  const saved = await savedSite(page);
  await page.waitForTimeout(1000);
  expect(originsOf(await readSaved(page))).toEqual(originsOf(saved));
  expect(originsOf(saved)).toEqual(expected.groups.map((g) => g.origin));
  expect(errors).toEqual([]);
});
