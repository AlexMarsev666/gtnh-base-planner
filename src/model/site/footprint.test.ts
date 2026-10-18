import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { effectiveRouting, siteFromJson } from '../../share/siteCodec';
import { arrangeSite } from './arrange';
import { annealGroups } from './anneal';
import { createSiteBuilder, localFootprints, localHeights, localTerminals } from './build';
import { buildGroup, type Demand, type Toward } from './group';
import { placeGroups, type GroupCache } from './groups';
import type { SiteState } from './types';
import type { HatchKind } from '../multiblock/types';
import type { Dir } from '../core/types';

const fixture = (name: string): SiteState =>
  siteFromJson(readFileSync(new URL(`../../share/fixtures/${name}.json`, import.meta.url), 'utf8'));

const TEMPLATES = ['user-oil-1cracker', 'user-oil-2crackers', 'user-titanium'];

describe('a group’s footprint does not depend on where its neighbours are', () => {
  it.each(TEMPLATES)('%s: same footprints as saved and after Arrange', (name) => {
    const site = fixture(name);
    const below = effectiveRouting(site, false).depth > 0;
    const builder = createSiteBuilder();
    const measured = () => builder(site, { pipes: false, cables: false, below });
    const saved = localFootprints(measured());
    const heights = localHeights(measured());
    const ends = localTerminals(measured());
    const arranged = arrangeSite(site, (id) => saved.get(id), {
      floors: { heightOf: (id) => heights.get(id) ?? 1 },
      ends: (id) => ends.get(id),
    });
    const after = localFootprints(
      builder({ ...site, groups: arranged.groups }, { pipes: false, cables: false, below }),
    );
    expect([...after]).toEqual([...saved]);
  });

  it('lets Optimize iterate on the oil cracker template, and keeps its start valid', () => {
    const site = fixture('user-oil-1cracker');
    const below = effectiveRouting(site, false).depth > 0;
    const builder = createSiteBuilder();
    const measured = builder(site, { pipes: false, cables: false, below });
    const sizes = localFootprints(measured);
    const heights = localHeights(measured);
    const arranged = {
      ...site,
      groups: arrangeSite(site, (id) => sizes.get(id), {
        floors: { heightOf: (id) => heights.get(id) ?? 1 },
        ends: (id) => localTerminals(measured).get(id),
      }).groups,
    };
    const built = builder(arranged, { pipes: false, cables: false, below });
    const fps = localFootprints(built);
    const r = annealGroups(arranged, (id) => fps.get(id), {
      seed: 1,
      iterations: 100,
      heightOf: (id) => localHeights(built).get(id) ?? 1,
      ends: localTerminals(built),
    });
    expect(r.iterations).toBeGreaterThan(0);
    const result = builder({ ...arranged, groups: r.groups }, { pipes: false, cables: false, below });
    expect(result.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
  });

  const SAMPLE = [
    'electric-blast-furnace',
    'oil-cracking-unit',
    'distillation-tower',
    'mega-oil-cracker',
    'pyrolyse-oven',
    'vacuum-freezer',
    'multi-smelter',
    'large-chemical-reactor',
    'assembly-line',
    'mega-chemical-reactor',
    'industrial-centrifuge',
    'implosion-compressor',
  ];
  const KINDS: HatchKind[] = ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'energy', 'dynamo'];
  const DIRS: Dir[] = ['north', 'east', 'south', 'west'];
  const demand: Demand = {
    itemIn: ['item:a', 'item:b'],
    itemOut: ['item:c'],
    fluidIn: ['fluid:a', 'fluid:b'],
    fluidOut: ['fluid:c', 'fluid:d'],
  };

  it.each(SAMPLE)('%s: a different direction per kind gives the footprint of none', (id) => {
    const def = getMultiblock(id)!;
    const limits = { x: null, y: null, z: null };
    const plain = buildGroup(def, 2, limits, ['energy', 'maintenance'], demand);
    for (let shift = 0; shift < 4; shift++) {
      const toward: Toward = Object.fromEntries(KINDS.map((k, i) => [k, DIRS[(i + shift) % 4]]));
      const b = buildGroup(def, 2, limits, ['energy', 'maintenance'], demand, false, toward);
      expect(b.size).toEqual(plain.size);
      expect(b.units).toEqual(plain.units);
    }
  });

  it('reuses the layout when only the pipe directions change', () => {
    const g = {
      id: 'g',
      multiblockId: 'oil-cracking-unit',
      count: 2,
      limits: { x: null, y: null, z: null },
      enabledHatches: ['energy', 'maintenance'] as HatchKind[],
      origin: [0, 0] as [number, number],
      rotation: 0 as const,
    };
    const s: SiteState = {
      v: 1,
      kind: 'site',
      size: [40, 40],
      corridor: 2,
      groups: [g],
      links: [],
      ports: [],
      resources: {},
      colors: {},
    };
    const cache: GroupCache = new Map();
    const run = (dir: Dir) =>
      placeGroups(s, new Map([['g', demand]]), () => ({ fluidIn: dir, fluidOut: dir }), false, cache, false)
        .groups[0].build!;
    const a = run('north');
    const b = run('south');
    expect(b).not.toBe(a);
    // The same pack object: the layout was not chosen again.
    expect(b.pack).toBe(a.pack);
    expect(b.size).toEqual(a.size);
    expect(cache.size).toBe(2);
  });

  it.each(SAMPLE)('%s: any toward gives the footprint of none', (id) => {
    const def = getMultiblock(id)!;
    expect(def).toBeTruthy();
    const limits = { x: null, y: null, z: null };
    for (const count of [1, 3]) {
      const plain = buildGroup(def, count, limits, ['energy', 'maintenance'], demand);
      for (const dir of DIRS) {
        const toward: Toward = Object.fromEntries(KINDS.map((k) => [k, dir]));
        const b = buildGroup(def, count, limits, ['energy', 'maintenance'], demand, false, toward);
        expect(b.size).toEqual(plain.size);
        expect(b.units).toEqual(plain.units);
        expect(b.unplaced.length).toBeLessThanOrEqual(plain.unplaced.length);
      }
    }
  });
});
