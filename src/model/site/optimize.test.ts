import { describe, expect, it } from 'vitest';
import { FLOOR_CLEARANCE, arrangeSite } from './arrange';
import { createSiteBuilder, localFootprints } from './build';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import {
  AbortedError,
  better,
  exploreIterations,
  optimizeSite,
  refineStepsFor,
  scoreBuild,
  scoreBounds,
  scoreValue,
} from './optimize';
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

function laidOut(builder = createSiteBuilder()) {
  const site = crowded();
  const sizes = localFootprints(builder(site, { pipes: false, cables: false }));
  return { builder, site: { ...site, groups: arrangeSite(site, (id) => sizes.get(id)).groups } };
}

describe('optimizeSite with repacking', () => {
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

describe('optimizeSite safety limit', () => {
  it('with no time left hands the start back untouched after routing it once', () => {
    let routed = 0;
    const counting = stub(() => 5);
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) routed++;
      return counting(s, o);
    };
    const start = arranged();
    const r = optimizeSite(start, builder, { limitMs: 0 });
    expect(r.improved).toBe(false);
    expect(r.truncated).toBe(true);
    expect(r.site).toBe(start);
    expect(routed).toBe(1);
  });

  it('stops routing when the limit is reached, and says so', () => {
    let t = 0;
    const slow = stub((s) => s.groups.reduce((n, g) => n + g.origin[0], 0));
    // Every routing takes 400 ms of the injected clock; the limit holds only a few of them.
    const builder: SiteBuilder = (s, o) => {
      if (o.pipes) t += 400;
      return slow(s, o);
    };
    const r = optimizeSite(arranged(), builder, { limitMs: 2000, now: () => t, iterations: 3000 });
    expect(r.truncated).toBe(true);
    expect(r.tried).toBeLessThanOrEqual(5);
  });

  it('does not depend on the clock while the limit is not reached', () => {
    const west = stub((s) => s.groups.reduce((n, g) => n + g.origin[0], 0));
    const slowClock = () => {
      let t = 0;
      return () => (t += 0.001);
    };
    const a = optimizeSite(arranged(), west, { iterations: 2000, refineSteps: 100, now: slowClock() });
    const b = optimizeSite(arranged(), west, { iterations: 2000, refineSteps: 100 });
    expect(a.truncated).toBe(false);
    expect(b.truncated).toBe(false);
    expect(a).toEqual(b);
  });
});

describe('optimizeSite repeatability', () => {
  const west = stub((s) => s.groups.reduce((n, g) => n + g.origin[0], 0));

  it('gives the same result for the same site and seed, on any clock', () => {
    const start = arranged();
    let t = 0;
    const a = optimizeSite(start, west, { iterations: 1500, refineSteps: 100, seed: 3 });
    const b = optimizeSite(start, west, { iterations: 1500, refineSteps: 100, seed: 3, now: () => (t += 7) });
    expect(a.improved).toBe(true);
    expect(b).toEqual(a);
  });

  it('takes the seed from the site, and an option wins', () => {
    const start = arranged();
    const run = (site: SiteState, seed?: number) => {
      const r = optimizeSite(site, west, { iterations: 1500, refineSteps: 100, seed });
      return { ...r, site: r.site.groups };
    };
    expect(run({ ...start, seed: 4 })).toEqual(run(start, 4));
    // No seed is seed 0.
    expect(run(start)).toEqual(run(start, 0));
    expect(run({ ...start, seed: 4 }, 0)).toEqual(run(start, 0));
  });

  it('repeats with real machines and repacking', () => {
    const builder = createSiteBuilder();
    const { site } = laidOut(builder);
    const opts = { refineSteps: 60, refineRuns: 1, seeds: 2, iterations: 800 };
    const a = optimizeSite(site, builder, opts);
    const b = optimizeSite(site, createSiteBuilder(), opts);
    expect(a.truncated).toBe(false);
    expect(b).toEqual(a);
  });

  it('returns the start as it is, and says nothing improved, when nothing beats it', () => {
    const start = arranged();
    const startKey = JSON.stringify(start.groups.map((g) => g.origin));
    const r = optimizeSite(
      start,
      stub((s) => (JSON.stringify(s.groups.map((g) => g.origin)) === startKey ? 1 : 50)),
      { iterations: 1000, refineSteps: 100 },
    );
    expect(r.improved).toBe(false);
    expect(r.truncated).toBe(false);
    expect(r.site).toBe(start);
    expect(r.result).toEqual(r.start);
  });

  it('scales the work with the plan', () => {
    // Estimate proposals grow with the groups and links; router-judged steps shrink as routing gets dearer.
    expect(exploreIterations(20, 30)).toBeGreaterThan(exploreIterations(4, 4));
    expect(exploreIterations(1000, 1000)).toBe(exploreIterations(5000, 5000));
    expect(refineStepsFor(4, 8)).toBeGreaterThan(refineStepsFor(10, 19));
    expect(refineStepsFor(10, 19)).toBeGreaterThan(refineStepsFor(24, 48));
    expect(refineStepsFor(1, 1)).toBe(500);
    expect(refineStepsFor(1000, 5000)).toBe(20);
  });
});

describe('optimizeSite build options', () => {
  it('hands the extra build options to every build, unchanged', () => {
    const calls: Parameters<SiteBuilder>[1][] = [];
    const inner = stub((s) => s.groups.reduce((n, g) => n + g.origin[0], 0));
    const builder: SiteBuilder = (s, o) => {
      calls.push(o);
      return inner(s, o);
    };
    const buildOptions = { turnCost: 7, isolate: 'r1' };
    optimizeSite(arranged(), builder, { iterations: 500, refineSteps: 100, buildOptions });
    expect(calls.length).toBeGreaterThan(2);
    for (const o of calls) {
      expect(o.turnCost).toBe(7);
      expect(o.isolate).toBe('r1');
    }
    expect(calls.some((o) => o.pipes)).toBe(true);
  });
});

describe('optimizeSite progress and cancel', () => {
  const west = stub((s) => s.groups.reduce((n, g) => n + g.origin[0], 0));

  it('reports growing progress that ends at the total, throttled', () => {
    const calls: [number, number][] = [];
    let t = 0;
    // 1 ms per reading: far more progress points than the ~20 a second let through.
    optimizeSite(arranged(), west, {
      iterations: 3000,
      refineSteps: 100,
      now: () => (t += 1),
      onProgress: (done, total) => calls.push([done, total]),
    });
    expect(calls.length).toBeGreaterThan(2);
    for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    for (const [done, total] of calls) expect(done).toBeLessThanOrEqual(total);
    const last = calls[calls.length - 1];
    expect(last[0]).toBe(last[1]);
    // At most one report per 50 ms of that clock, bar the final one.
    for (let i = 1; i < calls.length - 1; i++) expect(calls[i][0]).toBeGreaterThan(calls[i - 1][0]);
    expect(calls.length).toBeLessThanOrEqual(Math.ceil(t / 50) + 2);
  });

  it('throws AbortedError when aborted before the start, and builds nothing', () => {
    let built = 0;
    const builder: SiteBuilder = (s, o) => {
      built++;
      return west(s, o);
    };
    const controller = new AbortController();
    controller.abort();
    expect(() => optimizeSite(arranged(), builder, { signal: controller.signal })).toThrow(AbortedError);
    expect(built).toBe(0);
  });

  it('throws AbortedError when aborted during the search, and does not rebuild', () => {
    const controller = new AbortController();
    const seen: boolean[] = [];
    const builder: SiteBuilder = (s, o) => {
      seen.push(!!o.keepCache);
      return west(s, o);
    };
    let reports = 0;
    let t = 0;
    expect(() =>
      optimizeSite(arranged(), builder, {
        iterations: 5000,
        signal: controller.signal,
        onProgress: () => {
          if (++reports === 2) controller.abort();
        },
        now: () => (t += 100),
      }),
    ).toThrow(AbortedError);
    // No pruning build after an abort.
    expect(seen.every((keep) => keep)).toBe(true);
  });

  it('stops measuring repackings between groups when aborted', () => {
    const controller = new AbortController();
    let builds = 0;
    const real = createSiteBuilder();
    const builder: SiteBuilder = (s, o) => {
      // Build 1 measures the site, build 2 the first group's repackings.
      if (++builds === 2) controller.abort();
      return real(s, o);
    };
    expect(() => optimizeSite(laidOut(real).site, builder, { signal: controller.signal })).toThrow(
      AbortedError,
    );
    expect(builds).toBeLessThan(5);
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

describe('optimizeSite run time', () => {
  const machines = [
    'electric-blast-furnace',
    'large-chemical-reactor',
    'implosion-compressor',
    'vacuum-freezer',
  ];
  /** `n` groups of real machines in a ladder with cross links, arranged. */
  function large(n: number): SiteState {
    const groups = Array.from({ length: n }, (_, i) =>
      group(`g${i}`, machines[i % machines.length], 1 + (i % 3)),
    );
    const links: SiteState['links'] = [];
    for (let i = 1; i < n; i++) {
      links.push({ id: `a${i}`, from: { group: `g${i - 1}` }, to: { group: `g${i}` }, resource: `ra${i}` });
      if (i >= 3 && i % 2 === 0)
        links.push({ id: `b${i}`, from: { group: `g${i - 3}` }, to: { group: `g${i}` }, resource: `rb${i}` });
    }
    const site: SiteState = {
      v: 1,
      kind: 'site',
      size: [160, 120],
      corridor: 2,
      groups,
      links,
      ports: [],
      resources: Object.fromEntries(links.map((l) => [l.resource, res(l.resource)])),
      colors: {},
    };
    const sizes = localFootprints(createSiteBuilder()(site, { pipes: false, cables: false }));
    return { ...site, groups: arrangeSite(site, (id) => sizes.get(id)).groups };
  }

  // Wall-clock numbers: `PERF=1 npx vitest run src/model/site/optimize.test.ts`.
  it.skipIf(!process.env.PERF)(
    'finishes small and large plans well inside the safety limit',
    () => {
      for (const [name, site] of [
        ['small (4 groups)', laidOut().site],
        ['medium (10 groups)', large(10)],
        ['large (24 groups)', large(24)],
      ] as const) {
        const t0 = performance.now();
        const r = optimizeSite(site, createSiteBuilder());
        const ms = performance.now() - t0;
        console.log(
          `optimize ${name}: ${Math.round(ms)} ms, tried ${r.tried}, improved ${r.improved}, blocks ${r.start.blocks} -> ${r.result.blocks}, truncated ${r.truncated}`,
        );
        expect(r.truncated).toBe(false);
      }
    },
    120000,
  );
});

describe('scoreValue', () => {
  const base = { problems: 0, unconnected: 0, blocks: 10, span: 20 };
  const small = { unconnected: 1e4, blocks: 300000, span: 257 };
  it('orders like better(), however large the lower-ranked numbers are', () => {
    const v = (s: typeof base, b = small) => scoreValue(s, b);
    // One more connected terminal beats any saving in blocks and span.
    expect(v({ ...base, unconnected: 0, blocks: 300000, span: 256 })).toBeLessThan(
      v({ ...base, unconnected: 1, blocks: 0, span: 0 }),
    );
    // One problem less beats any number of unconnected terminals.
    expect(v({ ...base, unconnected: 9000 })).toBeLessThan(v({ ...base, problems: 1, unconnected: 0 }));
    expect(v({ ...base, blocks: 9, span: 256 })).toBeLessThan(v({ ...base, span: 0 }));
    expect(v({ ...base, span: 19 })).toBeLessThan(v(base));
  });

  it('keeps the order on a 256 x 256 site with floors, as exact integers', () => {
    const site = { ...web(), size: [256, 256] as [number, number] };
    site.groups = site.groups.map((g, i) => ({ ...g, elevation: i === 0 ? 40 : 0 }));
    const bounds = scoreBounds(site, () => 20);
    expect(bounds.blocks).toBe(256 * 256 * (60 + FLOOR_CLEARANCE + 4));
    expect(bounds.span).toBe(513);
    const top = { problems: 3, unconnected: bounds.unconnected, blocks: bounds.blocks, span: bounds.span };
    const worse = { problems: 4, unconnected: 0, blocks: 0, span: 0 };
    expect(Number.isSafeInteger(scoreValue(top, bounds))).toBe(true);
    expect(scoreValue(top, bounds)).toBeLessThan(scoreValue(worse, bounds));
    expect(
      scoreValue({ ...base, unconnected: 0, blocks: bounds.blocks, span: bounds.span }, bounds),
    ).toBeLessThan(scoreValue({ ...base, unconnected: 1, blocks: 0, span: 0 }, bounds));
    // Hundreds of problems stay a safe integer (the count is capped).
    expect(Number.isSafeInteger(scoreValue({ ...top, problems: 100000 }, bounds))).toBe(true);
  });
});
