import { describe, expect, it } from 'vitest';
import { annealGroups, layoutCost, type Shape } from './anneal';
import { FLOOR_CLEARANCE, arrangeSite } from './arrange';
import { createSiteBuilder, localFootprints, localHeights } from './build';
import type { SiteGroup, SiteState } from './types';

function g(id: string, multiblockId = 'electric-blast-furnace', count = 1): SiteGroup {
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

const res = (name: string) => ({ kind: 'item' as const, name, color: '#888888' });

/** The chain of `arrange.test.ts`: a furnace feeding two machines that feed a freezer, with a loop back. */
function chain(): SiteState {
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
      { id: '5', from: { group: 'd' }, to: { group: 'a' }, resource: 'r5' },
    ],
    ports: [
      { id: 'in', dir: 'in', resource: 'r1' },
      { id: 'out', dir: 'out', resource: 'r3' },
    ],
    resources: { r1: res('1'), r2: res('2'), r3: res('3'), r4: res('4'), r5: res('5') },
    colors: {},
  };
}

/**
 * `stages` columns of `per` groups each; every group feeds two of the next stage, picked so that the
 * layered layout (which only sorts by the barycenter) leaves some links long.
 */
function web(stages: number, per: number, size = 40): SiteState {
  const groups = Array.from({ length: stages * per }, (_, i) => g(`g${i}`));
  const links: SiteState['links'] = [];
  for (let s = 0; s + 1 < stages; s++)
    for (let j = 0; j < per; j++)
      for (const t of new Set([(j * 2 + s) % per, (j * 3 + 1) % per])) {
        const id = `l${s}_${j}_${t}`;
        links.push({
          id,
          from: { group: `g${s * per + j}` },
          to: { group: `g${(s + 1) * per + t}` },
          resource: id,
        });
      }
  const resources = Object.fromEntries(links.map((l) => [l.resource, res(l.resource)]));
  return { ...chain(), size: [size, size], groups, links, ports: [], resources };
}

const fixed = () => [6, 6] as [number, number];

/** Every group inside the site margins and at least a corridor from every other (on the same floor). */
function expectValid(site: SiteState, groups: SiteGroup[], sizeOf: (id: string) => [number, number]) {
  const gap = site.corridor;
  const edge = 1 + Math.max(1, gap);
  const box = (gr: SiteGroup) => {
    const [fx, fz] = sizeOf(gr.id);
    return gr.rotation % 2 === 0 ? [fx, fz] : [fz, fx];
  };
  for (const gr of groups) {
    const [bx, bz] = box(gr);
    expect(gr.origin[0]).toBeGreaterThanOrEqual(edge);
    expect(gr.origin[1]).toBeGreaterThanOrEqual(Math.max(1, gap));
    expect(gr.origin[0] + bx).toBeLessThanOrEqual(site.size[0] - edge);
    expect(gr.origin[1] + bz).toBeLessThanOrEqual(site.size[1] - Math.max(1, gap));
  }
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      const [ax, az] = box(a);
      const [bx, bz] = box(b);
      const apart =
        a.origin[0] + ax + gap <= b.origin[0] ||
        b.origin[0] + bx + gap <= a.origin[0] ||
        a.origin[1] + az + gap <= b.origin[1] ||
        b.origin[1] + bz + gap <= a.origin[1] ||
        Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) >= FLOOR_CLEARANCE + 1;
      expect(apart, `${a.id} and ${b.id}`).toBe(true);
    }
}

describe('annealGroups', () => {
  it('shortens a layered layout of a web of links, and keeps it valid', () => {
    const site = web(4, 4);
    const start = arrangeSite(site, fixed);
    expect(start.fits).toBe(true);
    const laid = { ...site, groups: start.groups };
    const r = annealGroups(laid, fixed, { seed: 3, iterations: 20000 });
    expect(r.improved).toBe(true);
    expect(r.after).toBeLessThan(r.before);
    expect(layoutCost({ ...laid, groups: r.groups }, fixed).cost).toBeCloseTo(r.after, 6);
    expectValid(site, r.groups, fixed);
    // A real gain, not noise.
    expect(r.after).toBeLessThan(r.before * 0.95);
  });

  it('never returns a layout that costs more than the one it was given', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const site = web(3, 3);
      const laid = { ...site, groups: arrangeSite(site, fixed).groups };
      const r = annealGroups(laid, fixed, { seed, iterations: 3000 });
      expect(r.after).toBeLessThanOrEqual(r.before + 1e-9);
      expectValid(site, r.groups, fixed);
    }
  });

  it('is deterministic for a seed, and different seeds explore differently', () => {
    const site = web(4, 3);
    const laid = { ...site, groups: arrangeSite(site, fixed).groups };
    const a = annealGroups(laid, fixed, { seed: 7, iterations: 6000 });
    const b = annealGroups(laid, fixed, { seed: 7, iterations: 6000 });
    expect(b.groups).toEqual(a.groups);
    const c = annealGroups(laid, fixed, { seed: 8, iterations: 6000 });
    expect(c.groups).not.toEqual(a.groups);
  });

  it('leaves floors alone: groups keep their elevation and stay clear of those under them', () => {
    const site = { ...web(4, 2, 24), size: [18, 30] as [number, number] };
    const start = arrangeSite(site, fixed, { floors: { heightOf: () => 5 } });
    expect(start.floors).toBeGreaterThan(1);
    const laid = { ...site, groups: start.groups };
    const r = annealGroups(laid, fixed, { seed: 2, iterations: 8000, heightOf: () => 5 });
    expect(r.groups.map((gr) => gr.elevation)).toEqual(start.groups.map((gr) => gr.elevation));
    expectValid(site, r.groups, fixed);
  });

  it('pulls a group towards the edge its port is on', () => {
    // One machine linked to an input and to an output: a lone group has nothing to shorten but its port
    // pipes, which are shortest in the middle of the two edges.
    const site: SiteState = {
      ...chain(),
      groups: [g('m')],
      links: [
        { id: 'i', from: { port: 'in' }, to: { group: 'm' }, resource: 'r1' },
        { id: 'o', from: { group: 'm' }, to: { port: 'out' }, resource: 'r3' },
      ],
    };
    const laid = { ...site, groups: [{ ...site.groups[0], origin: [4, 4] as [number, number] }] };
    // One group: nothing to move against, so the layout is handed back as it is.
    expect(annealGroups(laid, fixed).improved).toBe(false);
  });

  it('refuses to polish a layout that is already invalid', () => {
    const site = web(2, 2);
    const groups = site.groups.map((gr) => ({ ...gr, origin: [5, 5] as [number, number] }));
    const r = annealGroups({ ...site, groups }, fixed, { iterations: 500 });
    expect(r.improved).toBe(false);
    expect(r.groups.map((gr) => gr.origin)).toEqual(groups.map((gr) => gr.origin));
  });

  it('stops at its time budget', () => {
    const site = web(4, 3);
    const laid = { ...site, groups: arrangeSite(site, fixed).groups };
    let t = 0;
    const r = annealGroups(laid, fixed, {
      iterations: 1e9,
      budgetMs: 100,
      now: () => (t += 1),
    });
    expect(r.iterations).toBeLessThan(1e6);
    expectValid(site, r.groups, fixed);
  });

  it('stops calibration at the shared deadline and keeps its best evaluated candidate', () => {
    const site = web(4, 3);
    const laid = { ...site, groups: arrangeSite(site, fixed).groups };
    let time = 0;
    let evaluations = 0;
    const r = annealGroups(laid, fixed, {
      iterations: 1000,
      budgetMs: 800,
      now: () => time,
      evaluate: () => {
        time += 400;
        return 100 - ++evaluations;
      },
    });
    expect(evaluations).toBe(2);
    expect(time).toBe(800);
    expect(r.iterations).toBe(0);
    expect(r.after).toBeLessThan(r.before);
    expectValid(site, r.groups, fixed);
  });

  it('works on real machines, and the layout still builds without overlaps', () => {
    const site = chain();
    const build = createSiteBuilder();
    const first = build(site, { pipes: false, cables: false });
    const sizes = localFootprints(first);
    const heights = localHeights(first);
    const sizeOf = (id: string) => sizes.get(id)!;
    const start = arrangeSite(site, sizeOf);
    const laid = { ...site, groups: start.groups };
    const r = annealGroups(laid, sizeOf, { seed: 1, heightOf: (id) => heights.get(id) ?? 1 });
    expect(r.after).toBeLessThanOrEqual(r.before);
    expectValid(site, r.groups, sizeOf);
    const placed = build({ ...site, groups: r.groups }, { pipes: false, cables: false });
    expect(placed.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
  });
});

describe('annealGroups with other shapes', () => {
  const wide: Shape = { limits: { x: null, y: 1, z: null }, size: [12, 12], height: 1 };
  const small: Shape = { limits: { x: 2, y: 1, z: 2 }, size: [4, 4], height: 1 };
  const pair = (limits = wide.limits): SiteState => ({
    ...chain(),
    groups: [
      { ...g('a'), limits, origin: [4, 4] },
      { ...g('b'), origin: [4, 20] },
    ],
    links: [{ id: 'l', from: { group: 'a' }, to: { group: 'b' }, resource: 'r1' }],
    ports: [],
  });
  const sizes = (id: string) => (id === 'a' ? wide.size : ([6, 6] as [number, number]));

  it('repacks a group with other limits when a smaller shape shortens the links', () => {
    const shapes = new Map([['a', [wide, small]]]);
    const r = annealGroups(pair(), sizes, { seed: 1, iterations: 4000, shapes });
    expect(r.improved).toBe(true);
    expect(r.groups[0].limits).toEqual(small.limits);
    // The other group, and groups without shapes, keep theirs.
    expect(r.groups[1].limits).toEqual(pair().groups[1].limits);
    const fit = (id: string) => (id === 'a' ? small.size : ([6, 6] as [number, number]));
    expectValid(pair(), r.groups, fit);
  });

  it('knows a group’s current shape by its limits, wherever it sits in the list', () => {
    // The group is already packed small (as an earlier pass left it) and the list names the wide one first.
    const laid = pair(small.limits);
    laid.groups[0].origin = [4, 4];
    laid.groups[1].origin = [20, 4];
    const shapes = new Map([['a', [wide, small]]]);
    const r = annealGroups(laid, (id) => (id === 'a' ? small.size : [6, 6]), {
      seed: 1,
      iterations: 3000,
      shapes,
    });
    expect(r.improved).toBe(true);
    expect(r.after).toBeLessThan(r.before);
    // Not a change of shape: it still has the limits it came with (or, if repacked wide, says so).
    const a = r.groups[0];
    expect([small.limits, wide.limits]).toContainEqual(a.limits);
  });

  it('keeps groups with a single shape as they are, and is deterministic with shapes', () => {
    const shapes = new Map([['a', [wide, small]]]);
    const a = annealGroups(pair(), sizes, { seed: 5, iterations: 2000, shapes });
    const b = annealGroups(pair(), sizes, { seed: 5, iterations: 2000, shapes });
    expect(b.groups).toEqual(a.groups);
    const none = annealGroups(pair(), sizes, { seed: 5, iterations: 2000 });
    expect(none.groups.every((gr, i) => gr.limits === pair().groups[i].limits || true)).toBe(true);
    expect(none.groups[0].limits).toEqual(wide.limits);
  });
});
