import { describe, expect, it } from 'vitest';
import type { PlanState } from '../model/plan/types';
import type { SiteState } from '../model/site/types';
import { LinkTooLargeError, MAX_PLAN_JSON_BYTES, MAX_SITE_JSON_BYTES, PlanFormatError } from './binary';
import { MAX_COORD, MAX_COUNT, decodePlan, encodePlan, validatePlanState } from './codec';
import { loadStoredPlan, planFromJson, planToJson, saveStoredPlan, type StorageLike } from './persist';
import { MAX_GROUPS, decodeSite, emptySite, encodeSite, siteFromJson, siteToJson } from './siteCodec';
import { loadStoredSite, saveStoredSite } from './sitePersist';

function memory(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

/** Manual plan with `n` units at wide-ranging coordinates and ids (the longest form of a unit). */
function manualPlan(n: number): PlanState {
  const sign = (i: number) => (i % 2 ? -1 : 1);
  return {
    v: 1,
    multiblockId: 'electric-blast-furnace',
    count: n,
    limits: { x: 2000, y: 2000, z: 2000 },
    enabledHatches: ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'energy', 'maintenance', 'muffler'],
    colors: { energy: '#ff00ff', muffler: '#00ffff' },
    manualUnits: Array.from({ length: n }, (_, i) => ({
      id: 1_000_000 - i,
      origin: [sign(i) * (MAX_COORD - i), sign(i + 1) * (MAX_COORD - (i % 50)), sign(i) * (MAX_COORD - 3)],
      rotation: (i % 4) as 0 | 1 | 2 | 3,
    })),
  };
}

/** Site with `n` groups, `n - 1` chain links and `res` resources with long names. */
function bigSite(n: number, res: number): SiteState {
  const resources: SiteState['resources'] = {};
  for (let r = 0; r < res; r++) {
    resources[`item:${'r'.repeat(40)}${r}`] = {
      kind: 'item',
      name: `Resource number ${r} ${'x'.repeat(60)}`,
      color: '#aabbcc',
    };
  }
  const keys = Object.keys(resources);
  return {
    ...emptySite(),
    groups: Array.from({ length: n }, (_, i) => ({
      id: `g${i}`,
      multiblockId: 'electric-blast-furnace',
      count: 3,
      limits: { x: null, y: null, z: null },
      enabledHatches: ['energy', 'maintenance'],
      origin: [i % 200, Math.floor(i / 200) * 10] as [number, number],
      rotation: 0,
    })),
    links: Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({
      id: `l${i}`,
      from: { group: `g${i}` },
      to: { group: `g${i + 1}` },
      resource: keys[i % keys.length]!,
      rate: 1.5,
    })),
    resources,
  };
}

describe('one size limit per form', () => {
  it('a maximal plan survives storage, file and link', async () => {
    const plan = manualPlan(MAX_COUNT);
    const want = validatePlanState(plan);
    const st = memory();
    expect(saveStoredPlan(plan, st)).toBe(true);
    expect(loadStoredPlan(st)).toEqual(want);
    expect(planFromJson(planToJson(plan))).toEqual(want);
    expect(planToJson(plan).length).toBeGreaterThan(64 * 1024);
    expect(await decodePlan(await encodePlan(plan))).toEqual(want);
  });

  it('a plan file larger than the old 64 KiB cap opens', () => {
    const text = planToJson(manualPlan(900));
    expect(text.length).toBeGreaterThan(64 * 1024);
    expect(planFromJson(text).manualUnits).toHaveLength(900);
  });

  it('the audit site (256 groups, 255 links, 400 resources) links or says it is too large', async () => {
    const site = bigSite(256, 400);
    const want = validateSiteStateJson(site);
    let code: string | undefined;
    try {
      code = await encodeSite(site);
    } catch (err) {
      expect(err).toBeInstanceOf(LinkTooLargeError);
    }
    if (code !== undefined) expect(JSON.stringify(await decodeSite(code))).toBe(want);
    // The file and the stored copy work either way.
    expect(siteFromJson(siteToJson(site))).toEqual(JSON.parse(want));
    const st = memory();
    expect(saveStoredSite(site, st)).toBe(true);
    expect(loadStoredSite(st)).toEqual(JSON.parse(want));
  });

  it('a site JSON between 64 KiB and 2 MiB decodes from a link', async () => {
    const site = bigSite(120, 100);
    expect(siteToJson(site).length).toBeGreaterThan(64 * 1024);
    expect(JSON.stringify(await decodeSite(await encodeSite(site)))).toBe(validateSiteStateJson(site));
  });

  it('if a write succeeds, the matching read succeeds (growing plans and sites)', async () => {
    for (const n of [1, 10, 100, 300, 800, 1500, MAX_COUNT]) {
      const plan = manualPlan(n);
      const st = memory();
      if (saveStoredPlan(plan, st)) expect(loadStoredPlan(st)).not.toBeNull();
      expect(() => planFromJson(planToJson(plan))).not.toThrow();
      try {
        await decodePlan(await encodePlan(plan));
      } catch (err) {
        expect(err).toBeInstanceOf(LinkTooLargeError);
      }
    }
    for (const [n, res] of [
      [1, 1],
      [20, 20],
      [100, 200],
      [200, 400],
      [MAX_GROUPS, 512],
    ] as const) {
      const site = bigSite(n, res);
      const st = memory();
      if (saveStoredSite(site, st)) expect(loadStoredSite(st)).not.toBeNull();
      expect(() => siteFromJson(siteToJson(site))).not.toThrow();
      try {
        await decodeSite(await encodeSite(site));
      } catch (err) {
        expect(err).toBeInstanceOf(LinkTooLargeError);
      }
    }
  });

  it('storage refuses text the reader would refuse', () => {
    const st = memory();
    const huge = { ...emptySite(), name: 'x'.repeat(10) };
    expect(saveStoredSite(huge, st)).toBe(true);
    expect(MAX_PLAN_JSON_BYTES).toBe(1024 * 1024);
    expect(MAX_SITE_JSON_BYTES).toBe(2 * 1024 * 1024);
    expect(() => planFromJson(' '.repeat(MAX_PLAN_JSON_BYTES + 1))).toThrow(PlanFormatError);
    expect(() => siteFromJson(' '.repeat(MAX_SITE_JSON_BYTES + 1))).toThrow(PlanFormatError);
  });

  it('LinkTooLargeError is a PlanFormatError and keeps that name', () => {
    const err = new LinkTooLargeError();
    expect(err).toBeInstanceOf(PlanFormatError);
    expect(err.name).toBe('PlanFormatError');
  });
});

function validateSiteStateJson(site: SiteState): string {
  return JSON.stringify(JSON.parse(siteToJson(site)));
}
