import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteFromJson } from '../../share/siteCodec';
import { AbortedError, FLOOR_CLEARANCE, arrangeSite, grownSize } from './arrange';
import { createSiteBuilder, localFootprints, localHeights, localTerminals } from './build';
import type { Terminals } from './terminals';
import type { SiteGroup, SiteState } from './types';

function g(id: string, multiblockId: string, count = 1): SiteGroup {
  return {
    id,
    multiblockId,
    count,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [],
    origin: [0, 0],
    rotation: 0,
  };
}

function chain(): SiteState {
  const res = (name: string) => ({ kind: 'item' as const, name, color: '#888888' });
  return {
    v: 1,
    kind: 'site',
    size: [30, 30],
    corridor: 2,
    groups: [
      g('d', 'vacuum-freezer'),
      g('a', 'electric-blast-furnace', 2),
      g('b', 'large-chemical-reactor'),
      g('c', 'implosion-compressor'),
    ],
    links: [
      { id: '1', from: { group: 'a' }, to: { group: 'b' }, resource: 'r1' },
      { id: '2', from: { group: 'a' }, to: { group: 'c' }, resource: 'r2' },
      { id: '3', from: { group: 'b' }, to: { group: 'd' }, resource: 'r3' },
      { id: '4', from: { group: 'c' }, to: { group: 'd' }, resource: 'r4' },
      // A recycling loop back to the start must not break the layering.
      { id: '5', from: { group: 'd' }, to: { group: 'a' }, resource: 'r5' },
    ],
    ports: [],
    resources: { r1: res('1'), r2: res('2'), r3: res('3'), r4: res('4'), r5: res('5') },
    colors: {},
  };
}

describe('arrangeSite', () => {
  it('orders groups west to east along the flow, without overlaps, inside the site', () => {
    const site = chain();
    const build = createSiteBuilder();
    const sizes = localFootprints(build(site, { pipes: false, cables: false }));
    const r = arrangeSite(site, (id) => sizes.get(id));
    expect(r.fits).toBe(true);
    const x = Object.fromEntries(r.groups.map((gr) => [gr.id, gr.origin[0]]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.a).toBeLessThan(x.c);
    expect(x.b).toBeLessThan(x.d);
    expect(x.b).toBe(x.c);
    const placed = build({ ...site, groups: r.groups }, { pipes: true, cables: false });
    expect(placed.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
    for (const n of placed.nets) expect(n.route!.connected).toBe(n.route!.total);
    // The west edge is left for the input ports.
    for (const gr of placed.groups) expect(gr.min[0]).toBeGreaterThanOrEqual(3);
  });

  it('reports the size it needs when the site is too small', () => {
    const site = { ...chain(), size: [12, 12] as [number, number] };
    const r = arrangeSite(site, () => [5, 5]);
    expect(r.fits).toBe(false);
    expect(r.needed[0]).toBeGreaterThan(12);
  });

  it('grows a site that is too small in both directions, as square as it can', () => {
    // Twenty unlinked groups form one column: at 30 deep it needs a long row of sub-columns.
    const groups = Array.from({ length: 20 }, (_, i) => g(`g${i}`, 'electric-blast-furnace'));
    const site: SiteState = { ...chain(), groups, links: [] };
    const sizeOf = () => [9, 9] as [number, number];
    const narrow = arrangeSite(site, sizeOf);
    expect(narrow.fits).toBe(false);
    const size = grownSize(site, sizeOf, 128);
    const grown = arrangeSite({ ...site, size }, sizeOf);
    expect(grown.fits).toBe(true);
    expect(size[1]).toBeGreaterThan(30);
    expect(Math.max(...size)).toBeLessThan(narrow.needed[0]);
    expect(Math.abs(size[0] - size[1])).toBeLessThan(Math.max(...size) / 2);
  });

  it('leaves room along the edges for the ports', () => {
    const ports = Array.from({ length: 25 }, (_, i) => ({
      id: `in${i}`,
      dir: 'in' as const,
      resource: 'r1',
    }));
    const size = grownSize({ ...chain(), ports }, () => [5, 5], 128);
    expect(size[1]).toBeGreaterThanOrEqual(2 * 25 - 1);
  });

  it('splits a column that is too deep and turns groups to fit', () => {
    const site: SiteState = { ...chain(), links: [], size: [40, 20] };
    const r = arrangeSite(site, () => [4, 9]);
    const xs = new Set(r.groups.map((gr) => gr.origin[0]));
    expect(xs.size).toBeGreaterThan(1);
    for (const gr of r.groups) expect(gr.origin[1]).toBeGreaterThanOrEqual(2);
  });
});

describe('arrangeSite on floors', () => {
  /** Six unlinked-in-a-row groups: each link puts the next one a column east. */
  function line(n: number, size: [number, number]): SiteState {
    const groups = Array.from({ length: n }, (_, i) => g(`g${i}`, 'electric-blast-furnace'));
    const links = groups.slice(1).map((gr, i) => ({
      id: `l${i}`,
      from: { group: groups[i].id },
      to: { group: gr.id },
      resource: 'r',
    }));
    return { ...chain(), size, groups, links, resources: chain().resources };
  }
  const sizeOf = () => [6, 6] as [number, number];
  const heightOf = () => 5;

  it('keeps everything on the ground, as before, unless asked for floors', () => {
    const r = arrangeSite(line(6, [20, 20]), sizeOf);
    expect(r.floors).toBe(1);
    expect(r.fits).toBe(false);
    expect(r.needed[0]).toBeGreaterThan(20);
    expect(r.groups.every((gr) => gr.elevation === undefined)).toBe(true);
  });

  it('puts the columns that do not fit the width on a floor above, inside the site', () => {
    const site = line(6, [20, 20]);
    const r = arrangeSite(site, sizeOf, { floors: { heightOf } });
    expect(r.floors).toBeGreaterThan(1);
    expect(r.fits).toBe(true);
    expect(r.needed[0]).toBeLessThanOrEqual(20);
    for (const gr of r.groups) {
      expect(gr.origin[0]).toBeGreaterThanOrEqual(0);
      expect(gr.origin[0] + 6).toBeLessThanOrEqual(20);
    }
    const heights = [...new Set(r.groups.map((gr) => gr.elevation ?? 0))].sort((a, b) => a - b);
    // The next floor starts above the tallest group below it and a clearance for pipes.
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBe(5 + FLOOR_CLEARANCE);
  });

  it('runs the second floor back towards the start, so the chain ends where the next floor begins', () => {
    const r = arrangeSite(line(6, [20, 20]), sizeOf, { floors: { heightOf } });
    const first = r.groups.filter((gr) => !gr.elevation);
    const second = r.groups.filter((gr) => gr.elevation);
    const lastOfFirst = first.reduce((a, b) => (b.origin[0] > a.origin[0] ? b : a));
    const startOfSecond = second.find((gr) => gr.id === `g${first.length}`)!;
    expect(Math.abs(startOfSecond.origin[0] - lastOfFirst.origin[0])).toBeLessThan(6);
  });

  it('does not stack anything while one floor is enough, and clears a stale elevation', () => {
    const site = line(2, [40, 40]);
    site.groups[1].elevation = 9;
    const r = arrangeSite(site, sizeOf, { floors: { heightOf } });
    expect(r.floors).toBe(1);
    expect(r.groups.every((gr) => gr.elevation === undefined)).toBe(true);
  });

  it('builds floors with no overlaps and every pipe connected', () => {
    const site = { ...chain(), size: [14, 30] as [number, number] };
    const build = createSiteBuilder();
    const first = build(site, { pipes: false, cables: false });
    const sizes = localFootprints(first);
    const heights = localHeights(first);
    const r = arrangeSite(site, (id) => sizes.get(id), {
      floors: { heightOf: (id) => heights.get(id) ?? 1 },
    });
    expect(r.floors).toBeGreaterThan(1);
    const placed = build({ ...site, groups: r.groups }, { pipes: true, cables: false });
    expect(placed.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
    const top = Math.max(...placed.groups.map((pg) => pg.max[1]));
    expect(top).toBeGreaterThan(Math.max(...placed.groups.map((pg) => pg.max[1] - pg.min[1])));
  });
});

describe('arrangeSite layout', () => {
  it('lines groups up: a column shares its west edge, all columns their north edge', () => {
    const site = { ...chain(), links: chain().links.slice(0, 4) };
    const sizes: Record<string, [number, number]> = { a: [9, 5], b: [5, 9], c: [7, 7], d: [11, 6] };
    const r = arrangeSite(site, (id) => sizes[id]);
    const by = Object.fromEntries(r.groups.map((gr) => [gr.id, gr]));
    // b and c are fed by a alone: one column.
    expect(by.b.origin[0]).toBe(by.c.origin[0]);
    // Every column starts at the same north edge.
    const topOf = new Map<number, number>();
    for (const gr of r.groups)
      topOf.set(gr.origin[0], Math.min(topOf.get(gr.origin[0]) ?? Infinity, gr.origin[1]));
    expect(topOf.size).toBe(3);
    expect(new Set(topOf.values()).size).toBe(1);
  });
});

describe('arrangeSite is idempotent', () => {
  const fixture = (name: string) =>
    siteFromJson(readFileSync(new URL(`../../share/fixtures/${name}`, import.meta.url), 'utf8'));

  function line(n: number, size: [number, number]): SiteState {
    const groups = Array.from({ length: n }, (_, i) => g(`g${i}`, 'electric-blast-furnace'));
    const links = groups.slice(1).map((gr, i) => ({
      id: `l${i}`,
      from: { group: groups[i].id },
      to: { group: gr.id },
      resource: 'r',
    }));
    return { ...chain(), size, groups, links, resources: chain().resources };
  }

  const odd = (id: string): [number, number] => [
    3 + (id.charCodeAt(id.length - 1) % 5),
    4 + (id.length % 3) * 2,
  ];
  const cases: [string, SiteState, ((id: string) => [number, number]) | 'real', boolean][] = [
    ['chain', chain(), 'real', false],
    ['chain on floors', { ...chain(), size: [14, 30] }, 'real', true],
    ['line', line(6, [60, 30]), odd, false],
    ['line on floors', line(6, [20, 20]), odd, true],
    ['too deep, rotated', { ...chain(), links: [], size: [40, 20] }, () => [4, 9], false],
    ['site fixture', fixture('site.json'), 'real', false],
    ['import fixture', fixture('import.json'), 'real', true],
  ];

  it.each(cases)('%s', (_, site, sizing, floors) => {
    const build = createSiteBuilder();
    const first = build(site, { pipes: false, cables: false });
    const footprints = localFootprints(first);
    const heights = localHeights(first);
    const sizeOf = sizing === 'real' ? (id: string) => footprints.get(id) : sizing;
    const opts = floors ? { floors: { heightOf: (id: string) => heights.get(id) ?? 6 } } : {};
    const once = arrangeSite(site, sizeOf, opts);
    const twice = arrangeSite({ ...site, groups: once.groups }, sizeOf, opts);
    expect(twice).toEqual(once);
    // Starting from turned groups changes nothing either.
    const turned = site.groups.map((gr, i) => ({ ...gr, rotation: ((i + 1) % 4) as 0 | 1 | 2 | 3 }));
    expect(arrangeSite({ ...site, groups: turned }, sizeOf, opts)).toEqual(once);
  });
});

describe('arrangeSite progress and cancel', () => {
  it('reports growing progress up to the total', () => {
    const calls: [number, number][] = [];
    let t = 0;
    arrangeSite(chain(), () => [6, 6], {
      now: () => (t += 100),
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls.length).toBeGreaterThan(1);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
    expect(calls[calls.length - 1][0]).toBe(calls[calls.length - 1][1]);
  });

  it('throws AbortedError when the signal is aborted, before or during', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => arrangeSite(chain(), () => [6, 6], { signal: controller.signal })).toThrow(AbortedError);
    const later = new AbortController();
    expect(() =>
      arrangeSite(chain(), () => [6, 6], {
        signal: later.signal,
        now: () => 0,
        onProgress: () => later.abort(),
      }),
    ).toThrow(AbortedError);
  });
});

describe('arrangeSite faces hatches along the flow', () => {
  /** a gives r to b. Square groups: only the hatches decide the turn. Cells are local, in 6 x 6. */
  const pair = (): SiteState => ({
    ...chain(),
    groups: [g('a', 'electric-blast-furnace'), g('b', 'electric-blast-furnace')],
    links: [{ id: '1', from: { group: 'a' }, to: { group: 'b' }, resource: 'r1' }],
    resources: chain().resources,
  });
  const six = () => [6, 6] as [number, number];
  /** Hatches may only go on the west column (cell x = 0) or the east one (x = 5). */
  const westBox = [0, 1, 2, 3] as const;
  const eastBox = [5, 6, 2, 3] as const;
  const endsOf = (west: boolean) => (id: string) => ({
    r1: id === 'a' ? (west ? westBox : eastBox) : west ? eastBox : westBox,
  });

  it('turns a square group half way so its output faces downstream and its input upstream', () => {
    // Hatches on the wrong sides (a's output on its west, b's input on its east): both are turned.
    const wrong = arrangeSite(pair(), six, { ends: endsOf(true) });
    expect(wrong.groups.map((gr) => gr.rotation)).toEqual([2, 2]);
    // Hatches already on the right sides: no turn, and without any information no turn either.
    const right = arrangeSite(pair(), six, { ends: endsOf(false) });
    expect(right.groups.map((gr) => gr.rotation)).toEqual([0, 0]);
    expect(arrangeSite(pair(), six).groups.map((gr) => gr.rotation)).toEqual([0, 0]);
  });

  it('is idempotent and independent of the current turns, with hatches', () => {
    const opts = { ends: endsOf(true) };
    const once = arrangeSite(pair(), six, opts);
    expect(arrangeSite({ ...pair(), groups: once.groups }, six, opts)).toEqual(once);
    const turned = pair().groups.map((gr, i) => ({ ...gr, rotation: ((i + 1) % 4) as 0 | 1 | 2 | 3 }));
    expect(arrangeSite({ ...pair(), groups: turned }, six, opts)).toEqual(once);
  });

  it('faces the other way on the floors that run back', () => {
    const line: SiteState = {
      ...pair(),
      size: [20, 20],
      groups: Array.from({ length: 6 }, (_, i) => g(`g${i}`, 'electric-blast-furnace')),
      links: Array.from({ length: 5 }, (_, i) => ({
        id: `l${i}`,
        from: { group: `g${i}` },
        to: { group: `g${i + 1}` },
        resource: `l${i}`,
      })),
    };
    // Every group takes its resource on the west side and gives its own on the east side.
    const ends = (id: string) => {
      const i = Number(id.slice(1));
      return { [`l${i - 1}`]: [0, 1, 2, 3], [`l${i}`]: [5, 6, 2, 3] } as unknown as Terminals;
    };
    const r = arrangeSite(line, six, { floors: { heightOf: () => 5 }, ends });
    expect(r.floors).toBeGreaterThan(1);
    // Floors run west to east, then back, then west to east again.
    const levels = [...new Set(r.groups.map((gr) => gr.elevation ?? 0))].sort((x, y) => x - y);
    for (const gr of r.groups) expect(gr.rotation).toBe(levels.indexOf(gr.elevation ?? 0) % 2 === 1 ? 2 : 0);
  });

  const arrangeReal = (site: SiteState, withEnds = true) => {
    const first = createSiteBuilder()(site, { pipes: false, cables: false });
    const sizes = localFootprints(first);
    const ends = localTerminals(first);
    return arrangeSite(site, (id) => sizes.get(id), withEnds ? { ends: (id) => ends.get(id) } : {});
  };
  const fluid = { kind: 'fluid' as const, name: 'f', color: '#3366ff' };
  /** `from` gives a fluid to `to`, one on each side of the chain. */
  const feed = (from: string, to: string): SiteState => ({
    ...chain(),
    groups: [g('p', from), g('q', to)],
    links: [{ id: '1', from: { group: 'p' }, to: { group: 'q' }, resource: 'f' }],
    ports: [],
    resources: { f: fluid },
  });

  it('turns a cracker so the column its output hatches may go on faces the consumer, in the live build', () => {
    // The Oil Cracking Unit takes fluid outputs on one side column only. The site is shallow, so the
    // cracker keeps its long side along X and only the half turn decides which end the column is on.
    const site = {
      ...feed('oil-cracking-unit', 'large-chemical-reactor'),
      size: [40, 8] as [number, number],
    };
    const eastOf = (groups: SiteGroup[]) => {
      const live = createSiteBuilder()({ ...site, groups }, { pipes: false, cables: false });
      const [p, q] = live.groups;
      const hatches = p.hatches.filter((h) => h.resource === 'f');
      expect(hatches.length).toBeGreaterThan(0);
      expect(q.min[0]).toBeGreaterThan(p.min[0]);
      const mid = (p.min[0] + p.max[0]) / 2;
      return hatches.map((h) => h.cell[0] + 0.5 > mid);
    };
    const turned = arrangeReal(site);
    expect(turned.groups[0].rotation).toBe(2);
    expect(eastOf(turned.groups).every(Boolean)).toBe(true);
    // Without the hatch information the cracker keeps its footprint turn, and its column faces away.
    const plain = arrangeReal(site, false);
    expect(plain.groups[0].rotation).toBe(0);
    expect(eastOf(plain.groups).some(Boolean)).toBe(false);
  });

  it('leaves a machine whose hatches may go anywhere as the footprint turned it', () => {
    const site = feed('large-chemical-reactor', 'large-chemical-reactor');
    expect(arrangeReal(site).groups.map((gr) => gr.rotation)).toEqual(
      arrangeReal(site, false).groups.map((gr) => gr.rotation),
    );
  });

  it('is idempotent on a real chain, from any turns', () => {
    const site = chain();
    const once = arrangeReal(site);
    expect(arrangeReal({ ...site, groups: once.groups })).toEqual(once);
    const turned = site.groups.map((gr, i) => ({ ...gr, rotation: ((i + 1) % 4) as 0 | 1 | 2 | 3 }));
    expect(arrangeReal({ ...site, groups: turned })).toEqual(once);
  });
});
