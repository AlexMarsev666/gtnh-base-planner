import { describe, expect, it } from 'vitest';
import { DIRS, dirVec, key } from '../geometry';
import type { Vec3 } from '../core/types';
import { routeNets, type RouteNetSpec } from './router';

const box = (x: number, y: number, z: number) => ({ min: [0, 0, 0] as Vec3, max: [x, y, z] as Vec3 });

function adjacent(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1;
}

describe('routeNets', () => {
  it('matches an independent shortest-path oracle for mixed surface and underground routes', () => {
    const start: Vec3 = [0, -1, 1];
    const goal: Vec3 = [4, -1, 1];
    const stepCost = (y: number) => 1 + (y >= 0 ? 4 : Math.max(0, -y - 1) * 0.25);
    for (let variant = 0; variant < 16; variant++) {
      const terminals: RouteNetSpec['terminals'] = [
        { cell: [0, 0, 1], faces: ['down'], role: 'source' },
        { cell: [4, 0, 1], faces: ['down'], role: 'sink' },
      ];
      const solids: Vec3[] = terminals.map((t) => t.cell);
      for (let y = -3; y <= 0; y++) if (variant & (1 << (y + 3))) solids.push([2, y, 1]);
      const blocked = new Set(solids.map(key));
      const queue = [{ cell: start, dir: -1, cost: 0 }];
      const best = new Map<string, number>();
      let optimum = Infinity;
      while (queue.length) {
        queue.sort((a, b) => b.cost - a.cost);
        const current = queue.pop()!;
        if (key(current.cell) === key(goal)) {
          optimum = current.cost;
          break;
        }
        for (let dir = 0; dir < DIRS.length; dir++) {
          const v = dirVec(DIRS[dir]);
          const cell: Vec3 = [current.cell[0] + v[0], current.cell[1] + v[1], current.cell[2] + v[2]];
          if (
            cell[0] < 0 ||
            cell[0] >= 5 ||
            cell[1] < -3 ||
            cell[1] >= 1 ||
            cell[2] < 0 ||
            cell[2] >= 3 ||
            blocked.has(key(cell))
          )
            continue;
          const cost =
            current.cost + stepCost(cell[1]) + Number(current.dir !== -1 && current.dir !== dir) * 2;
          const state = `${key(cell)}:${dir}`;
          if ((best.get(state) ?? Infinity) <= cost) continue;
          best.set(state, cost);
          queue.push({ cell, dir, cost });
        }
      }
      const [route] = routeNets({
        box: { min: [0, -3, 0], max: [5, 1, 3] },
        solids,
        keepFree: [],
        nets: [{ terminals }],
        neat: { y: -3, x: [], z: [] },
        turnCost: 2,
        rounds: 0,
      });
      expect(route.connected).toBe(2);
      const path = route.paths[0];
      let actual = 0;
      for (let i = 1; i < path.length; i++) {
        actual += stepCost(path[i][1]);
        if (
          i > 1 &&
          path[i].some((c, axis) => c - path[i - 1][axis] !== path[i - 1][axis] - path[i - 2][axis])
        )
          actual += 2;
      }
      expect(actual, `wall mask ${variant}`).toBe(optimum);
    }
  });
  it('chooses a short surface crossing instead of a very long underground detour', () => {
    const terminals: RouteNetSpec['terminals'] = [
      { cell: [1, 0, 1], faces: ['down'], role: 'source' },
      { cell: [9, 0, 1], faces: ['down'], role: 'sink' },
    ];
    const solids: Vec3[] = terminals.map((t) => t.cell);
    for (let z = 0; z < 280; z++) solids.push([5, -1, z]);
    const input = {
      box: { min: [0, -1, 0] as Vec3, max: [11, 1, 282] as Vec3 },
      solids,
      keepFree: [],
      nets: [{ terminals }],
      rounds: 0,
    };
    const [compact] = routeNets(input);
    const [neat] = routeNets({ ...input, neat: { y: -1, x: [], z: [] } });
    expect(compact.connected).toBe(2);
    expect(compact.paths.flat().some((p) => p[1] >= 0)).toBe(true);
    expect(neat.connected).toBe(2);
    expect(neat.paths.flat().some((p) => p[1] >= 0)).toBe(true);
    expect(neat.length).toBeLessThan(20);
  });

  it('keeps a short direct surface connection instead of adding underground risers and bends', () => {
    const terminals: RouteNetSpec['terminals'] = [
      { cell: [1, 0, 1], faces: ['east'], role: 'source' },
      { cell: [5, 0, 1], faces: ['west'], role: 'sink' },
    ];
    const [route] = routeNets({
      box: { min: [0, -3, 0], max: [7, 1, 3] },
      solids: terminals.map((t) => t.cell),
      keepFree: [],
      nets: [{ terminals }],
      neat: { y: -3, x: [], z: [] },
    });
    expect(route.connected).toBe(2);
    expect(route.length).toBe(3);
    expect(route.paths.flat().every((p) => p[1] === 0)).toBe(true);
  });

  it('can cross on the surface when every available underground layer is blocked', () => {
    const terminals: RouteNetSpec['terminals'] = [
      { cell: [1, 0, 1], faces: ['down'], role: 'source' },
      { cell: [9, 0, 1], faces: ['down'], role: 'sink' },
    ];
    const solids: Vec3[] = terminals.map((t) => t.cell);
    for (let y = -1; y >= -3; y--) for (let z = 0; z < 3; z++) solids.push([5, y, z]);
    const [route] = routeNets({
      box: { min: [0, -3, 0], max: [11, 1, 3] },
      solids,
      keepFree: [],
      nets: [{ terminals }],
      neat: { y: -3, x: [], z: [] },
      rounds: 0,
    });
    expect(route.connected).toBe(2);
    expect(route.paths.flat().some((p) => p[1] >= 0)).toBe(true);
    expect(route.paths.flat().every((p) => p[1] >= -3)).toBe(true);
  });

  it('starts at -1 even when the maximum underground depth and routing box allow deeper layers', () => {
    const terminals: RouteNetSpec['terminals'] = [
      { cell: [1, 0, 1], faces: ['down'], role: 'source' },
      { cell: [9, 0, 1], faces: ['down'], role: 'sink' },
    ];
    const [route] = routeNets({
      box: { min: [0, -6, 0], max: [11, 1, 3] },
      solids: terminals.map((t) => t.cell),
      keepFree: [],
      nets: [{ terminals }],
      neat: { y: -3, x: [], z: [] },
      rounds: 0,
    });
    expect(route.connected).toBe(2);
    expect(route.paths.flat().every((p) => p[1] === -1)).toBe(true);
  });

  it('can choose a much shorter shortcut at -3 over a long detour at -2', () => {
    const terminals: RouteNetSpec['terminals'] = [
      { cell: [1, 0, 1], faces: ['down'], role: 'source' },
      { cell: [9, 0, 1], faces: ['down'], role: 'sink' },
    ];
    const solids: Vec3[] = terminals.map((t) => t.cell);
    for (let z = 0; z < 8; z++) solids.push([5, -1, z]);
    for (let z = 0; z < 8; z++) solids.push([5, 0, z]);
    for (let z = 0; z < 7; z++) solids.push([5, -2, z]);
    const [route] = routeNets({
      box: { min: [0, -3, 0], max: [11, 1, 8] },
      solids,
      keepFree: [],
      nets: [{ terminals }],
      neat: { y: -3, x: [], z: [] },
      rounds: 0,
    });
    expect(route.connected).toBe(2);
    expect(Math.min(...route.paths.flat().map((p) => p[1]))).toBe(-3);
    expect(route.length).toBeLessThan(20);
    expect(route.paths.flat().every((p) => p[1] < 0)).toBe(true);
  });

  for (const blockedSecondLayer of [false, true])
    it(`keeps crossing independent nets underground and apart, using -${blockedSecondLayer ? 3 : 2}`, () => {
      const nets: RouteNetSpec[] = [
        {
          terminals: [
            { cell: [0, 0, 3], faces: ['down'], role: 'source' },
            { cell: [6, 0, 3], faces: ['down'], role: 'sink' },
          ],
        },
        {
          terminals: [
            { cell: [3, 0, 0], faces: ['down'], role: 'source' },
            { cell: [3, 0, 6], faces: ['down'], role: 'sink' },
          ],
        },
      ];
      const solids: Vec3[] = nets.flatMap((n) => n.terminals.map((t) => t.cell));
      if (blockedSecondLayer) for (let x = 0; x < 7; x++) solids.push([x, -2, 3]);
      const input = {
        box: { min: [0, -3, 0] as Vec3, max: [7, 1, 7] as Vec3 },
        solids,
        keepFree: [],
        nets,
        neat: { y: -3, x: [], z: [] },
      };
      const routes = routeNets(input);
      expect(routes.map((r) => r.connected)).toEqual([2, 2]);
      expect(routes[0].paths.flat().every((p) => p[1] === -1)).toBe(true);
      expect(Math.min(...routes[1].paths.flat().map((p) => p[1]))).toBe(blockedSecondLayer ? -3 : -2);
      const used = new Set(routes[0].paths.flat().map(key));
      expect(routes[1].paths.flat().some((p) => used.has(key(p)))).toBe(false);
      expect(routes.flatMap((r) => r.paths.flat()).every((p) => p[1] < 0 && p[1] >= -3)).toBe(true);
      for (const route of routes)
        for (const path of route.paths)
          for (let i = 1; i < path.length; i++) expect(adjacent(path[i - 1], path[i])).toBe(true);
      expect(routeNets(input)).toEqual(routes);
    });

  it('connects two terminals with a straight pipe and orients the flow', () => {
    const net: RouteNetSpec = {
      terminals: [
        { cell: [1, 0, 5], faces: ['east'], role: 'source' },
        { cell: [9, 0, 5], faces: ['west'], role: 'sink' },
      ],
    };
    const [r] = routeNets({
      box: box(12, 4, 12),
      solids: [
        [1, 0, 5],
        [9, 0, 5],
      ],
      keepFree: [],
      nets: [net],
    });
    expect(r.connected).toBe(2);
    expect(r.length).toBe(7);
    expect(r.attach).toEqual(['east', 'west']);
    for (const p of r.paths) for (let i = 1; i < p.length; i++) expect(adjacent(p[i - 1], p[i])).toBe(true);
    // Every step flows east: from the source to the sink.
    expect(r.flows.length).toBeGreaterThan(0);
    for (const [a, b] of r.flows) expect(b[0] - a[0]).toBe(1);
  });

  it('keeps nets apart and never enters solids or keep-free cells', () => {
    const wall: Vec3[] = [];
    for (let z = 0; z < 10; z++) if (z !== 4 && z !== 6) wall.push([5, 0, z], [5, 1, z], [5, 2, z]);
    const nets: RouteNetSpec[] = [
      {
        terminals: [
          { cell: [0, 0, 4], faces: ['east'], role: 'source' },
          { cell: [9, 0, 4], faces: ['west'], role: 'sink' },
        ],
      },
      {
        terminals: [
          { cell: [0, 0, 6], faces: ['east'], role: 'source' },
          { cell: [9, 0, 6], faces: ['west'], role: 'sink' },
        ],
      },
    ];
    const solids: Vec3[] = [...wall, [0, 0, 4], [9, 0, 4], [0, 0, 6], [9, 0, 6]];
    const keep: Vec3[] = [[3, 0, 5]];
    const res = routeNets({ box: box(10, 3, 10), solids, keepFree: keep, nets });
    expect(res.map((r) => r.connected)).toEqual([2, 2]);
    const blocked = new Set([...solids, ...keep].map(key));
    const seen = new Map<string, number>();
    res.forEach((r, n) =>
      r.paths.flat().forEach((p) => {
        expect(blocked.has(key(p))).toBe(false);
        const k = key(p);
        expect(seen.get(k) ?? n).toBe(n);
        seen.set(k, n);
      }),
    );
  });

  it('builds a tree for many terminals and marks ambiguous junctions without arrows', () => {
    const terms = [0, 3, 6, 9].map((x, i) => ({
      cell: [x + 1, 0, 1] as Vec3,
      faces: ['south' as const],
      role: (i === 0 ? 'source' : 'sink') as 'source' | 'sink',
    }));
    const [r] = routeNets({
      box: box(12, 3, 8),
      solids: terms.map((t) => t.cell),
      keepFree: [],
      nets: [{ terminals: terms }],
    });
    expect(r.connected).toBe(4);
    // One source: every pipe step has a direction.
    const cells = new Set(r.paths.flat().map(key));
    const directed = new Set(r.flows.flatMap(([a, b]) => [key(a), key(b)]));
    for (const c of cells) expect(directed.has(c)).toBe(true);
  });

  it('reroutes a net that blocks another one (rip-up)', () => {
    // A corridor of width 1 at z = 2 (y limited to 1 layer): net A would block net B's only way if routed
    // through the corridor first; rip-up must find the order that connects both.
    const solids: Vec3[] = [];
    for (let x = 0; x < 12; x++) for (const z of [0, 4]) solids.push([x, 0, z]);
    const nets: RouteNetSpec[] = [
      {
        terminals: [
          { cell: [2, 0, 0], faces: ['south'], role: 'source' },
          { cell: [9, 0, 0], faces: ['south'], role: 'sink' },
        ],
      },
      {
        terminals: [
          { cell: [1, 0, 4], faces: ['north'], role: 'source' },
          { cell: [10, 0, 4], faces: ['north'], role: 'sink' },
        ],
      },
    ];
    const res = routeNets({ box: box(12, 1, 5), solids, keepFree: [], nets });
    expect(res.reduce((s, r) => s + r.connected, 0)).toBe(4);
  });

  it('reports unreachable terminals and stays inside the box', () => {
    const [r] = routeNets({
      box: box(6, 2, 6),
      solids: [
        [2, 0, 2],
        [2, 0, 3],
        [3, 0, 2],
        [3, 0, 3],
      ],
      keepFree: [],
      nets: [
        {
          terminals: [
            { cell: [1, 0, 1], faces: ['east'], role: 'source' },
            { cell: [20, 0, 20], faces: ['west'], role: 'sink' },
          ],
        },
      ],
    });
    expect(r.connected).toBe(1);
    expect(r.attach[1]).toBeNull();
    for (const p of r.paths.flat()) expect(p.every((c, i) => c >= 0 && c < [6, 2, 6][i])).toBe(true);
  });

  it('routes a dense 30 × 30 site with 30 nets quickly', () => {
    const solids: Vec3[] = [];
    const nets: RouteNetSpec[] = [];
    // A 5 × 5 grid of 3 × 3 × 3 blocks with 3-wide corridors; every block feeds the next one in its row.
    const blocks: Vec3[] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) blocks.push([1 + i * 6, 0, 1 + j * 6]);
    for (const [bx, , bz] of blocks)
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) solids.push([bx + x, y, bz + z]);
    blocks.forEach(([bx, , bz], n) => {
      const next = blocks[(n + 5) % blocks.length];
      nets.push({
        terminals: [
          { cell: [bx + 2, 0, bz + 1], faces: ['east', 'up'], role: 'source' },
          { cell: [next[0], 0, next[2] + 1], faces: ['west', 'up'], role: 'sink' },
        ],
      });
    });
    // Five long nets over the tops, from the first column of blocks to the last.
    for (let j = 0; j < 5; j++) {
      const [ax, , az] = blocks[j];
      const [bx, , bz] = blocks[20 + j];
      nets.push({
        terminals: [
          { cell: [ax + 1, 2, az + 1], faces: ['up'], role: 'source' },
          { cell: [bx + 1, 2, bz + 1], faces: ['up'], role: 'sink' },
        ],
      });
    }
    const t0 = performance.now();
    const res = routeNets({ box: box(30, 6, 30), solids, keepFree: [], nets });
    const ms = performance.now() - t0;
    const connected = res.reduce((s, r) => s + r.connected, 0);
    expect(connected).toBe(res.reduce((s, r) => s + r.total, 0));
    expect(ms).toBeLessThan(3000);
  });
});
