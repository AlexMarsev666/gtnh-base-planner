import { describe, expect, it, vi } from 'vitest';
import { PLACEHOLDER_ID } from '../data/generic';
import type { PlanState } from '../model/plan/types';
import type { SiteGroup, SiteState } from '../model/site/types';
import { deflateRaw, toBase64Url } from './binary';
import { decodePlan, encodePlan, validatePlanState } from './codec';
import { planFromJson } from './persist';
import {
  decodeSite,
  decodeSiteWithReport,
  emptySite,
  encodeSite,
  siteFromJsonWithReport,
  siteToJson,
  sitesEqual,
  validateSiteStateWithReport,
} from './siteCodec';
import { SITE_STORAGE_KEY, readSiteFile, readStoredSite } from './sitePersist';

// Aliases are empty today: a stand-in table exercises the lookup through the real codecs.
vi.mock('../data/multiblock-aliases', async (orig) => {
  const m = await orig<typeof import('../data/multiblock-aliases')>();
  return {
    ...m,
    resolveMultiblockId: (id: string) => m.resolveMultiblockId(id, { 'old-oven': 'coke-oven' }),
  };
});

const NONE = { x: null, y: null, z: null };

function group(id: string, multiblockId: string, extra: Partial<SiteGroup> = {}): SiteGroup {
  return {
    id,
    multiblockId,
    count: 2,
    limits: NONE,
    enabledHatches: ['energy'],
    origin: [3, 4],
    rotation: 1,
    ...extra,
  };
}

/** Five groups chained by links; g2 and g4 name machines the catalog does not have. */
function template(): SiteState {
  const ids = ['coke-oven', 'gone-one', 'coke-oven', 'gone-two', 'coke-oven'];
  return {
    ...emptySite(),
    name: 'Chain',
    groups: ids.map((m, i) =>
      group(`g${i + 1}`, m, i === 3 ? { origin: [18, 4], label: 'My old thing', size: 5, count: 3 } : {}),
    ),
    ports: [{ id: 'p1', dir: 'in', resource: 'item:dust' }],
    links: [
      { id: 'l0', from: { port: 'p1' }, to: { group: 'g1' }, resource: 'item:dust' },
      ...[1, 2, 3, 4].map((i) => ({
        id: `l${i}`,
        from: { group: `g${i}` },
        to: { group: `g${i + 1}` },
        resource: 'item:dust',
      })),
    ],
    resources: { 'item:dust': { kind: 'item', name: 'Dust', color: '#aabbcc' } },
  };
}

function expectRepaired(site: SiteState, replaced: { group: string; id: string }[]) {
  expect(replaced).toEqual([
    { group: 'g2', id: 'gone-one' },
    { group: 'g4', id: 'gone-two' },
  ]);
  expect(site.groups.map((g) => g.multiblockId)).toEqual([
    'coke-oven',
    PLACEHOLDER_ID,
    'coke-oven',
    PLACEHOLDER_ID,
    'coke-oven',
  ]);
  expect(site.groups[1]!.label).toBe('Missing: gone-one');
  expect(site.groups[3]!.label).toBe('Missing: gone-two (My old thing)');
  expect(site.groups[3]!.count).toBe(3);
  expect(site.groups[3]!.origin).toEqual([18, 4]);
  expect(site.groups[3]!.size).toBeUndefined();
  expect(site.links).toHaveLength(5);
}

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
  };
}

async function link(data: unknown): Promise<string> {
  return toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(data))));
}

describe('templates with machines the catalog no longer has', () => {
  it('turns them into placeholders when read from JSON', () => {
    const { site, replaced } = siteFromJsonWithReport(JSON.stringify(template()));
    expectRepaired(site, replaced);
  });

  it('does the same for a link', async () => {
    const code = await link(template());
    const { site, replaced } = await decodeSiteWithReport(code);
    expectRepaired(site, replaced);
    expect((await decodeSite(code)).groups[1]!.multiblockId).toBe(PLACEHOLDER_ID);
  });

  it('does the same for a file', async () => {
    const { site, replaced } = await readSiteFile(new Blob([JSON.stringify(template())]));
    expectRepaired(site, replaced);
  });

  it('does the same for the stored value and keeps the original text', () => {
    const st = memory();
    const raw = JSON.stringify(template());
    st.setItem(SITE_STORAGE_KEY, raw);
    const result = readStoredSite(st, () => 7);
    expectRepaired(result.site!, result.replaced!);
    expect(result.error).toBeUndefined();
    expect(result.backupKey).toBe(`${SITE_STORAGE_KEY}:backup-7`);
    expect(st.getItem(result.backupKey!)).toBe(raw);
    expect(st.getItem(SITE_STORAGE_KEY)).toBe(raw);
  });

  it('reports nothing and keeps no backup for a healthy stored template', () => {
    const st = memory();
    const healthy = { ...template(), groups: [group('g1', 'coke-oven')], links: [], ports: [] };
    st.setItem(SITE_STORAGE_KEY, JSON.stringify(healthy));
    const result = readStoredSite(st);
    expect(result.replaced).toBeUndefined();
    expect(result.backupKey).toBeUndefined();
    expect(st.length).toBe(1);
  });

  it('round-trips once repaired', async () => {
    const { site } = validateSiteStateWithReport(template());
    expect(validateSiteStateWithReport(site)).toEqual({ site, replaced: [] });
    expect(JSON.parse(siteToJson(site))).toEqual(site);
    expect(await decodeSite(await encodeSite(site))).toEqual(site);
    expect(sitesEqual(template(), site)).toBe(true);
  });

  it('keeps a long label within its limit', () => {
    const s = template();
    s.groups[1]!.label = 'x'.repeat(120);
    const { site } = validateSiteStateWithReport(s);
    expect(site.groups[1]!.label).toBe('Missing: gone-one');
  });

  it('still rejects an invalid id', () => {
    const s = template();
    s.groups[1]!.multiblockId = '<script>';
    expect(() => validateSiteStateWithReport(s)).toThrow(/multiblock id is invalid/);
  });

  it('encodes an unchanged template to the same link as before', async () => {
    const s: SiteState = {
      ...emptySite(),
      name: 'Golden',
      groups: [group('a', 'coke-oven', { origin: [3, 4] })],
    };
    expect(await encodeSite(s)).toBe(
      'NY5BbsMwDAT_smcWSJqe9IG2bwh0UGTCJSyTASUFTQz_vVCb3gYLzO5uuCEcCYvohIAqjUGo8mCE8-lAp0MkZHOXyRzhlTC79WtFOG-QoSQQ1l6aXIrl5XNE2RZ-sRsrhtu1_YpFVmkVYcM3gvZSCPd_ePzBTmBNl8LTR2r5i8cMWNnnOyLBXGbRcYzeIsGtpSamCMc9jn5dhhAJV_P2ROdq3fOo2vZxp5g_WdPKCHi3MrFi_wE',
    );
  });
});

describe('plans with renamed or missing machines', () => {
  const base: PlanState = {
    v: 1,
    multiblockId: 'coke-oven',
    count: 4,
    limits: NONE,
    enabledHatches: ['energy'],
    colors: {},
  };

  it('reads an aliased id as the new one, from JSON and from a link', async () => {
    expect(validatePlanState({ ...base, multiblockId: 'old-oven' }).multiblockId).toBe('coke-oven');
    expect(planFromJson(JSON.stringify({ ...base, multiblockId: 'old-oven' })).multiblockId).toBe(
      'coke-oven',
    );
    const code = await link({ v: 1, m: 'old-oven', h: 16 });
    expect((await decodePlan(code)).multiblockId).toBe('coke-oven');
    expect(await decodePlan(await encodePlan(base))).toEqual(base);
  });

  it('still refuses an id that is neither live nor aliased', async () => {
    expect(() => validatePlanState({ ...base, multiblockId: 'gone-one' })).toThrow(/Unknown multiblock/);
    await expect(decodePlan(await link({ v: 1, m: 'gone-one', h: 16 }))).rejects.toThrow(
      /Unknown multiblock/,
    );
  });

  it('reads an aliased id in a template', () => {
    const s = template();
    s.groups[1]!.multiblockId = 'old-oven';
    const { site, replaced } = validateSiteStateWithReport(s);
    expect(site.groups[1]!.multiblockId).toBe('coke-oven');
    expect(replaced.map((r) => r.group)).toEqual(['g4']);
  });
});
