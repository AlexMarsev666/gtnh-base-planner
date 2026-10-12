import { describe, expect, it } from 'vitest';
import type { PlanState } from '../model/plan/types';
import type { SiteState } from '../model/site/types';
import { defaultPlan } from '../state/store';
import { deflateRaw, toBase64Url } from './binary';
import { PlanFormatError, decodePlan, encodePlan, plansEqual, validatePlanState } from './codec';
import { loadStoredPlan, planFromJson, planToJson, saveStoredPlan, type StorageLike } from './persist';
import {
  decodeSite,
  effectiveRouting,
  emptySite,
  encodeSite,
  siteFromJson,
  siteToJson,
  sitesEqual,
  validateSiteState,
} from './siteCodec';
import { loadStoredSite, saveStoredSite } from './sitePersist';

/** The optional fields added for tiers, mirroring, wall sharing, hatch assignment and routing. */

function memory(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

async function rawLink(data: unknown): Promise<string> {
  return toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(data))));
}

function richPlan(): PlanState {
  return {
    ...defaultPlan('distillation-tower'),
    tier: 'EV',
    hatchTiers: { 'energy:0': 'IV', 'fluidOut:2': 'LuV', 'itemIn:0': 'HV' },
    mirror: true,
    wallshare: 'stack',
  };
}

describe('plan: tier, hatchTiers, mirror, wallshare', () => {
  it('round-trips through JSON, a link and localStorage', async () => {
    const plan = richPlan();
    expect(planFromJson(planToJson(plan))).toEqual(plan);
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    const st = memory();
    expect(saveStoredPlan(plan, st)).toBe(true);
    expect(loadStoredPlan(st)).toEqual(plan);
  });

  it('writes nothing for the defaults', async () => {
    const plain = defaultPlan();
    const out = validatePlanState({ ...plain, mirror: false, wallshare: 'auto', hatchTiers: {} });
    expect(out).toEqual(plain);
    expect(Object.keys(out)).toEqual(Object.keys(plain));
    expect(await encodePlan({ ...plain, wallshare: 'auto' })).toBe(await encodePlan(plain));
  });

  it('uses the short link keys t, k, f and w', async () => {
    const plain = await encodePlan(defaultPlan('distillation-tower'));
    const rich = await encodePlan(richPlan());
    expect(rich).not.toBe(plain);
    const text = JSON.stringify({
      v: 1,
      m: 'distillation-tower',
      h: 0,
      t: 4,
      k: { 'energy:0': 5 },
      f: 1,
      w: 2,
    });
    const plan = await decodePlan(await rawLink(JSON.parse(text)));
    expect(plan).toMatchObject({
      tier: 'EV',
      hatchTiers: { 'energy:0': 'IV' },
      mirror: true,
      wallshare: 'stack',
    });
  });

  it('treats equal plans as equal regardless of key order', () => {
    const a = richPlan();
    const b = {
      ...richPlan(),
      hatchTiers: { 'itemIn:0': 'HV', 'fluidOut:2': 'LuV', 'energy:0': 'IV' },
    } as PlanState;
    expect(plansEqual(a, b)).toBe(true);
    expect(plansEqual(a, { ...a, tier: 'LV' })).toBe(false);
  });

  it('rejects bad values', async () => {
    const base = defaultPlan();
    const bad: Record<string, unknown>[] = [
      { tier: 'XL' },
      { tier: 3 },
      { hatchTiers: { 'energy:0': 'nope' } },
      { hatchTiers: { 'bogus:0': 'LV' } },
      { hatchTiers: { energy: 'LV' } },
      { hatchTiers: { 'energy:-1': 'LV' } },
      { hatchTiers: [] },
      { mirror: 'yes' },
      { mirror: 1 },
      { wallshare: 'diagonal' },
    ];
    for (const extra of bad)
      expect(() => validatePlanState({ ...base, ...extra }), JSON.stringify(extra)).toThrow(PlanFormatError);
    for (const extra of [
      { t: 99 },
      { t: -1 },
      { t: 1.5 },
      { f: 0 },
      { f: true },
      { w: 9 },
      { k: { 'energy:0': 99 } },
      { k: [] },
    ]) {
      const link = await rawLink({ v: 1, m: base.multiblockId, h: 0, ...extra });
      await expect(decodePlan(link), JSON.stringify(extra)).rejects.toThrow(PlanFormatError);
    }
  });
});

function siteWith(group: Record<string, unknown>, extra: Record<string, unknown> = {}): SiteState {
  const base = emptySite();
  return {
    ...base,
    ports: [{ id: 'p1', dir: 'in', resource: 'item:dust' }],
    links: [{ id: 'l1', from: { port: 'p1' }, to: { group: 'g' }, resource: 'item:dust' }],
    resources: { 'item:dust': { kind: 'item', name: 'Dust', color: '#aabbcc' } },
    groups: [
      {
        id: 'g',
        multiblockId: 'electric-blast-furnace',
        count: 2,
        limits: { x: null, y: null, z: null },
        enabledHatches: [],
        origin: [2, 2],
        rotation: 0,
        ...group,
      },
    ],
    ...extra,
  } as SiteState;
}

function richSite(): SiteState {
  return siteWith(
    {
      tier: 'HV',
      hatchTiers: { 'itemIn:item:dust:0': 'EV', 'itemIn:item:dust:shared': 'IV' },
      mirror: true,
      wallshare: 'back',
      assign: { 'item:dust': { unit: 1, zone: 'dot2' } },
    },
    { routing: { style: 'neat', depth: 2 }, seed: 123456 },
  );
}

describe('site: routing and seed', () => {
  it('round-trips through JSON, a link and localStorage', async () => {
    const site = richSite();
    expect(siteFromJson(siteToJson(site))).toEqual(site);
    expect(await decodeSite(await encodeSite(site))).toEqual(site);
    const st = memory();
    expect(saveStoredSite(site, st)).toBe(true);
    expect(loadStoredSite(st)).toEqual(site);
  });

  it('keeps a seed of 0 and rejects bad ones', () => {
    expect(validateSiteState(siteWith({}, { seed: 0 })).seed).toBe(0);
    expect(validateSiteState(siteWith({}, { seed: 0xffffffff })).seed).toBe(0xffffffff);
    for (const seed of [-1, 1.5, 2 ** 32, '7', NaN])
      expect(() => validateSiteState(siteWith({}, { seed }))).toThrow(PlanFormatError);
  });

  it('rejects bad routing', () => {
    for (const routing of [
      { style: 'wavy', depth: 1 },
      { style: 'neat', depth: 4 },
      { style: 'neat', depth: -1 },
      { style: 'neat', depth: 1.5 },
      { style: 'neat' },
      { depth: 1 },
      'neat',
    ])
      expect(() => validateSiteState(siteWith({}, { routing })), JSON.stringify(routing)).toThrow(
        PlanFormatError,
      );
  });

  it('leaves both out when unset', () => {
    const out = validateSiteState(siteWith({}));
    expect('routing' in out).toBe(false);
    expect('seed' in out).toBe(false);
  });
});

describe('site group: tier, hatchTiers, mirror, wallshare, assign', () => {
  it('keeps them and drops defaults', () => {
    const g = validateSiteState(richSite()).groups[0];
    expect(g).toMatchObject({ tier: 'HV', mirror: true, wallshare: 'back' });
    expect(g.assign).toEqual({ 'item:dust': { unit: 1, zone: 'dot2' } });
    const plain = validateSiteState(
      siteWith({ mirror: false, wallshare: 'auto', hatchTiers: {}, assign: {} }),
    ).groups[0];
    for (const k of ['tier', 'hatchTiers', 'mirror', 'wallshare', 'assign']) expect(k in plain).toBe(false);
  });

  it('accepts unit "all", a zone alone, and drops empty assignments', () => {
    const site = siteWith({
      assign: { 'item:dust': { unit: 'all' }, 'item:gone': { zone: 'dot3' }, 'item:other': {} },
    });
    expect(validateSiteState(site).groups[0].assign).toEqual({
      'item:dust': { unit: 'all' },
      'item:gone': { zone: 'dot3' },
    });
    const zone = validateSiteState(siteWith({ assign: { 'item:dust': { zone: 'dot3' } } }));
    expect(zone.groups[0].assign).toEqual({ 'item:dust': { zone: 'dot3' } });
    expect(validateSiteState(siteWith({ assign: { 'item:gone': { unit: 0 } } })).groups[0].assign).toEqual({
      'item:gone': { unit: 0 },
    });
  });

  it('takes the short hatch key for kinds without a resource only', () => {
    const hatchTiers = { 'energy:0': 'HV', 'dynamo:1': 'EV', 'maintenance:0': 'LV', 'muffler:0': 'MV' };
    expect(validateSiteState(siteWith({ hatchTiers })).groups[0].hatchTiers).toEqual(hatchTiers);
    for (const key of ['itemIn:0', 'fluidOut:2', 'energy:x'])
      expect(() => validateSiteState(siteWith({ hatchTiers: { [key]: 'LV' } })), key).toThrow(
        PlanFormatError,
      );
  });

  it('rejects bad values', () => {
    const bad: Record<string, unknown>[] = [
      { tier: 'XL' },
      { hatchTiers: { 'itemIn:0': 'LV' } },
      { hatchTiers: { 'itemIn:item:dust:first': 'LV' } },
      { hatchTiers: { 'itemIn:item:dust:0': 'huge' } },
      { mirror: 'true' },
      { wallshare: 'sideways' },
      { assign: [] },
      { assign: { 'item:dust': { unit: -1 } } },
      { assign: { 'item:dust': { unit: 'some' } } },
      { assign: { 'item:dust': { unit: 1.5 } } },
      { assign: { 'item:dust': { zone: 'dot 2' } } },
      { assign: { 'item:dust': { zone: 4 } } },
      { assign: { 'item:dust': 'all' } },
      { assign: JSON.parse('{"__proto__": {"unit": 1}}') },
    ];
    for (const extra of bad)
      expect(() => validateSiteState(siteWith(extra)), JSON.stringify(extra)).toThrow(PlanFormatError);
  });
});

describe('site group: transformer step and amps', () => {
  const single = { multiblockId: 'single-block', machine: 'macerator', tier: 'MV', step: 'down', amps: 16 };

  it('round-trips on a single block', async () => {
    const site = siteWith(single);
    expect(validateSiteState(site).groups[0]).toMatchObject({ tier: 'MV', step: 'down', amps: 16 });
    expect(await decodeSite(await encodeSite(site))).toEqual(validateSiteState(site));
    expect(siteFromJson(siteToJson(site))).toEqual(validateSiteState(site));
  });

  it('rejects bad shapes', () => {
    for (const extra of [
      { step: 'sideways' },
      { amps: 3 },
      { amps: 1 },
      { amps: 2 },
      { amps: '4' },
      { step: 1 },
    ])
      expect(() => validateSiteState(siteWith({ ...single, ...extra })), JSON.stringify(extra)).toThrow(
        PlanFormatError,
      );
  });
});

describe('stale and out-of-range group settings', () => {
  it('keeps hatch tiers of a resource the site does not have, and short keys', () => {
    const g = validateSiteState(
      siteWith({
        hatchTiers: {
          'itemIn:item:dust:0': 'HV',
          'itemIn:item:gone:0': 'HV',
          'fluidOut:item:gone:shared': 'EV',
          'energy:0': 'MV',
        },
      }),
    ).groups[0];
    expect(g.hatchTiers).toEqual({
      'energy:0': 'MV',
      'itemIn:item:dust:0': 'HV',
      'itemIn:item:gone:0': 'HV',
      'fluidOut:item:gone:shared': 'EV',
    });
  });

  it('keeps a transformer step and amps on a group that is not a single block', () => {
    const g = validateSiteState(siteWith({ step: 'up', amps: 16 })).groups[0];
    expect(g).toMatchObject({ step: 'up', amps: 16 });
  });

  it('round-trips the group fields through JSON, a link and localStorage, unlinked choices included', async () => {
    const site = siteWith({
      tier: 'HV',
      hatchTiers: { 'itemIn:item:dust:0': 'EV', 'energy:0': 'MV', 'itemIn:item:gone:1': 'LV' },
      mirror: true,
      wallshare: 'stack',
      assign: { 'item:dust': { unit: 'all', zone: 'dot3' }, 'item:gone': { unit: 0 } },
    });
    expect(siteFromJson(siteToJson(site))).toEqual(site);
    expect(await decodeSite(await encodeSite(site))).toEqual(site);
    const st = memory();
    expect(saveStoredSite(site, st)).toBe(true);
    expect(loadStoredSite(st)).toEqual(site);
  });

  it('keeps settings for unit indices at or above the count', () => {
    const g = validateSiteState(
      siteWith({
        count: 2,
        hatchTiers: { 'itemIn:item:dust:9': 'IV' },
        assign: { 'item:dust': { unit: 9 } },
      }),
    ).groups[0];
    expect(g.hatchTiers).toEqual({ 'itemIn:item:dust:9': 'IV' });
    expect(g.assign).toEqual({ 'item:dust': { unit: 9 } });
  });

  it('sitesEqual ignores the order of hatchTiers and assign keys', () => {
    const a = siteWith({
      hatchTiers: { 'itemIn:item:dust:0': 'HV', 'energy:0': 'MV' },
      assign: { 'item:dust': { unit: 0 }, 'item:other': { zone: 'dot2' } },
    });
    const b = siteWith({
      hatchTiers: { 'energy:0': 'MV', 'itemIn:item:dust:0': 'HV' },
      assign: { 'item:other': { zone: 'dot2' }, 'item:dust': { unit: 0 } },
    });
    for (const s of [a, b]) s.resources['item:other'] = { kind: 'item', name: 'Other', color: '#112233' };
    expect(sitesEqual(a, b)).toBe(true);
    b.groups[0].tier = 'LV';
    expect(sitesEqual(a, b)).toBe(false);
  });
});

describe('plan link refuses what the JSON path refuses', () => {
  it('refuses a hatch tier key such as __proto__', async () => {
    const k = JSON.parse('{"__proto__": 3}');
    const base = defaultPlan();
    expect(() => validatePlanState({ ...base, hatchTiers: k })).toThrow(PlanFormatError);
    const link = await rawLink({ v: 1, m: base.multiblockId, h: 0, k });
    await expect(decodePlan(link)).rejects.toThrow(PlanFormatError);
  });
});

describe('effectiveRouting', () => {
  it('maps the old connect-below switch to a depth when the site has no routing', () => {
    expect(effectiveRouting(emptySite(), true)).toEqual({ style: 'classic', depth: 1 });
    expect(effectiveRouting(emptySite(), false)).toEqual({ style: 'classic', depth: 0 });
  });

  it("returns the site's own routing and ignores the switch", () => {
    const site = { ...emptySite(), routing: { style: 'neat', depth: 3 } } as SiteState;
    expect(effectiveRouting(site, true)).toEqual({ style: 'neat', depth: 3 });
    expect(effectiveRouting(site, false)).toEqual({ style: 'neat', depth: 3 });
  });
});

describe('glass tier', () => {
  it('round-trips on a plan through JSON, a link and localStorage', async () => {
    const plan = { ...richPlan(), glassTier: 'UV' } as PlanState;
    expect(planFromJson(planToJson(plan))).toEqual(plan);
    expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    const st = memory();
    expect(saveStoredPlan(plan, st)).toBe(true);
    expect(loadStoredPlan(st)).toEqual(plan);
    expect(plansEqual(plan, { ...plan, glassTier: 'ZPM' })).toBe(false);
  });

  it('uses the link key g, and a link without it (or a plan without the field) decodes unchanged', async () => {
    const old = await decodePlan(
      await rawLink({ v: 1, m: 'distillation-tower', h: 0, t: 4, k: { 'energy:0': 5 } }),
    );
    expect(old).toMatchObject({ tier: 'EV', hatchTiers: { 'energy:0': 'IV' } });
    expect('glassTier' in old).toBe(false);
    const withGlass = await decodePlan(await rawLink({ v: 1, m: 'distillation-tower', h: 0, g: 8 }));
    expect(withGlass.glassTier).toBe('UV');
    const plain = defaultPlan();
    expect(await encodePlan({ ...plain })).toBe(await encodePlan(plain));
    expect(validatePlanState({ ...plain, glassTier: null } as unknown as PlanState)).toEqual(plain);
    expect(planFromJson(planToJson(richPlan())).glassTier).toBeUndefined();
  });

  it('rejects bad plan values', async () => {
    for (const glassTier of ['XL', 3, []])
      expect(() => validatePlanState({ ...defaultPlan(), glassTier } as unknown as PlanState)).toThrow(
        PlanFormatError,
      );
    for (const g of [99, -1, 1.5, '8']) {
      const link = await rawLink({ v: 1, m: 'distillation-tower', h: 0, g });
      await expect(decodePlan(link), String(g)).rejects.toThrow(PlanFormatError);
    }
  });

  it('round-trips on a site group, drops it when unset, and rejects bad values', async () => {
    const site = siteWith({ glassTier: 'UV' });
    expect(validateSiteState(site).groups[0].glassTier).toBe('UV');
    expect(siteFromJson(siteToJson(site))).toEqual(site);
    expect(await decodeSite(await encodeSite(site))).toEqual(site);
    const st = memory();
    expect(saveStoredSite(site, st)).toBe(true);
    expect(loadStoredSite(st)).toEqual(site);
    expect('glassTier' in validateSiteState(siteWith({ glassTier: null })).groups[0]).toBe(false);
    expect('glassTier' in validateSiteState(richSite()).groups[0]).toBe(false);
    for (const glassTier of ['XL', 3, []])
      expect(() => validateSiteState(siteWith({ glassTier }))).toThrow(PlanFormatError);
  });
});

describe('shared maintenance and energy hatches', () => {
  const shared = { ...defaultPlan('pyrolyse-oven'), shareMaintenance: true, shareEnergy: true } as PlanState;

  it('plan: round-trips through JSON, a link and localStorage', async () => {
    expect(planFromJson(planToJson(shared))).toEqual(shared);
    expect(await decodePlan(await encodePlan(shared))).toEqual(shared);
    const st = memory();
    expect(saveStoredPlan(shared, st)).toBe(true);
    expect(loadStoredPlan(st)).toEqual(shared);
    for (const one of [{ shareMaintenance: true }, { shareEnergy: true }]) {
      const plan = { ...defaultPlan('pyrolyse-oven'), ...one };
      expect(await decodePlan(await encodePlan(plan))).toEqual(plan);
    }
  });

  it('plan: writes nothing when off, and uses the link keys a and e', async () => {
    const plain = defaultPlan('pyrolyse-oven');
    const off = validatePlanState({ ...plain, shareMaintenance: false, shareEnergy: false });
    expect(off).toEqual(plain);
    expect(Object.keys(off)).toEqual(Object.keys(plain));
    expect(await encodePlan({ ...plain, shareEnergy: false })).toBe(await encodePlan(plain));
    expect(await encodePlan(shared)).not.toBe(await encodePlan(plain));
    const link = await rawLink({ v: 1, m: 'pyrolyse-oven', h: 0, a: 1, e: 1 });
    expect(await decodePlan(link)).toMatchObject({ shareMaintenance: true, shareEnergy: true });
    expect(plansEqual(shared, plain)).toBe(false);
  });

  it('plan: rejects bad values', async () => {
    const base = defaultPlan('pyrolyse-oven');
    for (const extra of [{ shareMaintenance: 'yes' }, { shareEnergy: 1 }])
      expect(() => validatePlanState({ ...base, ...extra }), JSON.stringify(extra)).toThrow(PlanFormatError);
    for (const extra of [{ a: 0 }, { a: true }, { e: 2 }, { e: 'x' }])
      await expect(
        decodePlan(await rawLink({ v: 1, m: 'pyrolyse-oven', h: 0, ...extra })),
        JSON.stringify(extra),
      ).rejects.toThrow(PlanFormatError);
  });

  it('site group: keeps them, drops defaults, and round-trips through JSON and a link', async () => {
    const site = validateSiteState(siteWith({ shareMaintenance: true, shareEnergy: true }));
    expect(site.groups[0]).toMatchObject({ shareMaintenance: true, shareEnergy: true });
    expect(siteFromJson(siteToJson(site))).toEqual(site);
    expect(await decodeSite(await encodeSite(site))).toEqual(site);
    const plain = validateSiteState(siteWith({ shareMaintenance: false, shareEnergy: false })).groups[0];
    expect('shareMaintenance' in plain).toBe(false);
    expect('shareEnergy' in plain).toBe(false);
    expect(() => validateSiteState(siteWith({ shareEnergy: 'true' }))).toThrow(PlanFormatError);
  });
});
