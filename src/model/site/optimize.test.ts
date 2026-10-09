import { describe, expect, it } from 'vitest';
import { arrangeSite } from './arrange';
import { createSiteBuilder, localFootprints } from './build';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import { better, optimizeSite, scoreBuild } from './optimize';
import type { SiteState } from './types';

const res = (name: string) => ({ kind: 'item' as const, name, color: '#888888' });

function group(id: string, multiblockId: string, count = 1) {
  return {
    id,
    multiblockId,
    count,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [],
    origin: [0, 0] as [number, number],
    rotation: 0 as const,
  };
}

/** Three stages of three furnaces; every group feeds two of the next stage. */
function web(): SiteState {
  const groups = Array.from({ length: 9 }, (_, i) => group(`g${i}`, 'electric-blast-furnace'));
  const links: SiteState['links'] = [];
  for (let s = 0; s < 2; s++)
    for (let j = 0; j < 3; j++)
      for (const t of new Set([(j * 2 + s) % 3, (j * 3 + 1) % 3])) {
        const id = `l${s}_${j}_${t}`;
        links.push({
          id,
          from: { group: `g${s * 3 + j}` },
          to: { group: `g${(s + 1) * 3 + t}` },
          resource: id,
        });
      }
  return {
    v: 1,
    kind: 'site',
    size: [60, 40],
    corridor: 2,
    groups,
    links,
    ports: [],
    resources: Object.fromEntries(links.map((l) => [l.resource, res(l.resource)])),
    colors: {},
  };
}

/** A builder that measures 6 x 6 groups and scores a layout with `blocks(site)`, no real packing or routing. */
function stub(blocks: (site: SiteState) => number): SiteBuilder {
  return (site) =>
    ({
      groups: site.groups.map((g) => ({
        group: g,
        build: { size: [6, 5, 6] },
        min: [g.origin[0], 0, g.origin[1]],
        max: [g.origin[0] + 6, 5, g.origin[1] + 6],
      })),
      warnings: [],
      stats: { terminals: 4, connected: 4, pipeBlocks: blocks(site), cableBlocks: 0 },
    }) as unknown as SiteBuild;
}

function arranged(): SiteState {
  const site = web();
  return { ...site, groups: arrangeSite(site, () => [6, 6]).groups };
}

describe('optimizeSite', () => {
  it('retains the best evaluated layout by exact priorities when the scalar guide disagrees', () => {
    let evaluations = 0;
    const base = stub(() => 0);
    const builder: SiteBuilder = (site, opts) => {
      const build = base(site, opts);
      if (opts.pipes) {
        evaluations++;
        build.stats.surfaceBlocks = evaluations === 1 ? 1 : 0;
        build.stats.bends = 0;
        build.stats.pipeBlocks = evaluations === 1 ? 0 : 1;
        // Equal routing cost: the exact surface tie-break wins even when the scalar's
        // compactness term is overwhelmed by an artificially enormous span.
        if (evaluations > 1)
          for (const pg of build.groups) pg.max = [pg.max[0] + 1000000, pg.max[1], pg.max[2]];
      }
      return build;
    };
    const result = optimizeSite(arranged(), builder, {
      reshape: false,
      iterations: 0,
      refineRuns: 1,
      refineSteps: 300,
      now: () => 0,
    });
    expect(evaluations).toBeGreaterThan(1);
    expect(result.improved).toBe(true);
    expect(result.result.surface).toBe(0);
    expect(result.result.routingCost).toBe(1);
  });
  it('includes calibration in the overall budget and performs only the baseline at zero budget', () => {
    const start = arranged();
    let clock = 0;
    let routed = 0;
    const base = stub((s) => s.groups.reduce((n, g) => n + g.origin[1], 0));
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) {
        clock += 400;
        routed++;
      }
      return base(s, o);
    };
    optimizeSite(start, builder, {
      reshape: false,
      seeds: 1,
      iterations: 0,
      refineSteps: 500,
      refineRuns: 1,
      budgetMs: 10000,
      now: () => clock,
    });
    expect(clock).toBeLessThanOrEqual(10400);
    expect(routed).toBeGreaterThan(1);
    clock = 0;
    routed = 0;
    const zero = optimizeSite(start, builder, { budgetMs: 0, now: () => clock });
    expect(zero.site).toBe(start);
    expect(zero.tried).toBe(0);
    expect(routed).toBe(1);
  });

  it('searches a single group with fixed ports and improves real routes', () => {
    const s: SiteState = {
      v: 1,
      kind: 'site',
      size: [80, 80],
      corridor: 2,
      colors: {},
      groups: [{ ...group('g1', 'electric-blast-furnace'), origin: [30, 20] }],
      resources: { a: res('a'), b: res('b') },
      ports: [
        { id: 'p1', dir: 'in', resource: 'a', pos: [0, 20] },
        { id: 'p2', dir: 'out', resource: 'b', pos: [0, 26] },
      ],
      links: [
        { id: 'l1', from: { port: 'p1' }, to: { group: 'g1' }, resource: 'a' },
        { id: 'l2', from: { group: 'g1' }, to: { port: 'p2' }, resource: 'b' },
      ],
    };
    const r = optimizeSite(s, createSiteBuilder(), {
      reshape: false,
      iterations: 300,
      refineSteps: 100,
      refineRuns: 1,
      now: () => 0,
    });
    expect(r.tried).toBeGreaterThan(0);
    expect(r.result.blocks).toBeLessThan(r.start.blocks);
    expect(r.result.problems).toBeLessThanOrEqual(r.start.problems);
    expect(r.result.unconnected).toBeLessThanOrEqual(r.start.unconnected);
  });
  it('keeps a layout that routes better than the start, and only then', () => {
    const start = arranged();
    const startKey = JSON.stringify(start.groups.map((g) => g.origin));
    // The router likes whatever lies further west: the result is never worse than the start.
    const lower = optimizeSite(
      start,
      stub((s) => s.groups.reduce((t, g) => t + g.origin[0], 0)),
      {
        iterations: 4000,
      },
    );
    expect(lower.result.blocks).toBeLessThanOrEqual(lower.start.blocks);
    // A router that hates every change keeps the start.
    const same = optimizeSite(
      start,
      stub((s) => (JSON.stringify(s.groups.map((g) => g.origin)) === startKey ? 10 : 100)),
      { iterations: 4000 },
    );
    expect(same.improved).toBe(false);
    expect(same.site).toBe(start);
    expect(same.tried).toBeGreaterThan(0);
  });

  it('takes the annealed layout when the router finds it shorter', () => {
    const start = arranged();
    const startKey = JSON.stringify(start.groups.map((g) => g.origin));
    const r = optimizeSite(
      start,
      stub((s) => (JSON.stringify(s.groups.map((g) => g.origin)) === startKey ? 100 : 10)),
      { iterations: 4000 },
    );
    expect(r.improved).toBe(true);
    expect(r.site.groups).not.toEqual(start.groups);
    expect(r.result.blocks).toBe(10);
  });

  it('routes each distinct layout once, however often the annealer comes back to it', () => {
    let routed = 0;
    const counting = stub(() => 1);
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) routed++;
      return counting(s, o);
    };
    const r = optimizeSite(arranged(), builder, { iterations: 3000, refineSteps: 300 });
    // The start layout plus every different one that was tried.
    expect(routed).toBe(r.tried + 1);
  });

  it('polishes with the router: finds what the estimate alone cannot see', () => {
    // The router pays for every block a group stands south; the annealer's estimate knows nothing of that.
    const north = stub((s) => s.groups.reduce((t, g) => t + g.origin[1], 0));
    const start = arranged();
    const explore = optimizeSite(start, north, { iterations: 0, refineSteps: 0 });
    expect(explore.improved).toBe(false);
    const polish = optimizeSite(start, north, { iterations: 0, refineSteps: 400, refineRuns: 1 });
    expect(polish.improved).toBe(true);
    expect(polish.result.blocks).toBeLessThan(polish.start.blocks);
  });

  it('is never worse than the start on real machines, and every net stays connected', () => {
    const builder = createSiteBuilder();
    const site: SiteState = {
      v: 1,
      kind: 'site',
      size: [30, 30],
      corridor: 2,
      groups: [
        group('d', 'vacuum-freezer'),
        group('a', 'electric-blast-furnace', 2),
        group('b', 'large-chemical-reactor'),
        group('c', 'implosion-compressor'),
      ],
      links: [
        { id: '1', from: { group: 'a' }, to: { group: 'b' }, resource: 'r1' },
        { id: '2', from: { group: 'a' }, to: { group: 'c' }, resource: 'r2' },
        { id: '3', from: { group: 'b' }, to: { group: 'd' }, resource: 'r3' },
        { id: '4', from: { group: 'c' }, to: { group: 'd' }, resource: 'r4' },
      ],
      ports: [],
      resources: { r1: res('1'), r2: res('2'), r3: res('3'), r4: res('4') },
      colors: {},
    };
    const sizes = localFootprints(builder(site, { pipes: false, cables: false }));
    const laid = { ...site, groups: arrangeSite(site, (id) => sizes.get(id)).groups };
    const r = optimizeSite(laid, builder, { iterations: 4000 });
    expect(better(r.start, r.result)).toBe(false);
    const build = builder(r.site, { pipes: true, cables: true });
    expect(scoreBuild(build)).toEqual(r.result);
    for (const n of build.nets) expect(n.route!.connected).toBe(n.route!.total);
    expect(build.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
  });
});

describe('optimizeSite with repacking', () => {
  /** A chain of groups of several units: each can be packed in rows or layers. */
  function crowded(): SiteState {
    const r = (name: string) => res(name);
    return {
      v: 1,
      kind: 'site',
      size: [60, 40],
      corridor: 2,
      groups: [
        group('d', 'vacuum-freezer', 2),
        group('a', 'electric-blast-furnace', 4),
        group('b', 'large-chemical-reactor', 3),
        group('c', 'implosion-compressor', 2),
      ],
      links: [
        { id: '1', from: { group: 'a' }, to: { group: 'b' }, resource: 'r1' },
        { id: '2', from: { group: 'a' }, to: { group: 'c' }, resource: 'r2' },
        { id: '3', from: { group: 'b' }, to: { group: 'd' }, resource: 'r3' },
        { id: '4', from: { group: 'c' }, to: { group: 'd' }, resource: 'r4' },
      ],
      ports: [],
      resources: { r1: r('1'), r2: r('2'), r3: r('3'), r4: r('4') },
      colors: {},
    };
  }

  function laidOut() {
    const builder = createSiteBuilder();
    const site = crowded();
    const sizes = localFootprints(builder(site, { pipes: false, cables: false }));
    return { builder, site: { ...site, groups: arrangeSite(site, (id) => sizes.get(id)).groups } };
  }

  it('never does worse than the arranged start after real routing, and builds clean', () => {
    const { builder, site } = laidOut();
    const r = optimizeSite(site, builder, { refineSteps: 120, refineRuns: 1 });
    expect(better(r.start, r.result)).toBe(false);
    // The arrangement it was given is the fallback: handed back untouched unless something beat it.
    if (!r.improved) expect(r.site).toBe(site);
    const build = builder(r.site, { pipes: true, cables: true });
    expect(scoreBuild(build)).toEqual(r.result);
    for (const n of build.nets) expect(n.route!.connected).toBe(n.route!.total);
    expect(build.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
    // Repacking never changes what is built: same machines, same counts.
    expect(r.site.groups.map((g) => [g.id, g.multiblockId, g.count])).toEqual(
      site.groups.map((g) => [g.id, g.multiblockId, g.count]),
    );
    expect(build.groups.every((pg) => pg.build!.pack.placed === pg.group.count)).toBe(true);
  });

  it('repacks groups on a chain where that shortens the pipes, and says how many', () => {
    const { builder, site } = laidOut();
    const r = optimizeSite(site, builder, { refineSteps: 300, refineRuns: 1 });
    expect(r.improved).toBe(true);
    const changed = r.site.groups.filter(
      (g, i) => JSON.stringify(g.limits) !== JSON.stringify(site.groups[i].limits),
    );
    expect(r.reshaped).toBe(changed.length);
    for (const g of changed)
      expect(g.arrangeLimits).toEqual(site.groups.find((original) => original.id === g.id)!.limits);
  });

  it('never changes the limits of a locked group, but still repacks the others', () => {
    const { builder, site } = laidOut();
    const locked = {
      ...site,
      groups: site.groups.map((g) => (g.id === 'a' || g.id === 'b' ? { ...g, limitsLocked: true } : g)),
    };
    for (const steps of [120, 300]) {
      const r = optimizeSite(locked, builder, { refineSteps: steps, refineRuns: 1 });
      for (const id of ['a', 'b']) {
        const before = locked.groups.find((g) => g.id === id)!;
        const after = r.site.groups.find((g) => g.id === id)!;
        expect(after.limits).toEqual(before.limits);
        expect(after.limitsLocked).toBe(true);
      }
      expect(better(r.start, r.result)).toBe(false);
    }
    // The unlocked groups are still free to change.
    const free = optimizeSite(locked, builder, { refineSteps: 300, refineRuns: 1 });
    const freed = free.site.groups.filter(
      (g, i) => JSON.stringify(g.limits) !== JSON.stringify(locked.groups[i].limits),
    );
    expect(freed.every((g) => g.id === 'c' || g.id === 'd')).toBe(true);
  });

  it('keeps every group’s limits when repacking is switched off', () => {
    const { builder, site } = laidOut();
    const r = optimizeSite(site, builder, { refineSteps: 120, refineRuns: 1, reshape: false });
    expect(r.reshaped).toBe(0);
    expect(r.site.groups.map((g) => g.limits)).toEqual(site.groups.map((g) => g.limits));
  });
});

describe('scoreBuild', () => {
  it('counts unrouted nets as unconnected terminals, not as problems', () => {
    const build = {
      groups: [{ min: [0, 0, 0], max: [5, 5, 5] }],
      warnings: [
        { type: 'unrouted', resource: 'a', connected: 1, total: 3 },
        { type: 'overlap', groups: ['a', 'b'] },
      ],
      stats: { terminals: 10, connected: 8, pipeBlocks: 6, cableBlocks: 1 },
    } as unknown as SiteBuild;
    expect(scoreBuild(build)).toEqual({ problems: 1, unconnected: 2, blocks: 7, span: 10 });
  });
});

describe('optimizeSite time budget', () => {
  it('shares the deadline with packing measurements and several real-router refinement runs', () => {
    const original = arranged();
    const site = { ...original, groups: original.groups.map((g) => ({ ...g, count: 2 })) };
    const base = createSiteBuilder();
    let t = 0;
    const phases: boolean[] = [];
    const builder: SiteBuilder = (s, options) => {
      phases.push(!!options.pipes);
      t += 400;
      return base(s, options);
    };
    const result = optimizeSite(site, builder, {
      budgetMs: 10000,
      now: () => t,
      iterations: 100,
      refineSteps: 100,
      refineRuns: 3,
      seeds: 3,
    });
    expect(phases[0]).toBe(true);
    expect(phases).toContain(false);
    expect(t).toBeLessThanOrEqual(10400);
    expect(better(result.start, result.result)).toBe(false);
  });
  it('with no time left hands the start back untouched after routing it once', () => {
    let routed = 0;
    const counting = stub(() => 5);
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) routed++;
      return counting(s, o);
    };
    const start = arranged();
    const r = optimizeSite(start, builder, { budgetMs: 0 });
    expect(r.improved).toBe(false);
    expect(r.site).toBe(start);
    expect(routed).toBe(1);
  });

  it('retains the input when slow routing interrupts the fixed iteration schedule', () => {
    let t = 0;
    const slow = stub(() => 5);
    // Every routing takes 400 ms; elapsed time may interrupt but never shorten the completed schedule.
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) t += 400;
      return slow(s, o);
    };
    const start = arranged();
    const r = optimizeSite(start, builder, { budgetMs: 2000, now: () => t, iterations: 3000 });
    expect(t).toBeLessThanOrEqual(2400);
    expect(r.site).toBe(start);
    expect(r.improved).toBe(false);
    expect(r.stopped).toBe('time-limit');
  });
});

describe('better', () => {
  const base = { problems: 0, unconnected: 0, blocks: 10, span: 20 };
  it('ranks problems, then unconnected terminals, then pipe blocks, then span', () => {
    expect(better({ ...base, problems: 1, blocks: 1 }, base)).toBe(false);
    expect(better({ ...base, problems: 1 }, { ...base, unconnected: 5 })).toBe(false);
    expect(better({ ...base, unconnected: 1 }, { ...base, problems: 1 })).toBe(true);
    expect(better({ ...base, problems: 0 }, { ...base, problems: 1, blocks: 1 })).toBe(true);
    expect(better({ ...base, blocks: 9, span: 99 }, base)).toBe(true);
    expect(better({ ...base, span: 19 }, base)).toBe(true);
    expect(better(base, base)).toBe(false);
  });
});

it('counts the size of aggregated placement and resource deficits before pipe savings', () => {
  const base = stub(() => 10)(arranged(), { pipes: true, cables: true });
  const a = scoreBuild({ ...base, warnings: [{ type: 'unplaced', group: 'g0', count: 1 }] });
  const b = scoreBuild({
    ...base,
    warnings: [{ type: 'unplaced', group: 'g0', count: 5 }],
    stats: { ...base.stats, pipeBlocks: 0 },
  });
  expect(better(b, a)).toBe(false);
  expect(
    scoreBuild({
      ...base,
      warnings: [
        { type: 'missing', group: 'g0', resource: 'r', units: 2 },
        { type: 'fewer', group: 'g1', placed: 1, requested: 4 },
      ],
    }).problems,
  ).toBe(5);
});
