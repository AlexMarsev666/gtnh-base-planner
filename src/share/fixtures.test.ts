import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePlan } from './codec';
import { STORAGE_KEY, loadStoredPlan, planFromJson, readStoredPlan, type StorageLike } from './persist';
import { decodeSite, decodeSiteWithReport, siteFromJson, siteFromJsonWithReport } from './siteCodec';
import { SITE_STORAGE_KEY, loadStoredSite, readStoredSite } from './sitePersist';

/**
 * Frozen files and links written by the app before the optional tier / mirror / wallshare / assign / routing
 * fields existed. They must keep decoding to exactly the stored state; `*.expected.json` is that state. If one
 * of these tests fails, a change broke old saves and links.
 */

const dir = new URL('./fixtures/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const json = (name: string): unknown => JSON.parse(read(name));
const link = (name: string) => read(name).trim();

describe('legacy plan fixture', () => {
  it('decodes the JSON file', () => {
    expect(planFromJson(read('plan.json'))).toEqual(json('plan.expected.json'));
  });

  it('decodes the #p= link', async () => {
    expect(await decodePlan(link('plan.link.txt'))).toEqual(json('plan.expected.json'));
  });

  it('keeps the fields it was made to cover', () => {
    const plan = planFromJson(read('plan.json'));
    expect(plan.size).toBe(8);
    expect(plan.manualUnits?.map((u) => u.id)).toEqual([0, 2, 5]);
    expect(plan.limits).toEqual({ x: 2, y: null, z: 3 });
    expect(plan.colors.energy).toBe('#ff8800');
  });
});

describe.each(['site', 'import'])('legacy %s fixture', (name) => {
  it('decodes the JSON file', () => {
    expect(siteFromJson(read(`${name}.json`))).toEqual(json(`${name}.expected.json`));
  });

  it('decodes the #s= link', async () => {
    expect(await decodeSite(link(`${name}.link.txt`))).toEqual(json(`${name}.expected.json`));
  });
});

describe('legacy site fixture contents', () => {
  it('keeps the fields it was made to cover', () => {
    const site = siteFromJson(read('site.json'));
    const by = Object.fromEntries(site.groups.map((g) => [g.id, g]));
    expect(by.sb.machine).toBe('macerator');
    expect(by.ph.multiblockId).toBe('placeholder');
    expect(by.dt.elevation).toBe(5);
    expect(by.dt.limitsLocked).toBe(true);
    expect(site.links.map((l) => l.rate)).toEqual([2.5, 1, undefined, 0.5, 100]);
    expect(site.ports.find((p) => p.void)?.id).toBe('trash');
    expect(site.resources['item:dust'].icon).toBe('/datasets/items/iron_dust.png');
  });
});

describe('legacy site with a removed multiblock', () => {
  const expected = json('missing.expected.json') as { site: unknown; replaced: unknown };

  it('replaces the group by a placeholder and reports it, from a file and a link', async () => {
    expect(siteFromJsonWithReport(read('missing.json'))).toEqual(expected);
    expect(await decodeSiteWithReport(link('missing.link.txt'))).toEqual(expected);
    expect(expected.replaced).toEqual([{ group: 'ghost', id: 'ghost-multiblock' }]);
  });
});

describe('legacy text in localStorage', () => {
  function storage(entries: Record<string, string>): StorageLike {
    const map = new Map(Object.entries(entries));
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  }

  it('loads a stored plan', () => {
    expect(loadStoredPlan(storage({ [STORAGE_KEY]: read('plan.json') }))).toEqual(json('plan.expected.json'));
  });

  it('loads stored sites', () => {
    for (const name of ['site', 'import']) {
      const st = storage({ [SITE_STORAGE_KEY]: read(`${name}.json`) });
      expect(loadStoredSite(st)).toEqual(json(`${name}.expected.json`));
      expect(st.length).toBe(1);
    }
  });

  it('repairs a stored site with a removed multiblock and keeps the original text', () => {
    const text = read('missing.json');
    const st = storage({ [SITE_STORAGE_KEY]: text });
    const out = readStoredSite(st, () => 7);
    const expected = json('missing.expected.json') as { site: unknown; replaced: unknown };
    expect(out.site).toEqual(expected.site);
    expect(out.replaced).toEqual(expected.replaced);
    expect(out.backupKey).toBeDefined();
    expect(st.getItem(out.backupKey!)).toBe(text);
  });

  it('refuses a stored plan of an unknown multiblock and keeps a copy', () => {
    const text = JSON.stringify({ ...JSON.parse(read('plan.json')), multiblockId: 'ghost-multiblock' });
    const st = storage({ [STORAGE_KEY]: text });
    const out = readStoredPlan(st, () => 9);
    expect(out.plan).toBeNull();
    expect(out.error).toMatch(/ghost-multiblock/);
    expect(st.getItem(STORAGE_KEY)).toBe(text);
    expect(st.getItem(out.backupKey!)).toBe(text);
  });
});
