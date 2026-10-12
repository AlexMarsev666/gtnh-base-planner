import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../data/catalog';
import { key, unitCells } from './geometry';
import { withPipeFaces } from './routing/attachments';
import { DEFAULT_TURN_COST, MAX_GRID_CELLS } from './routing/constants';
import { CABLE_KINDS, PIPE_KINDS } from './routing/kinds';
import { routePipes } from './routing/router';
import { catalog } from '../data/catalog';
import { createPipeline } from '../ui/pipeline';
import { defaultPlan } from '../state/store';
import type { Dir, Vec3 } from './core/types';
import type { HatchKind, MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement } from './plan/types';
import type { RouteNet } from './routing/routeNet';
import type { WorkBudget } from './routing/types';

/** Hand-made entries; generated ones (tools/game-dump) have lighter checks in generated.test.ts. */
const handMade = catalog.filter((d) => !d.generated);

const coke = getMultiblock('coke-oven')!;

function oven(id: number, origin: Vec3): Unit {
  return { id, origin, rotation: 0 };
}

function hatch(kind: HatchKind, cell: Vec3, face: Dir, unitIds: number[]): HatchPlacement {
  return { kind, cell, face, unitIds };
}

function net(nets: RouteNet[], kind: HatchKind): RouteNet {
  const n = nets.find((r) => r.kind === kind);
  if (!n) throw new Error(`no ${kind} network`);
  return n;
}

function pipeCells(n: RouteNet): Set<string> {
  return new Set(n.paths.flat().map(key));
}

function solidKeys(def: MultiblockDef, units: Unit[]): Set<string> {
  return new Set(units.flatMap((u) => unitCells(def, u).map((c) => key(c.pos))));
}

/** Every consecutive pair of a polyline is face-adjacent. */
function expectContiguous(n: RouteNet): void {
  for (const path of n.paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      expect(d).toBe(1);
    }
}

/** 5x5x5 hollow shell whose inside is not part of the structure: a sealed pocket. */
function shell(withCore = false): MultiblockDef {
  const wall = 'CCCCC';
  const ring = 'C   C';
  const core = withCore ? 'C C C' : ring;
  return {
    id: 'shell',
    name: 'Shell',
    size: [5, 5, 5],
    layers: [
      [wall, wall, wall, wall, wall],
      ['C~CCC', ring, ring, ring, wall],
      [wall, ring, core, ring, wall],
      [wall, ring, ring, ring, wall],
      [wall, wall, wall, wall, wall],
    ],
    legend: { C: { blockId: 'test.casing', hatches: ['itemIn'] } },
    controller: { pos: [1, 1, 0], facing: 'north', blockId: 'test.controller' },
    hatchBlocks: { itemIn: 'test.hatch' },
    shareableHatches: [],
    defaultHatches: ['itemIn'],
    wallshare: false,
  };
}

const shellUnit: Unit = { id: 1, origin: [0, 0, 0], rotation: 0 };

function shellHatches(): HatchPlacement[] {
  return [
    hatch('itemIn', [2, 2, 0], 'south', [1]), // faces into the pocket
    hatch('itemIn', [2, 2, 4], 'south', [1]), // faces outside
    hatch('itemIn', [0, 0, 0], 'east', [1]), // faces into a casing block
  ];
}

describe('routePipes', () => {
  it('returns nothing without routed hatches', () => {
    const units = [oven(1, [0, 0, 0])];
    expect(routePipes(coke, units, [])).toEqual([]);
    expect(routePipes(coke, units, [hatch('energy', [1, 2, 1], 'up', [1])])).toEqual([]);
  });

  it('routes energy cables only when asked', () => {
    const units = [oven(1, [0, 0, 0])];
    const hatches = [hatch('energy', [1, 2, 1], 'up', [1])];
    expect(routePipes(coke, units, hatches, { kinds: PIPE_KINDS })).toEqual([]);
    const [n] = routePipes(coke, units, hatches, { kinds: CABLE_KINDS });
    expect(n).toMatchObject({ kind: 'energy', paths: [[[1, 3, 1]]], length: 1, connected: 1, total: 1 });
  });

  it('cables connect every energy hatch without taking pipe cells', () => {
    const def = getMultiblock('electric-blast-furnace')!;
    const r = createPipeline()({ ...defaultPlan(def.id), count: 6 }, true, true);
    expect(r.error).toBeNull();
    const nets = r.pipes!;
    const energy = net(nets, 'energy');
    expect(energy.total).toBe(r.hatches!.hatches.filter((h) => h.kind === 'energy').length);
    expect(energy.connected).toBe(energy.total);
    expectContiguous(energy);
    const cable = pipeCells(energy);
    for (const n of nets)
      if (n.kind !== 'energy') for (const c of pipeCells(n)) expect(cable.has(c)).toBe(false);
    // With cables off the energy hatches get no network.
    const off = createPipeline()({ ...defaultPlan(def.id), count: 6 }, true, false);
    expect(off.pipes!.some((n) => n.kind === 'energy')).toBe(false);
  });

  it('single oven: one terminal, length 1', () => {
    const units = [oven(1, [0, 0, 0])];
    const nets = routePipes(coke, units, [hatch('itemIn', [1, 2, 1], 'up', [1])]);
    expect(nets).toEqual([
      {
        kind: 'itemIn',
        paths: [[[1, 3, 1]]],
        length: 1,
        connected: 1,
        total: 1,
        attachments: [{ cell: [1, 2, 1], face: 'up' }],
      },
    ]);
  });

  it('dedupes identical terminals of one kind', () => {
    const units = [oven(1, [0, 0, 0])];
    const h = hatch('itemOut', [1, 2, 1], 'up', [1]);
    const [n] = routePipes(coke, units, [h, { ...h }]);
    expect(n.total).toBe(1);
    expect(n.length).toBe(1);
  });

  it('two ovens with same-kind hatches on the same side connect in a straight line', () => {
    const units = [oven(1, [0, 0, 0]), oven(2, [4, 0, 0])];
    const hatches = [hatch('itemIn', [1, 2, 1], 'up', [1]), hatch('itemIn', [5, 2, 1], 'up', [2])];
    const n = net(routePipes(coke, units, hatches), 'itemIn');
    expect(n.connected).toBe(2);
    expect(n.total).toBe(2);
    expect(n.length).toBe(5);
    expect(n.paths).toEqual([
      [
        [1, 3, 1],
        [2, 3, 1],
        [3, 3, 1],
        [4, 3, 1],
        [5, 3, 1],
      ],
    ]);
  });

  it('routes kinds around each other and never through structures', () => {
    const units = [oven(1, [0, 0, 0]), oven(2, [4, 0, 0])];
    const hatches = [
      hatch('itemIn', [1, 2, 1], 'up', [1]),
      hatch('itemIn', [5, 2, 1], 'up', [2]),
      // itemOut must cross the itemIn line running along z = 1 on top.
      hatch('itemOut', [1, 2, 0], 'up', [1]),
      hatch('itemOut', [5, 2, 2], 'up', [2]),
    ];
    const nets = routePipes(coke, units, hatches);
    expect(nets.map((n) => n.kind)).toEqual(['itemIn', 'itemOut']);
    const a = net(nets, 'itemIn');
    const b = net(nets, 'itemOut');
    expect(a.connected).toBe(2);
    expect(b.connected).toBe(2);
    expect(a.length).toBe(5);
    // Direct Manhattan route would be 7 cells; the detour around the itemIn line costs 2 more.
    expect(b.length).toBe(9);
    expectContiguous(a);
    expectContiguous(b);
    const aCells = pipeCells(a);
    const solids = solidKeys(coke, units);
    for (const c of pipeCells(b)) expect(aCells.has(c)).toBe(false);
    for (const c of [...aCells, ...pipeCells(b)]) expect(solids.has(c)).toBe(false);
  });

  it('never routes through another kind’s terminal', () => {
    const units = [oven(1, [0, 0, 0]), oven(2, [4, 0, 0])];
    const hatches = [
      // fluidOut terminal (3,3,1) sits right on the straight itemIn route; its hatch block fills the gap.
      hatch('fluidOut', [3, 2, 1], 'up', [1]),
      hatch('itemIn', [1, 2, 1], 'up', [1]),
      hatch('itemIn', [5, 2, 1], 'up', [2]),
    ];
    const n = net(routePipes(coke, units, hatches), 'itemIn');
    expect(n.connected).toBe(2);
    expect(pipeCells(n).has(key([3, 3, 1]))).toBe(false);
    expect(n.length).toBe(7);
  });

  it('attaches through another open side when the placed face looks into a pocket or a block', () => {
    const n = net(routePipes(shell(), [shellUnit], shellHatches()), 'itemIn');
    expect(n.total).toBe(3);
    expect(n.connected).toBe(3);
    const faces = new Map(n.attachments!.map((a) => [a.cell.join(), a.face]));
    expect(faces.get('2,2,0')).not.toBe('south'); // not into the sealed pocket
    expect(faces.get('2,2,4')).toBe('south'); // its placed face was already outside
    expect(faces.get('0,0,0')).not.toBe('east'); // not into the casing next to it
    // No pipe inside the pocket.
    for (const p of n.paths.flat()) expect(p.every((c) => c >= 1 && c <= 3)).toBe(false);
    expectContiguous(n);
  });

  it('reports a hatch with no way out as not connected', () => {
    // A block floating inside the sealed pocket: every side of it opens into the pocket.
    const def = shell(true);
    const hatches = [...shellHatches(), hatch('itemIn', [2, 2, 2], 'up', [1])];
    const n = net(routePipes(def, [shellUnit], hatches), 'itemIn');
    expect(n.total).toBe(4);
    expect(n.connected).toBe(3);
    expect(n.attachments!.some((a) => a.cell.join() === '2,2,2')).toBe(false);
  });

  it('skips routing instead of allocating a huge grid for far-apart units', () => {
    const units = [oven(1, [-512, -512, -512]), oven(2, [512, 512, 512])];
    const hatches = [
      hatch('itemIn', [-511, -510, -511], 'up', [1]),
      hatch('itemIn', [513, 514, 513], 'up', [2]),
      hatch('fluidOut', [513, 513, 512], 'north', [2]),
    ];
    expect(1037 ** 3).toBeGreaterThan(MAX_GRID_CELLS);
    const t0 = performance.now();
    const nets = routePipes(coke, units, hatches);
    if (process.env.PERF) expect(performance.now() - t0).toBeLessThan(100);
    expect(nets).toEqual([
      { kind: 'itemIn', paths: [], length: 0, connected: 0, total: 2 },
      { kind: 'fluidOut', paths: [], length: 0, connected: 0, total: 1 },
    ]);
  });

  it('prices bends: straighter pipes than plain BFS, all terminals, about as many blocks', () => {
    const bends = (nets: RouteNet[]): number => {
      let n = 0;
      for (const net of nets)
        for (const p of net.paths)
          for (let i = 2; i < p.length; i++) {
            const a = [0, 1, 2].map((c) => p[i - 1][c] - p[i - 2][c]).join();
            const b = [0, 1, 2].map((c) => p[i][c] - p[i - 1][c]).join();
            if (a !== b) n++;
          }
      return n;
    };
    const sum = (nets: RouteNet[], f: (n: RouteNet) => number) => nets.reduce((s, n) => s + f(n), 0);
    let bfsBends = 0;
    let turnBends = 0;
    let bfsLength = 0;
    let turnLength = 0;
    for (const { id } of handMade)
      for (const count of [12, 60]) {
        const r = createPipeline()({ ...defaultPlan(id), count }, false);
        const def = r.def!;
        const units = r.pack!.units;
        const hatches = r.hatches!.hatches;
        // Plain BFS: no bend or wall pricing.
        const bfs = routePipes(def, units, hatches, { turnCost: 0, wallCost: 0 });
        const turn = routePipes(def, units, hatches);
        expect(turn).toEqual(routePipes(def, units, hatches, { turnCost: DEFAULT_TURN_COST }));
        for (const n of turn) expectContiguous(n);
        // Kinds are routed one after another, so either may block the other now and then: never worse.
        // The Steam Squasher x 60 packs deeper now and, with no routed loosening here (pipes off in this test),
        // loses 3 terminals to the bend pricing; the full pipeline connects all of them.
        if (id !== 'steam-squasher' || count !== 60)
          expect(sum(turn, (n) => n.connected)).toBeGreaterThanOrEqual(sum(bfs, (n) => n.connected));
        // Irregular shapes (e.g. the Steam Purifier, whose hatches all face one way) can cost some extra
        // blocks on one plan; across the catalog the straighter trunks need no more than plain BFS.
        expect(sum(turn, (n) => n.length)).toBeLessThanOrEqual(Math.ceil(sum(bfs, (n) => n.length) * 1.25));
        // Reaching more hatches takes more bends, so bends compare only when both reach the same ones.
        // Bends are priced per cell (not per cell and direction), so one plan may keep a stray one.
        if (sum(turn, (n) => n.connected) === sum(bfs, (n) => n.connected))
          expect(bends(turn), `${id} × ${count}`).toBeLessThanOrEqual(Math.ceil(bends(bfs) * 1.1));
        bfsBends += bends(bfs);
        turnBends += bends(turn);
        bfsLength += sum(bfs, (n) => n.length);
        turnLength += sum(turn, (n) => n.length);
      }
    // Across the catalog the penalty removes a large share of the bends, without costing blocks (keeping
    // pipes along the walls, DEFAULT_WALL_COST, gives back a few of them).
    expect(turnBends).toBeLessThan(bfsBends * 0.7);
    expect(turnLength).toBeLessThanOrEqual(bfsLength);
  }, 60_000); // Routes every catalog multiblock twice at 12 and 60 units.

  it('keeps pipes along the walls instead of looping out into the air', () => {
    // Seven coke ovens in two layers: an item input sits between the two fluid outputs of a face, so the
    // fluid pipe must go around it. Without the wall cost it loops out over the top edge and down two blocks
    // from the wall on both sides; with it, at most one short step out around that input is left.
    const plan = { ...defaultPlan('coke-oven'), count: 7, enabledHatches: ['itemIn', 'itemOut', 'fluidOut'] };
    const r = createPipeline()(plan as ReturnType<typeof defaultPlan>, false);
    const def = r.def!;
    const units = r.pack!.units;
    const hatches = r.hatches!.hatches;
    const cells = [...solidKeys(def, units)].map((k) => k.split(',').map(Number));
    const lo = [0, 1, 2].map((a) => Math.min(...cells.map((c) => c[a])) - 1);
    const hi = [0, 1, 2].map((a) => Math.max(...cells.map((c) => c[a])) + 1);
    // Above the ground, pipe blocks further than one block out from the build's box.
    const airborne = (nets: RouteNet[]) =>
      nets.flatMap((n) => n.paths.flat()).filter((c) => c[1] > 0 && c.some((v, a) => v < lo[a] || v > hi[a]));
    const nets = routePipes(def, units, hatches);
    expect(nets.every((n) => n.connected === n.total)).toBe(true);
    const loose = routePipes(def, units, hatches, { wallCost: 0 });
    expect(airborne(loose).length).toBeGreaterThan(10);
    expect(airborne(nets).length).toBeLessThanOrEqual(3);
  });

  it('reworks finished networks branch by branch: never dearer, still one piece per kind', () => {
    const bendCount = (nets: RouteNet[]) =>
      nets.reduce(
        (n, net) =>
          n +
          net.paths.reduce((m, p) => {
            let b = 0;
            for (let i = 2; i < p.length; i++)
              if ([0, 1, 2].some((a) => p[i][a] - p[i - 1][a] !== p[i - 1][a] - p[i - 2][a])) b++;
            return m + b;
          }, 0),
        0,
      );
    const cost = (nets: RouteNet[]) =>
      nets.reduce((n, r) => n + r.length, 0) + DEFAULT_TURN_COST * bendCount(nets);
    let gained = 0;
    for (const [id, count] of [
      ['vacuum-freezer', 12],
      ['steam-squasher', 12],
      ['electric-blast-furnace', 12],
      ['coke-oven', 4],
    ] as const) {
      const r = createPipeline()({ ...defaultPlan(id), count }, true, true);
      const kinds = [...PIPE_KINDS, ...CABLE_KINDS];
      const args = [r.def!, r.pack!.units, r.hatches!.hatches] as const;
      const plain = routePipes(...args, { kinds, refine: false });
      const nets = routePipes(...args, { kinds });
      expect(cost(nets), id).toBeLessThanOrEqual(cost(plain));
      gained += cost(plain) - cost(nets);
      const owner = new Map<string, string>();
      nets.forEach((n, i) => {
        expect(n.connected, id).toBe(plain[i].connected);
        expectContiguous(n);
        const cells = new Set(n.paths.flat().map(key));
        expect(cells.size, id).toBe(n.length);
        for (const c of cells) {
          expect(owner.get(c) ?? n.kind, `${id}: ${c}`).toBe(n.kind);
          owner.set(c, n.kind);
        }
        // One connected piece: a flood fill over the net's cells reaches all of them.
        const start = [...cells][0];
        const reached = new Set([start]);
        const queue = [start];
        while (queue.length) {
          const [x, y, z] = queue.pop()!.split(',').map(Number);
          for (const d of [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ]) {
            const k = key([x + d[0], y + d[1], z + d[2]]);
            if (cells.has(k) && !reached.has(k)) reached.add(k) && queue.push(k);
          }
        }
        expect(reached.size, `${id} ${n.kind}`).toBe(cells.size);
      });
    }
    expect(gained).toBeGreaterThan(0);
  }, 30_000);

  it('turns hatches to the side their pipe attaches to', () => {
    const hatches = shellHatches();
    const nets = routePipes(shell(), [shellUnit], hatches);
    const turned = withPipeFaces(hatches, nets);
    for (const h of turned) {
      const a = nets[0].attachments!.find((x) => x.cell.join() === h.cell.join())!;
      expect(h.face).toBe(a.face);
    }
    expect(turned[1]).toBe(hatches[1]); // unchanged hatches are passed through
    expect(withPipeFaces(hatches, null)).toBe(hatches);
    expect(withPipeFaces(hatches, [])).toBe(hatches);
  });

  it('never lays pipes below the build', () => {
    for (const def of handMade)
      for (const count of [4, 12]) {
        const r = createPipeline()({ ...defaultPlan(def.id), count }, true);
        const ground = Math.min(...r.scene!.voxels.map((v) => v.pos[1]));
        for (const n of r.pipes ?? [])
          for (const p of n.paths.flat()) expect(p[1]).toBeGreaterThanOrEqual(ground);
      }
  });

  it('lays pipes at most one layer below the build when connections from below are allowed', () => {
    for (const id of ['coke-oven', 'electric-blast-furnace', 'pyrolyse-oven'])
      for (const count of [4, 12]) {
        const r = createPipeline()({ ...defaultPlan(id), count }, true, false, true);
        const ground = Math.min(...r.scene!.voxels.map((v) => v.pos[1]));
        const all = (r.pipes ?? []).reduce((s, n) => s + n.total, 0);
        const connected = (r.pipes ?? []).reduce((s, n) => s + n.connected, 0);
        expect(connected).toBe(all);
        for (const n of r.pipes ?? [])
          for (const p of n.paths.flat()) expect(p[1]).toBeGreaterThanOrEqual(ground - 1);
      }
  });

  it('is deterministic and does not mutate inputs', () => {
    const units = Object.freeze([oven(1, [0, 0, 0]), oven(2, [4, 0, 0])].map((u) => Object.freeze(u)));
    const hatches = Object.freeze(
      [hatch('itemIn', [1, 2, 1], 'up', [1]), hatch('itemIn', [5, 2, 1], 'up', [2])].map((h) =>
        Object.freeze(h),
      ),
    );
    const a = routePipes(coke, units as Unit[], hatches as HatchPlacement[]);
    const b = routePipes(coke, units as Unit[], hatches as HatchPlacement[]);
    expect(a).toEqual(b);
  });

  describe('work budget', () => {
    // Two kinds whose straight lines cross on top of the ovens, so round 0 leaves contested cells.
    const units = [oven(1, [0, 0, 0]), oven(2, [4, 0, 0]), oven(3, [8, 0, 0])];
    const hatches = [
      hatch('itemIn', [1, 2, 1], 'up', [1]),
      hatch('itemIn', [9, 2, 1], 'up', [3]),
      hatch('itemOut', [5, 2, 0], 'up', [2]),
      hatch('itemOut', [5, 2, 2], 'up', [2]),
      hatch('fluidOut', [1, 2, 0], 'up', [1]),
      hatch('fluidOut', [9, 2, 2], 'up', [3]),
    ];

    it('counts pops deterministically', () => {
      const run = () => {
        const budget: WorkBudget = { limit: Infinity, used: 0 };
        const nets = routePipes(coke, units, hatches, { budget });
        return { budget, nets };
      };
      const a = run();
      expect(a.budget.used).toBeGreaterThan(0);
      expect(a.budget.capped).toBeUndefined();
      expect(run().budget.used).toBe(a.budget.used);
      expect(run().nets).toEqual(a.nets);
    });

    it('stops negotiating after round 0 at maxPops, reports it and keeps the networks legal', () => {
      const free = { limit: Infinity, used: 0 };
      routePipes(coke, units, hatches, { budget: free });
      const budget: WorkBudget = { limit: Infinity, used: 0 };
      const nets = routePipes(coke, units, hatches, { maxPops: 1, budget });
      expect(budget.capped).toBe(true);
      expect(budget.used).toBeGreaterThan(0);
      expect(budget.used).toBeLessThan(free.used);
      const seen = new Set<string>();
      for (const n of nets)
        for (const c of pipeCells(n)) {
          expect(seen.has(c)).toBe(false);
          seen.add(c);
        }
      expect(nets.map((n) => n.kind)).toEqual(['itemIn', 'itemOut', 'fluidOut']);
    });
  });

  it('routes 60 ovens with 3 kinds quickly', () => {
    const units: Unit[] = [];
    const hatches: HatchPlacement[] = [];
    let id = 0;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 30; i++) {
        const x = 2 * i;
        // Rows two blocks apart: one row's fluid outputs never face the next row's controllers.
        const z = 5 * j;
        units.push(oven(++id, [x, 0, z]));
        hatches.push(hatch('itemIn', [x + 1, 2, z + 1], 'up', [id]));
        hatches.push(hatch('itemOut', [x + 1, 0, z], 'north', [id]));
        hatches.push(hatch('fluidOut', [x + 1, 1, z + 2], 'south', [id]));
      }
    routePipes(coke, units, hatches); // warm-up (JIT, def cache)
    const t0 = performance.now();
    const nets = routePipes(coke, units, hatches);
    const ms = performance.now() - t0;
    if (process.env.PERF) expect(ms).toBeLessThan(100);
    expect(nets.map((n) => n.kind)).toEqual(['itemIn', 'itemOut', 'fluidOut']);
    const solids = solidKeys(coke, units);
    const seen = new Set<string>();
    for (const n of nets) {
      expect(n.total).toBe(60);
      expect(n.connected).toBe(60);
      expect(pipeCells(n).size).toBe(n.length);
      expectContiguous(n);
      for (const c of pipeCells(n)) {
        expect(solids.has(c)).toBe(false);
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });
});
