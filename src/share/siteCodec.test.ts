import { describe, expect, it } from 'vitest';
import type { SiteState } from '../model/site/types';
import { deflateRaw, PlanFormatError, toBase64Url } from './binary';
import {
  decodeSite,
  emptySite,
  encodeSite,
  siteFromJson,
  siteToJson,
  sitesEqual,
  validateSiteState,
} from './siteCodec';
import {
  clearSiteHash,
  hashSiteParam,
  loadStoredSite,
  saveStoredSite,
  SITE_STORAGE_KEY,
} from './sitePersist';

function sample(): SiteState {
  return {
    ...emptySite(),
    name: 'Steel line',
    groups: [
      {
        id: 'ebf',
        multiblockId: 'electric-blast-furnace',
        count: 3,
        limits: { x: null, y: 1, z: null },
        enabledHatches: ['muffler', 'energy', 'maintenance'],
        origin: [4, 4],
        rotation: 1,
        source: { name: 'Steel Ingot', machineCount: 2.4, tier: 'MV' },
      },
      {
        id: 'dt',
        multiblockId: 'distillation-tower',
        count: 1,
        limits: { x: null, y: null, z: null },
        enabledHatches: [],
        origin: [14, 4],
        rotation: 0,
        size: 7,
      },
    ],
    ports: [{ id: 'p1', dir: 'in', resource: 'item:dust' }],
    links: [
      { id: 'l1', from: { port: 'p1' }, to: { group: 'ebf' }, resource: 'item:dust', rate: 1.5 },
      { id: 'l2', from: { group: 'ebf' }, to: { group: 'dt' }, resource: 'item:dust' },
    ],
    resources: { 'item:dust': { kind: 'item', name: 'Steel Dust', color: '#AABBCC' } },
  };
}

describe('validateSiteState', () => {
  it('accepts a valid site and normalises it', () => {
    const s = validateSiteState(sample());
    expect(s.groups[0].enabledHatches).toEqual(['energy', 'maintenance', 'muffler']);
    expect(s.resources['item:dust'].color).toBe('#aabbcc');
    expect(s.groups[1].size).toBe(7);
  });

  it('keeps unknown machine looks for replacement, and drops machine fields on multiblocks', () => {
    const s = sample();
    s.groups.push({
      id: 'sb',
      multiblockId: 'single-block',
      count: 2,
      limits: { x: null, y: null, z: null },
      enabledHatches: [],
      origin: [1, 1],
      rotation: 0,
      machine: 'macerator',
    });
    s.groups[0].machine = 'macerator';
    const out = validateSiteState(s);
    expect(out.groups[2].machine).toBe('macerator');
    expect('machine' in out.groups[0]).toBe(false);
    s.groups[2].machine = 'flux-capacitor';
    expect(validateSiteState(s).groups[2].machine).toBe('flux-capacitor');
  });

  it('keeps the elevation of a group, and drops a zero one', () => {
    const s = sample();
    s.groups[0].elevation = 12;
    s.groups[1].elevation = 0;
    const out = validateSiteState(s);
    expect(out.groups[0].elevation).toBe(12);
    expect('elevation' in out.groups[1]).toBe(false);
  });

  it('rejects broken references and wrong port directions', () => {
    const bad1 = sample();
    bad1.links[1].to = { group: 'nope' };
    expect(() => validateSiteState(bad1)).toThrow(/unknown group/);
    const bad2 = sample();
    bad2.links[0] = { id: 'l1', from: { group: 'ebf' }, to: { port: 'p1' }, resource: 'item:dust' };
    expect(() => validateSiteState(bad2)).toThrow(/wrong way/);
    const bad3 = sample();
    bad3.links[0].resource = 'item:other';
    expect(() => validateSiteState(bad3)).toThrow(/unknown resource/);
    const bad4 = sample();
    bad4.groups[1].id = 'ebf';
    expect(() => validateSiteState(bad4)).toThrow(/used twice/);
    expect(() => validateSiteState({ ...sample(), kind: 'plan' })).toThrow(/not a site/);
    expect(() => validateSiteState({ ...sample(), size: [4, 30] })).toThrow(/Site size/);
  });

  it('rejects object-prototype names as resource keys and references', () => {
    const dust = { kind: 'item', name: 'Dust', color: '#aabbcc' };
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      // JSON.parse makes "__proto__" an own key, as a decoded link or file would.
      const bad = { ...sample(), resources: JSON.parse(`{${JSON.stringify(key)}: ${JSON.stringify(dust)}}`) };
      expect(() => validateSiteState(bad), key).toThrow(/not allowed/);
    }
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
      const port = sample();
      port.ports[0].resource = name;
      expect(() => validateSiteState(port), name).toThrow(/unknown resource/);
      const link = sample();
      link.links[1].resource = name;
      expect(() => validateSiteState(link), name).toThrow(/unknown resource/);
    }
  });

  it('accepts only gtnhplanner.com /datasets/ icon paths', () => {
    const ok = sample();
    ok.resources['item:dust'].icon =
      '/datasets/gtnh/local-2.9.0-beta-2/textures/rendered/steel_dust-1a2b3c.png';
    expect(validateSiteState(ok).resources['item:dust'].icon).toBe(ok.resources['item:dust'].icon);
    for (const icon of [
      'https://evil.example/a.png',
      '//evil.example/datasets/a.png',
      '/datasets/../a.png',
      '/datasets/a.png?x',
      'javascript:alert(1)',
    ]) {
      const bad = sample();
      bad.resources['item:dust'].icon = icon;
      expect(() => validateSiteState(bad), icon).toThrow(/icon/);
    }
  });

  it('keeps a group’s locked limits through JSON and links, and ignores anything but true', async () => {
    const data = sample() as unknown as { groups: Record<string, unknown>[] };
    data.groups[0].limitsLocked = true;
    const s = validateSiteState(data);
    expect(s.groups[0].limitsLocked).toBe(true);
    expect(siteFromJson(siteToJson(s)).groups[0].limitsLocked).toBe(true);
    expect((await decodeSite(await encodeSite(s))).groups[0].limitsLocked).toBe(true);
    data.groups[0].limitsLocked = 'yes';
    expect(validateSiteState(data).groups[0].limitsLocked).toBeUndefined();
  });

  it('round-trips through JSON and links', async () => {
    const s = validateSiteState(sample());
    expect(siteFromJson(siteToJson(s))).toEqual(s);
    const code = await encodeSite(s);
    expect(code.length).toBeLessThan(1200);
    expect(await decodeSite(code)).toEqual(s);
    expect(sitesEqual(s, sample())).toBe(true);
  });
});

describe('malformed site links and files', () => {
  const link = async (data: unknown) =>
    toBase64Url(await deflateRaw(new TextEncoder().encode(JSON.stringify(data)), { fallback: true }));

  it('rejects damaged, oversized and bomb-like links', async () => {
    await expect(decodeSite('')).rejects.toThrow(PlanFormatError);
    await expect(decodeSite('abc$def')).rejects.toThrow(PlanFormatError);
    await expect(decodeSite('A'.repeat(64 * 1024 + 4))).rejects.toThrow(PlanFormatError);
    const bomb = toBase64Url(await deflateRaw(new Uint8Array(4 * 1024 * 1024).fill(32), { fallback: true }));
    await expect(decodeSite(bomb, { fallback: true })).rejects.toThrow(/too large/);
    await expect(decodeSite(await link('not a site'))).rejects.toThrow(PlanFormatError);
    expect(() => siteFromJson('x'.repeat(1024 * 1024 + 1))).toThrow(/too large/);
  });

  it('rejects bad fields with a readable error', () => {
    const cases: [string, (s: SiteState) => void][] = [
      ['rotation', (s) => ((s.groups[0] as { rotation: number }).rotation = 4)],
      ['script id', (s) => (s.groups[0].multiblockId = '<script>')],
      ['hatch kind', (s) => ((s.groups[0].enabledHatches as string[]) = ['laser'])],
      ['colour', (s) => (s.resources['item:dust'].color = 'red')],
      ['origin', (s) => (s.groups[0].origin = [1.5, 0])],
      ['far origin', (s) => (s.groups[0].origin = [1e9, 0])],
      ['elevation', (s) => (s.groups[0].elevation = 1.5)],
      ['high elevation', (s) => (s.groups[0].elevation = 100000)],
      ['port position', (s) => (s.ports[0].pos = [-1, 0])],
      ['count', (s) => (s.groups[0].count = 0)],
      ['control characters', (s) => (s.groups[0].label = 'a\u0000b')],
    ];
    for (const [what, spoil] of cases) {
      const bad = sample();
      spoil(bad);
      expect(() => validateSiteState(bad), what).toThrow(PlanFormatError);
    }
  });

  it('leaves its input and the object prototype alone', async () => {
    const input = sample();
    const before = JSON.stringify(input);
    validateSiteState(input);
    expect(JSON.stringify(input)).toBe(before);
    const evil = await link({ ...sample(), resources: JSON.parse('{"__proto__": {"polluted": true}}') });
    await expect(decodeSite(evil)).rejects.toThrow(PlanFormatError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('site persistence', () => {
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

  it('saves, loads and keeps unreadable copies', () => {
    const st = memory();
    expect(saveStoredSite(sample(), st)).toBe(true);
    expect(loadStoredSite(st)?.name).toBe('Steel line');
    st.setItem(SITE_STORAGE_KEY, '{"broken":');
    expect(loadStoredSite(st, () => 5)).toBeNull();
    expect(st.getItem(`${SITE_STORAGE_KEY}:backup-5`)).toBe('{"broken":');
    st.setItem(SITE_STORAGE_KEY, '{"anotherBroken":');
    expect(loadStoredSite(st, () => 5)).toBeNull();
    expect(st.getItem(`${SITE_STORAGE_KEY}:backup-5`)).toBe('{"broken":');
    expect(st.getItem(`${SITE_STORAGE_KEY}:backup-5-1`)).toBe('{"anotherBroken":');
    expect(loadStoredSite(st, () => 5)).toBeNull();
    expect(st.getItem(`${SITE_STORAGE_KEY}:backup-5-2`)).toBeNull();
  });

  it('reads and clears only its own hash parameter', () => {
    expect(hashSiteParam('#p=abc&s=xyz')).toBe('xyz');
    let url = '';
    clearSiteHash({
      location: { hash: '#p=abc&s=xyz', pathname: '/x/', search: '', href: '' },
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, u?: string | URL | null) => void (url = String(u)),
      },
    });
    expect(url).toBe('/x/#p=abc');
  });
});
