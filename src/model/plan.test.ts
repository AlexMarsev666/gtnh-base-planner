import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../data/catalog';
import { layoutCandidates, packUnits } from './layout/packer';
import { loosenings } from './layout/variants';
import {
  betterRouting,
  hatchMoves,
  improveHatches,
  MAX_HATCH_MOVES,
  networkCost,
  resolveLayout,
  resolveRoutedLayout,
  TRIAL_ROUNDS,
  unconnected,
  type LayoutDeps,
  type RoutedLayoutDeps,
} from './plan';
import { placeHatches } from './hatches/placement';
import { ROUTED_KINDS } from './routing/kinds';
import { routePipes } from './routing/router';
import type { PlanLimits, Unit } from './multiblock/types';
import type { HatchResult } from './plan/types';
import type { RouteNet } from './routing/routeNet';
import type { RouteOptions } from './routing/types';

/** Hand-made entries; generated ones (tools/game-dump) have lighter checks in generated.test.ts. */
const handMade = catalog.filter((d) => !d.generated);

const unlimited: PlanLimits = { x: null, y: null, z: null };
const deps: LayoutDeps = { placeHatches, layoutCandidates };

function resolve(id: string, count: number, limits = unlimited) {
  const def = getMultiblock(id)!;
  return resolveLayout(def, packUnits(def, count, limits), def.defaultHatches, limits, deps);
}

describe('resolveLayout', () => {
  it('keeps the compact layout when every hatch fits', () => {
    const r = resolve('coke-oven', 12);
    expect(r.loosened).toBe(false);
    expect(r.hatches.unplaced).toEqual([]);
  });

  it('loosens a dense EBF block so every unit gets its own energy and maintenance hatch', () => {
    const def = getMultiblock('electric-blast-furnace')!;
    const compact = packUnits(def, 12, unlimited);
    expect(placeHatches(def, compact.units, def.defaultHatches).unplaced.length).toBeGreaterThan(0);
    const r = resolve('electric-blast-furnace', 12);
    expect(r.loosened).toBe(true);
    expect(r.hatches.unplaced).toEqual([]);
    expect(r.pack.units).toHaveLength(12);
    expect(r.pack.requested).toBe(12);
  });

  it('places every default hatch for every catalog multiblock; loosened layouts stay one layer high', () => {
    for (const def of handMade)
      for (const n of [1, 4, 12, 60]) {
        const r = resolve(def.id, n);
        expect(r.hatches.unplaced, `${def.id} × ${n}`).toEqual([]);
        if (r.loosened)
          expect(new Set(r.pack.units.map((u) => u.origin[1])).size, `${def.id} × ${n}`).toBe(1);
      }
  }, 30_000); // Places hatches for every hand-made multiblock at four counts.

  it('respects limits and keeps the best effort when nothing fits every hatch', () => {
    const limits: PlanLimits = { x: 3, y: null, z: 2 };
    const r = resolve('electric-blast-furnace', 6, limits);
    expect(new Set(r.pack.units.map((u) => u.origin[0])).size).toBeLessThanOrEqual(3);
    expect(new Set(r.pack.units.map((u) => u.origin[2])).size).toBeLessThanOrEqual(2);
    expect(r.pack.units.length).toBe(r.pack.placed);
  });

  it('stops after maxTries and prefers fewer unplaced hatches', () => {
    const def = getMultiblock('coke-oven')!;
    const base = { units: [{ id: 0, origin: [0, 0, 0], rotation: 0 }] as Unit[], requested: 1, placed: 1 };
    const results: HatchResult[] = [
      {
        hatches: [],
        unplaced: [
          { unitId: 0, kind: 'energy' },
          { unitId: 0, kind: 'muffler' },
        ],
      },
      { hatches: [], unplaced: [{ unitId: 0, kind: 'energy' }] },
      { hatches: [], unplaced: [{ unitId: 0, kind: 'muffler' }] },
    ];
    let call = 0;
    const alt = (x: number): Unit[] => [{ id: 0, origin: [x, 0, 0], rotation: 0 }];
    const r = resolveLayout(
      def,
      base,
      [],
      unlimited,
      {
        placeHatches: () => results[Math.min(call++, results.length - 1)],
        layoutCandidates: function* () {
          yield alt(1);
          yield alt(2);
          yield alt(3);
        },
      },
      1,
    );
    expect(call).toBe(2);
    expect(r.loosened).toBe(true);
    expect(r.pack.units[0].origin[0]).toBe(1);
    expect(r.hatches.unplaced).toHaveLength(1);
  });

  it.skipIf(!process.env.PERF)('is fast enough for 60 units', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    const t0 = performance.now();
    resolveLayout(def, packUnits(def, 60, unlimited), def.defaultHatches, unlimited, deps);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('resolveRoutedLayout', () => {
  const routed: RoutedLayoutDeps = { placeHatches, layoutCandidates, loosenings, routePipes };
  const kinds = { kinds: ROUTED_KINDS };

  function routedResolve(id: string, count: number, limits: PlanLimits) {
    const def = getMultiblock(id)!;
    return resolveRoutedLayout(def, packUnits(def, count, limits), def.defaultHatches, limits, kinds, routed);
  }

  it('keeps the layout when every hatch is connected', () => {
    const r = routedResolve('coke-oven', 12, unlimited);
    expect(r.loosened).toBe(false);
    expect(unconnected(r.pipes)).toBe(0);
  });

  it('widens walkways until every hatch of a dense block is connected', () => {
    // 100 Implosion Compressors in at most 6 x 6 per layer: back-to-back rows with one-block walkways
    // cannot hold an input, an output and an energy line past every unit.
    const limits: PlanLimits = { x: 6, y: null, z: 6 };
    const def = getMultiblock('implosion-compressor')!;
    const plain = resolveLayout(def, packUnits(def, 100, limits), def.defaultHatches, limits, deps);
    const before = routePipes(def, plain.pack.units, plain.hatches.hatches, kinds);
    expect(unconnected(before)).toBeGreaterThan(0);
    const r = routedResolve('implosion-compressor', 100, limits);
    expect(r.loosened).toBe(true);
    expect(r.hatches.unplaced).toEqual([]);
    expect(unconnected(r.pipes)).toBe(0);
    expect(r.pack.units).toHaveLength(100);
    // Same arrangement: as many layers, at most 6 units along X and Z.
    const distinct = (a: number) => new Set(r.pack.units.map((u) => u.origin[a])).size;
    expect(distinct(1)).toBe(new Set(plain.pack.units.map((u) => u.origin[1])).size);
    expect(distinct(0)).toBeLessThanOrEqual(6);
    expect(distinct(2)).toBeLessThanOrEqual(6);
    // The networks it returns are the ones routing the chosen layout gives.
    expect(r.pipes).toEqual(routePipes(def, r.pack.units, r.hatches.hatches, kinds));
  });

  it('connects every hatch of every hand-made catalog multiblock in dense layouts', () => {
    // Generated entries get lighter checks in generated.test.ts; routing all of them here takes minutes.
    for (const def of catalog.filter((d) => !d.generated))
      for (const [n, limits] of [
        [30, { x: 4, y: null, z: 4 }],
        [64, { x: 6, y: null, z: 6 }],
      ] as const) {
        const r = routedResolve(def.id, n, limits);
        expect(unconnected(r.pipes), `${def.id} × ${n}`).toBe(0);
      }
  }, 60_000);

  it('routes the loosest layout even when the tries run out, and keeps the best', () => {
    // Layouts are tried with a few negotiation rounds; the best gets the full negotiation at the end.
    const def = getMultiblock('coke-oven')!;
    const base = { units: [{ id: 0, origin: [0, 0, 0], rotation: 0 }] as Unit[], requested: 1, placed: 1 };
    const at = (x: number): Unit[] => [{ id: 0, origin: [x, 0, 0], rotation: 0 }];
    const net = (connected: number): RouteNet[] => [
      { kind: 'itemIn', paths: [], length: 0, connected, total: 2 },
    ];
    const routedAt: [number, number | undefined][] = [];
    const r = resolveRoutedLayout(
      def,
      base,
      [],
      unlimited,
      kinds,
      {
        placeHatches: () => ({ hatches: [], unplaced: [] }),
        layoutCandidates: function* () {},
        loosenings: function* () {
          for (let x = 1; x <= 5; x++) yield at(x);
        },
        routePipes: (_d, units, _h, opts) => {
          const x = units[0].origin[0];
          routedAt.push([x, opts.rounds]);
          return net(x === 2 ? 1 : 0);
        },
      },
      2,
    );
    expect(routedAt).toEqual([
      [0, TRIAL_ROUNDS],
      [1, TRIAL_ROUNDS],
      [5, TRIAL_ROUNDS],
      [0, undefined],
    ]);
    expect(r.pack.units[0].origin[0]).toBe(0);
    expect(r.loosened).toBe(false);
    expect(unconnected(r.pipes)).toBe(2);
  });
});

describe('resolveRoutedLayout work budget', () => {
  const kinds = { kinds: ROUTED_KINDS };
  const def = getMultiblock('coke-oven')!;
  const base = { units: [{ id: 0, origin: [0, 0, 0], rotation: 0 }] as Unit[], requested: 1, placed: 1 };
  const at = (x: number): Unit[] => [{ id: 0, origin: [x, 0, 0], rotation: 0 }];
  const net = (connected: number, length = 0, kind: RouteNet['kind'] = 'itemIn'): RouteNet => ({
    kind,
    paths: [],
    length,
    connected,
    total: 2,
  });

  /** Routing stub: every run costs `cost` pops, and the run at x === `cappedAt` reports the cap. */
  function run(opts: { cost: number; limit: number; cappedAt?: number }) {
    const routed: [number, number | undefined][] = [];
    const r = resolveRoutedLayout(
      def,
      base,
      [],
      unlimited,
      { ...kinds, budget: { limit: opts.limit, used: 0 } },
      {
        placeHatches: () => ({ hatches: [], unplaced: [] }),
        layoutCandidates: function* () {},
        loosenings: function* () {
          for (let x = 1; x <= 4; x++) yield at(x);
        },
        routePipes: (_d, units, _h, o: RouteOptions) => {
          const x = units[0].origin[0];
          routed.push([x, o.rounds]);
          o.budget!.used += opts.cost;
          if (x === opts.cappedAt) o.budget!.capped = true;
          return [net(0)];
        },
      },
    );
    return { r, routed };
  }

  it('skips the intermediate tries, hatch moves and the full reroute once a run is capped', () => {
    const { r, routed } = run({ cost: 10, limit: 1000, cappedAt: 0 });
    expect(routed).toEqual([
      [0, TRIAL_ROUNDS],
      [4, TRIAL_ROUNDS],
    ]);
    expect(r.truncated).toBe(true);
  });

  it('skips the intermediate tries when the budget cannot pay for them, but routes the loosest', () => {
    const { r, routed } = run({ cost: 100, limit: 100 });
    expect(routed).toEqual([
      [0, TRIAL_ROUNDS],
      [4, TRIAL_ROUNDS],
    ]);
    expect(r.truncated).toBe(true);
  });

  it('tries everything and is not truncated while the budget lasts', () => {
    const { r, routed } = run({ cost: 1, limit: 1000 });
    expect(routed.map(([x]) => x)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(routed[5][1]).toBeUndefined();
    // Nothing connects in this stub, but nothing was skipped either.
    expect(r.truncated).toBe(false);
  });

  it('is not truncated when the cap left every hatch connected', () => {
    const r = resolveRoutedLayout(
      def,
      base,
      [],
      unlimited,
      { ...kinds, budget: { limit: 10, used: 0 } },
      {
        placeHatches: () => ({ hatches: [], unplaced: [] }),
        layoutCandidates: function* () {},
        loosenings: function* () {},
        routePipes: (_d, _u, _h, o) => {
          o.budget!.used += 100;
          o.budget!.capped = true;
          return [net(2)];
        },
      },
    );
    expect(r.truncated).toBe(false);
  });

  describe('the full-round result replaces the trial one only when strictly better', () => {
    function full(trial: RouteNet[], whole: RouteNet[]) {
      const r = resolveRoutedLayout(
        def,
        base,
        [],
        unlimited,
        kinds,
        {
          placeHatches: () => ({ hatches: [], unplaced: [] }),
          layoutCandidates: function* () {},
          loosenings: function* () {},
          routePipes: (_d, _u, _h, o) => (o.rounds === TRIAL_ROUNDS ? trial : whole),
        },
        0,
      );
      return r.pipes;
    }

    it('prefers fewer unconnected hatches, then fewer kinds with any, then cheaper networks', () => {
      const trial = [net(1, 5, 'itemIn'), net(1, 5, 'itemOut')];
      const fewerNets = [net(2, 5, 'itemIn'), net(1, 5, 'itemOut')];
      expect(full(trial, fewerNets)).toBe(fewerNets);
      // Same count of unconnected hatches (2), but all in one kind.
      const oneKind = [net(0, 5, 'itemIn'), net(2, 5, 'itemOut')];
      expect(full(trial, oneKind)).toBe(oneKind);
      // Same count, spread over more kinds than the trial's: the trial stays.
      const manyKinds = [net(1, 1, 'itemIn'), net(1, 1, 'itemOut'), net(2, 1, 'fluidOut')];
      expect(full(oneKind, manyKinds)).toBe(oneKind);
      // Same distribution: the cheaper one wins.
      const cheaper = [net(1, 4, 'itemIn'), net(1, 5, 'itemOut')];
      expect(full(trial, cheaper)).toBe(cheaper);
      const dearer = [net(1, 6, 'itemIn'), net(1, 5, 'itemOut')];
      expect(full(trial, dearer)).toBe(trial);
    });

    it('keeps the trial result when everything is equal', () => {
      const trial = [net(1, 5)];
      expect(full(trial, [net(1, 5)])).toBe(trial);
      expect(betterRouting([net(1, 5)], [net(1, 5)])).toBe(false);
    });
  });
});

describe('resolveRoutedLayout on normal machines', () => {
  const routed: RoutedLayoutDeps = { placeHatches, layoutCandidates, loosenings, routePipes };
  const cases: [string, number, PlanLimits][] = [
    ['coke-oven', 12, unlimited],
    ['implosion-compressor', 100, { x: 6, y: null, z: 6 }],
    ['large-chemical-reactor', 12, unlimited],
    ['electric-blast-furnace', 4, unlimited],
    ['eye-of-harmony', 4, unlimited],
    ['space-elevator', 4, unlimited],
  ];

  it('the default work budget changes nothing', () => {
    for (const [id, n, limits] of cases) {
      const def = getMultiblock(id)!;
      const pack = packUnits(def, n, limits);
      const run = (extra: RouteOptions) =>
        resolveRoutedLayout(def, pack, def.defaultHatches, limits, { kinds: ROUTED_KINDS, ...extra }, routed);
      const normal = run({});
      const unbounded = run({ maxPops: Infinity, budget: { limit: Infinity, used: 0 } });
      expect(normal.truncated, id).toBe(false);
      expect(normal, id).toEqual(unbounded);
    }
  }, 60_000);

  it.skipIf(!process.env.PERF)(
    'routes the nanochip assembly complex within the budget',
    () => {
      const def = getMultiblock('nanochip-assembly-complex')!;
      const pack = packUnits(def, 4, unlimited);
      let calls = 0;
      const counting: RoutedLayoutDeps = {
        ...routed,
        routePipes: (...args) => {
          calls++;
          return routePipes(...args);
        },
      };
      const r = resolveRoutedLayout(
        def,
        pack,
        def.defaultHatches,
        unlimited,
        { kinds: ROUTED_KINDS },
        counting,
      );
      expect(calls).toBe(2);
      expect(unconnected(r.pipes)).toBe(0);
    },
    120_000,
  );
});

describe('layoutCandidates', () => {
  it('yields only valid, distinct layouts of the requested size', () => {
    const def = getMultiblock('coke-oven')!;
    const seen = new Set<string>();
    let n = 0;
    for (const units of layoutCandidates(def, 6, unlimited)) {
      expect(units).toHaveLength(6);
      const k = JSON.stringify(units);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      if (++n >= 30) break;
    }
    expect(n).toBeGreaterThan(3);
  });

  it('includes a layout with gaps between units', () => {
    const def = getMultiblock('coke-oven')!;
    let gapped = false;
    for (const units of layoutCandidates(def, 3, unlimited)) {
      const xs = units.map((u) => u.origin[0]).sort((a, b) => a - b);
      if (xs.length === 3 && xs[1] - xs[0] === 4 && xs[2] - xs[1] === 4) gapped = true;
    }
    expect(gapped).toBe(true);
  });
});

describe('improveHatches', () => {
  const kinds = [...ROUTED_KINDS];
  function start(id: string, count: number) {
    const def = getMultiblock(id)!;
    const pack = packUnits(def, count, NO_LIMITS_FB);
    const r = resolveLayout(def, pack, defaultEnabled(id), NO_LIMITS_FB, deps);
    const route = (h: HatchResult) =>
      routePipes(def, r.pack.units, h.hatches, { kinds, rounds: TRIAL_ROUNDS });
    return { def, units: r.pack.units, hatches: r.hatches, route, pipes: route(r.hatches) };
  }

  it('moves hatches whose pipes run far when that makes the networks cheaper', () => {
    // Two Large Chemical Reactor rows used to reach some hatches with long detours.
    const s = start('large-chemical-reactor', 12);
    const out = improveHatches(
      s.def,
      s.units,
      defaultEnabled('large-chemical-reactor'),
      s.hatches,
      s.pipes,
      s.route,
      placeHatches,
    );
    expect(out.hatches).not.toBe(s.hatches);
    expect(out.hatches.unplaced.length).toBeLessThanOrEqual(s.hatches.unplaced.length);
    expect(unconnected(out.pipes)).toBeLessThanOrEqual(unconnected(s.pipes));
    expect(networkCost(out.pipes)).toBeLessThan(networkCost(s.pipes));
  });

  it('never makes a build worse, and is deterministic', () => {
    for (const [id, count] of [
      ['coke-oven', 4],
      ['electric-blast-furnace', 4],
      ['distillation-tower', 3],
      ['vacuum-freezer', 12],
    ] as const) {
      const s = start(id, count);
      const out = improveHatches(
        s.def,
        s.units,
        defaultEnabled(id),
        s.hatches,
        s.pipes,
        s.route,
        placeHatches,
      );
      expect(out.hatches.unplaced.length, id).toBeLessThanOrEqual(s.hatches.unplaced.length);
      expect(unconnected(out.pipes), id).toBeLessThanOrEqual(unconnected(s.pipes));
      if (unconnected(out.pipes) === unconnected(s.pipes))
        expect(networkCost(out.pipes), id).toBeLessThanOrEqual(networkCost(s.pipes));
      const again = improveHatches(
        s.def,
        s.units,
        defaultEnabled(id),
        s.hatches,
        s.pipes,
        s.route,
        placeHatches,
      );
      expect(again).toEqual(out);
    }
  }, 30_000);

  it('does nothing when it cannot afford a routing run', () => {
    const s = start('large-chemical-reactor', 12);
    let routed = 0;
    const out = improveHatches(
      s.def,
      s.units,
      defaultEnabled('large-chemical-reactor'),
      s.hatches,
      s.pipes,
      (h) => (routed++, s.route(h)),
      placeHatches,
      undefined,
      () => false,
    );
    expect(routed).toBe(0);
    expect(out.hatches).toBe(s.hatches);
    expect(out.pipes).toBe(s.pipes);
  });

  it('tries less on builds with many routed hatches', () => {
    expect(hatchMoves(8)).toBe(MAX_HATCH_MOVES);
    expect(hatchMoves(48)).toBe(5);
    expect(hatchMoves(240)).toBe(1);
    expect(hatchMoves(1000)).toBe(1);
  });
});

const NO_LIMITS_FB: PlanLimits = { x: null, y: null, z: null };

function defaultEnabled(id: string) {
  return [...getMultiblock(id)!.defaultHatches];
}
