import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { PLACEHOLDER_DEF, SINGLE_BLOCK_DEF } from '../../data/generic';
import { validateMultiblockDef } from '../../data/validate';
import { key, toWorld, localCells } from '../geometry';
import type { Rotation, Vec3 } from '../core/types';
import type { Unit } from '../multiblock/types';
import { createSiteBuilder } from './build';
import { deriveSiteDemand, hatchKindFor } from './demand';
import { placeGroups, type GroupCache } from './groups';
import { groupIndexOfUnit, portIndexOfUnit, portUnitId } from './ids';
import { groupToward } from './toward';
import { buildGroup, groupPoint, placeUnit, singleBlockLimits } from './group';
import type { SiteGroup, SiteState } from './types';

const ebf = getMultiblock('electric-blast-furnace')!;
const vf = getMultiblock('vacuum-freezer')!;
const noLimits = { x: null, y: null, z: null };

function group(
  id: string,
  multiblockId: string,
  origin: [number, number],
  extra: Partial<SiteGroup> = {},
): SiteGroup {
  return {
    id,
    multiblockId,
    count: 2,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [],
    origin,
    rotation: 0,
    ...extra,
  };
}

function site(partial: Partial<SiteState>): SiteState {
  return {
    v: 1,
    kind: 'site',
    size: [30, 30],
    corridor: 2,
    groups: [],
    links: [],
    ports: [],
    resources: {
      'item:dust': { kind: 'item', name: 'Steel Dust', color: '#888888' },
      'item:hot': { kind: 'item', name: 'Hot Steel Ingot', color: '#ff8800' },
      'fluid:o2': { kind: 'fluid', name: 'Oxygen', color: '#3fa7d6' },
      'item:ingot': { kind: 'item', name: 'Steel Ingot', color: '#cccccc' },
    },
    colors: {},
    ...partial,
  };
}

describe('generic defs', () => {
  it('are valid multiblock definitions', () => {
    expect(validateMultiblockDef(PLACEHOLDER_DEF)).toEqual([]);
    expect(validateMultiblockDef(SINGLE_BLOCK_DEF)).toEqual([]);
  });
});

describe('group transform', () => {
  it('turns units consistently with the packer geometry', () => {
    const b = buildGroup(ebf, 3, noLimits, ['maintenance'], {});
    for (const r of [0, 1, 2, 3] as Rotation[]) {
      for (const u of b.units) {
        const placed = placeUnit(ebf, u, b.size, r, [7, 4]);
        for (const c of localCells(ebf)) {
          const viaGroup = groupPoint(toWorld(ebf, u, c.local), b.size, r, [7, 4]);
          expect(toWorld(ebf, placed, c.local)).toEqual(viaGroup);
        }
      }
    }
  });

  it('normalises the group to start at the origin', () => {
    const b = buildGroup(ebf, 4, noLimits, [], {});
    const min = [0, 1, 2].map((i) => Math.min(...b.units.map((u) => u.origin[i])));
    expect(min).toEqual([0, 0, 0]);
  });
});

describe('hatch demand', () => {
  it('places one hatch per resource on every unit and tags it', () => {
    const b = buildGroup(
      ebf,
      2,
      noLimits,
      [],
      { itemIn: ['item:dust', 'item:x'], itemOut: ['item:hot'] },
      false,
      {},
      { tier: 'ULV' },
    );
    expect(b.missing).toEqual([]);
    for (const u of b.units)
      for (const r of ['item:dust', 'item:x'])
        expect(
          b.hatches.some((h) => h.kind === 'itemIn' && h.resource === r && h.unitIds.includes(u.id)),
        ).toBe(true);
  });

  it('picks the hatch kind a machine has', () => {
    const steam = getMultiblock('steam-grinder')!;
    const water = { kind: 'fluid' as const, name: 'Steam', color: '#ffffff' };
    expect(hatchKindFor('in', 'fluid:steam', water, steam)).toBe('steamIn');
    expect(hatchKindFor('in', 'fluid:o2', { ...water, name: 'Oxygen' }, ebf)).toBe('fluidIn');
    expect(hatchKindFor('out', 'power:eu', { kind: 'power', name: 'EU', color: '#ffff00' }, ebf)).toBeNull();
    expect(
      hatchKindFor('in', 'item:x', { kind: 'item', name: 'X', color: '#000000' }, SINGLE_BLOCK_DEF),
    ).toBe('itemIn');
  });
});

describe('buildSite', () => {
  const chain = site({
    groups: [group('ebf', 'electric-blast-furnace', [4, 4]), group('vf', 'vacuum-freezer', [16, 4])],
    ports: [
      { id: 'dust', dir: 'in', resource: 'item:dust' },
      { id: 'o2', dir: 'in', resource: 'fluid:o2' },
      { id: 'ingot', dir: 'out', resource: 'item:ingot' },
    ],
    links: [
      { id: 'l1', from: { port: 'dust' }, to: { group: 'ebf' }, resource: 'item:dust', rate: 2 },
      { id: 'l2', from: { port: 'o2' }, to: { group: 'ebf' }, resource: 'fluid:o2' },
      { id: 'l3', from: { group: 'ebf' }, to: { group: 'vf' }, resource: 'item:hot' },
      { id: 'l4', from: { group: 'vf' }, to: { port: 'ingot' }, resource: 'item:ingot' },
    ],
  });

  it('puts a group hatch on the side its pipe leaves by', () => {
    const make = (portSide: 'in' | 'out') =>
      site({
        size: [40, 40],
        groups: [group('ebf', 'electric-blast-furnace', [16, 18], { count: 1 })],
        ports: [{ id: 'p', dir: portSide, resource: portSide === 'in' ? 'item:dust' : 'item:hot' }],
        links: [
          portSide === 'in'
            ? { id: 'l', from: { port: 'p' }, to: { group: 'ebf' }, resource: 'item:dust' }
            : { id: 'l', from: { group: 'ebf' }, to: { port: 'p' }, resource: 'item:hot' },
        ],
      });
    // The input port sits on the west edge, the output port on the east edge.
    const hatchX = (portSide: 'in' | 'out') => {
      const b = createSiteBuilder()(make(portSide), { pipes: true, cables: false });
      const h = b.groups[0].hatches.find((x) => x.resource)!;
      expect(b.nets[0].route!.connected).toBe(2);
      return h.cell[0];
    };
    expect(hatchX('in')).toBeLessThan(hatchX('out'));
  });

  it('puts a port on the edge nearest its group when that saves pipe', () => {
    const s = site({
      size: [60, 30],
      // Far east of the west edge, right by the north edge.
      groups: [group('ebf', 'electric-blast-furnace', [30, 1], { count: 1 })],
      ports: [
        { id: 'far', dir: 'in', resource: 'item:dust' },
        { id: 'near', dir: 'out', resource: 'item:hot' },
      ],
      links: [
        { id: 'l1', from: { port: 'far' }, to: { group: 'ebf' }, resource: 'item:dust' },
        { id: 'l2', from: { group: 'ebf' }, to: { port: 'near' }, resource: 'item:hot' },
      ],
    });
    const b = createSiteBuilder()(s, { pipes: false, cables: false });
    const cell = (id: string) => b.ports.find((p) => p.port.id === id)!.cell;
    // The input would be 30 blocks away on the west edge: the north edge is next to the group.
    expect(cell('far')[2]).toBe(0);
    expect(cell('far')[0]).toBeGreaterThan(20);
  });

  it('puts ports on the north and south edges when their own edge is full', () => {
    // A 12-block edge holds six ports (one free block between neighbours).
    const ports = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      dir: 'in' as const,
      resource: 'item:dust',
    }));
    const s = site({
      size: [20, 12],
      groups: [group('ebf', 'electric-blast-furnace', [8, 4], { count: 1 })],
      ports,
      links: ports.map((p, i) => ({
        id: `l${i}`,
        from: { port: p.id },
        to: { group: 'ebf' },
        resource: 'item:dust',
      })),
    });
    const b = createSiteBuilder()(s, { pipes: false, cables: false });
    expect(b.warnings.filter((w) => w.type === 'noport')).toEqual([]);
    const west = b.ports.filter((p) => p.cell[0] === 0);
    const sides = b.ports.filter((p) => p.cell[0] !== 0);
    expect(west).toHaveLength(6);
    expect(sides).toHaveLength(4);
    for (const p of sides) {
      expect(p.cell[2] === 0 || p.cell[2] === 11).toBe(true);
      expect(p.faces[0]).toBe(p.cell[2] === 0 ? 'south' : 'north');
    }
    const cells = new Set(b.ports.map((p) => `${p.cell[0]},${p.cell[2]}`));
    expect(cells.size).toBe(10);
  });

  it('packs groups, places ports on the edges and routes every net', () => {
    const b = createSiteBuilder()(chain, { pipes: true, cables: false });
    expect(b.groups.map((g) => g.units.length)).toEqual([2, 2]);
    expect(b.warnings).toEqual([]);
    expect(b.nets).toHaveLength(4);
    for (const n of b.nets) expect(n.route!.connected).toBe(n.route!.total);
    const dust = b.ports.find((p) => p.port.id === 'dust')!;
    expect(dust.cell[0]).toBe(0);
    expect(b.ports.find((p) => p.port.id === 'ingot')!.cell[0]).toBe(29);
    // The site grid, labels and per-resource colours reach the scene.
    expect(b.scene.site).toEqual({ size: [30, 30] });
    expect(b.scene.labels?.length).toBe(5);
    expect(b.scene.pipes?.map((p) => p.color)).toContain('#ff8800');
    // Pipes stay inside the site, above ground and out of every structure.
    const solid = new Set(b.scene.voxels.map((v) => key(v.pos)));
    for (const n of b.scene.pipes ?? [])
      for (const p of n.paths.flat()) {
        expect(solid.has(key(p))).toBe(false);
        expect(p[0] >= 0 && p[0] < 30 && p[2] >= 0 && p[2] < 30 && p[1] >= 0).toBe(true);
      }
    // Unit ids tell which group a voxel belongs to, and port blocks carry the id of their port.
    const ids = b.scene.voxels.flatMap((v) => v.unitIds);
    expect(new Set(ids.filter((id) => portIndexOfUnit(id) < 0).map(groupIndexOfUnit))).toEqual(
      new Set([0, 1]),
    );
    for (const [i, p] of chain.ports.entries()) {
      const cell = b.ports.find((x) => x.port.id === p.id)!.cell;
      expect(b.scene.voxels.find((v) => key(v.pos) === key(cell))!.unitIds).toEqual([portUnitId(i)]);
    }
  });

  it('builds a pinned port where it was put', () => {
    const pinned = {
      ...chain,
      ports: chain.ports.map((p) => (p.id === 'dust' ? { ...p, pos: [9, 27] as [number, number] } : p)),
    };
    const b = createSiteBuilder()(pinned, { pipes: true, cables: false });
    expect(b.ports.find((p) => p.port.id === 'dust')!.cell).toEqual([9, 0, 27]);
    expect(b.nets.find((n) => n.resource === 'item:dust')!.route!.connected).toBe(2);
  });

  it('reuses group builds between runs and only repacks what changed', () => {
    const build = createSiteBuilder();
    const a = build(chain, { pipes: false, cables: false });
    const moved = {
      ...chain,
      groups: [chain.groups[0], { ...chain.groups[1], origin: [18, 10] as [number, number] }],
    };
    const b = build(moved, { pipes: false, cables: false });
    expect(b.groups[0].build).toBe(a.groups[0].build);
    expect(b.groups[1].build).toBe(a.groups[1].build);
    expect(b.groups[1].min).toEqual([18, 0, 10]);
  });

  it('reports overlapping and out-of-bounds groups', () => {
    const s = site({
      groups: [
        group('a', 'electric-blast-furnace', [2, 2]),
        group('b', 'electric-blast-furnace', [3, 2]),
        group('c', 'vacuum-freezer', [28, 28]),
      ],
    });
    const b = createSiteBuilder()(s, { pipes: false, cables: false });
    expect(b.warnings).toContainEqual({ type: 'overlap', groups: ['a', 'b'] });
    expect(b.warnings).toContainEqual({ type: 'outside', group: 'c' });
    expect(b.scene.voxels.some((v) => v.conflict)).toBe(true);
  });

  it('warns when a machine cannot take a resource', () => {
    const s = site({
      groups: [
        group('coke', 'coke-oven', [4, 4], { count: 1 }),
        group('vf', 'vacuum-freezer', [14, 4], { count: 1 }),
      ],
      resources: { 'power:eu': { kind: 'power', name: 'EU', color: '#ffee00' } },
      links: [{ id: 'l', from: { group: 'coke' }, to: { group: 'vf' }, resource: 'power:eu' }],
    });
    const b = createSiteBuilder()(s, { pipes: true, cables: true });
    expect(b.warnings).toContainEqual({ type: 'unsupported', group: 'coke', resource: 'power:eu' });
  });

  it('gives single-block machines IO on their own faces and fades other nets when isolating', () => {
    const s = site({
      groups: [
        group('mix', 'single-block', [4, 10], { count: 3, limits: noLimits }),
        group('ebf', 'electric-blast-furnace', [14, 10], { count: 1 }),
      ],
      ports: [{ id: 'o2', dir: 'in', resource: 'fluid:o2' }],
      links: [
        { id: 'a', from: { group: 'mix' }, to: { group: 'ebf' }, resource: 'item:dust' },
        { id: 'b', from: { port: 'o2' }, to: { group: 'ebf' }, resource: 'fluid:o2' },
      ],
    });
    const b = createSiteBuilder()(s, { pipes: true, cables: false, isolate: 'fluid:o2' });
    const mix = b.groups[0];
    expect(mix.hatches).toHaveLength(3);
    for (const h of mix.hatches)
      expect(mix.units.some((u: Unit) => key(u.origin) === key(h.cell))).toBe(true);
    // No hatch voxel replaces a single-block machine.
    const machineCells = new Set(mix.units.map((u) => key(u.origin)));
    expect(
      b.scene.voxels.filter((v) => machineCells.has(key(v.pos))).every((v) => v.kind === 'controller'),
    ).toBe(true);
    const dust = b.nets.find((n) => n.resource === 'item:dust')!;
    expect(dust.route!.connected).toBe(4);
    expect(b.scene.pipes!.find((p) => p.id === dust.id)!.dim).toBe(true);
    expect(b.scene.pipes!.find((p) => p.color === '#3fa7d6')!.dim).toBe(false);
  });

  it('raises a group by its elevation: units, hatches, bounds and pipes', () => {
    const groups = (elevation?: number) => [
      group('a', 'electric-blast-furnace', [4, 4], { count: 1 }),
      group('b', 'vacuum-freezer', [16, 4], { count: 1, ...(elevation ? { elevation } : {}) }),
    ];
    const links = [{ id: 'l', from: { group: 'a' }, to: { group: 'b' }, resource: 'item:dust' }];
    const low = createSiteBuilder()(site({ groups: groups(), links }), { pipes: true, cables: false });
    const high = createSiteBuilder()(site({ groups: groups(10), links }), { pipes: true, cables: false });
    const [lo, hi] = [low.groups[1], high.groups[1]];
    expect(hi.min[1]).toBe(10);
    expect(hi.max[1] - hi.min[1]).toBe(lo.max[1] - lo.min[1]);
    for (let i = 0; i < lo.units.length; i++) expect(hi.units[i].origin[1]).toBe(lo.units[i].origin[1] + 10);
    for (let i = 0; i < lo.hatches.length; i++)
      expect(hi.hatches[i].cell[1]).toBe(lo.hatches[i].cell[1] + 10);
    // The pipe still reaches the raised group, running up to it.
    expect(high.nets[0].route!.connected).toBe(high.nets[0].route!.total);
    expect(Math.max(...high.nets[0].route!.paths.flat().map((c) => c[1]))).toBeGreaterThanOrEqual(9);
    expect(high.warnings.filter((w) => w.type === 'overlap' || w.type === 'outside')).toEqual([]);
  });

  it('draws single-block machines with the look of their machine', () => {
    const s = site({
      groups: [
        group('mac', 'single-block', [4, 4], { count: 2, limits: noLimits, machine: 'macerator' }),
        group('plain', 'single-block', [14, 4], { count: 1, limits: noLimits }),
        group('ebf', 'electric-blast-furnace', [4, 14], { count: 1 }),
      ],
    });
    const b = createSiteBuilder()(s, { pipes: false, cables: false });
    const at = (g: number) => new Set(b.groups[g].units.map((u) => key(u.origin)));
    const blockAt = (cells: Set<string>) =>
      b.scene.voxels.filter((v) => cells.has(key(v.pos))).map((v) => v.blockId);
    expect(new Set(blockAt(at(0)))).toEqual(new Set(['site.machine.macerator']));
    expect(new Set(blockAt(at(1)))).toEqual(new Set(['site.singleblock']));
    expect(
      b.scene.voxels.some((v) => v.blockId === 'site.machine.macerator' && v.kind === 'controller'),
    ).toBe(true);
  });

  it('stacks single-block machines in layers with room for pipes between them', () => {
    const flat = buildGroup(SINGLE_BLOCK_DEF, 12, { x: 4, y: 1, z: null }, [], {});
    const tall = buildGroup(SINGLE_BLOCK_DEF, 12, { x: 2, y: 3, z: null }, [], {});
    expect(flat.size[1]).toBe(1);
    expect(tall.size[1]).toBe(7);
    expect(new Set(tall.units.map((u) => u.origin[1]))).toEqual(new Set([0, 3, 6]));
    expect(tall.units).toHaveLength(12);
    expect(tall.size[0] * tall.size[2]).toBeLessThan(flat.size[0] * flat.size[2]);
  });

  it('finds the fewest layers that fit single-block machines into a room', () => {
    const fits = (n: number, room: [number, number]) => {
      const l = singleBlockLimits(n, room, 12);
      const perLayer = Math.ceil(n / (l.y ?? 1));
      const rows = Math.ceil(perLayer / (l.x ?? 1));
      return { layers: l.y, span: [2 * (l.x ?? 1) - 1, 3 * rows - 2] };
    };
    expect(fits(20, [100, 100]).layers).toBe(1);
    const tight = fits(100, [20, 20]);
    expect(tight.layers).toBeGreaterThan(1);
    expect(tight.span[0]).toBeLessThanOrEqual(20);
    expect(tight.span[1]).toBeLessThanOrEqual(20);
    // Nothing fits: the tallest stack, as square as it gets.
    expect(fits(1000, [5, 5]).layers).toBe(12);
  });

  it('merges links of one resource sharing an end into one net', () => {
    const s = site({
      groups: [
        group('a', 'electric-blast-furnace', [2, 2], { count: 1 }),
        group('b', 'vacuum-freezer', [12, 2], { count: 1 }),
        group('c', 'vacuum-freezer', [12, 14], { count: 1 }),
      ],
      links: [
        { id: 'x', from: { group: 'a' }, to: { group: 'b' }, resource: 'item:hot' },
        { id: 'y', from: { group: 'a' }, to: { group: 'c' }, resource: 'item:hot' },
      ],
    });
    const b = createSiteBuilder()(s, { pipes: true, cables: false });
    expect(b.nets).toHaveLength(1);
    expect(b.nets[0].links).toEqual(['x', 'y']);
    expect(b.nets[0].route!.connected).toBe(3);
  });

  describe('routing options', () => {
    const build = (opts: object) => createSiteBuilder()(chain, { pipes: true, cables: true, ...opts });
    const same = (x: object, y: object) => expect(JSON.stringify(x)).toBe(JSON.stringify(y));

    it('classic depth 1 is the legacy below, classic depth 0 the default', () => {
      same(build({ routing: { style: 'classic', depth: 1 } }), build({ below: true }));
      same(build({ routing: { style: 'classic', depth: 0 } }), build({}));
      same(build({ routing: { style: 'classic', depth: 0 } }), build({ below: false }));
    });

    it('reports where the routed blocks are', () => {
      for (const routing of [
        { style: 'classic', depth: 0 },
        { style: 'neat', depth: 2 },
      ] as const) {
        const b = build({ routing });
        const r = b.stats.routeStats;
        expect(r.length).toBe(b.stats.pipeBlocks + b.stats.cableBlocks);
        expect(r.length).toBe(r.surfaceTrunk + r.surfaceStub + r.underground.reduce((x, y) => x + y, 0));
        expect(r.underground).toHaveLength(routing.depth);
        expect(b.stats.connected).toBe(b.stats.terminals);
      }
    });

    it('clamps the depth when the search grid would be too big', () => {
      const big = site({
        size: [256, 256],
        groups: [group('ebf', 'electric-blast-furnace', [100, 100], { count: 1, elevation: 12 })],
        ports: [{ id: 'p', dir: 'in', resource: 'item:dust' }],
        links: [{ id: 'l', from: { port: 'p' }, to: { group: 'ebf' }, resource: 'item:dust' }],
      });
      const ask = (depth: 0 | 1 | 2 | 3) =>
        createSiteBuilder()(big, { pipes: true, cables: false, routing: { style: 'neat', depth } });
      expect(ask(0).routing.depthUsed).toBe(0);
      expect(ask(1).routing.depthUsed).toBe(1);
      const deep = ask(3);
      expect(deep.routing.depth).toBe(3);
      expect(deep.routing.depthUsed).toBeLessThan(3);
      expect(deep.routing.depthUsed).toBeGreaterThanOrEqual(1);
    });

    it('neat keeps the trunks off the surface, and is deterministic', () => {
      const routing = { style: 'neat', depth: 2 } as const;
      const neat = build({ routing });
      const classic = build({ routing: { style: 'classic', depth: 2 } });
      expect(neat.stats.routeStats.underground[0]).toBeGreaterThan(0);
      expect(neat.stats.routeStats.surfaceTrunk).toBeLessThan(classic.stats.routeStats.surfaceTrunk);
      same(neat, build({ routing }));
    });
  });
});

describe('placeholder', () => {
  it('builds like a normal multiblock', () => {
    const b = buildGroup(PLACEHOLDER_DEF, 2, noLimits, ['maintenance'], { fluidIn: ['fluid:o2'] });
    expect(b.units).toHaveLength(2);
    expect(b.hatches.filter((h) => h.kind === 'fluidIn')).not.toHaveLength(0);
    expect(vf.size).toBeDefined();
    const cells: Vec3[] = b.units.map((u) => u.origin);
    expect(cells.length).toBe(2);
  });
});

describe('the per-group pack cache', () => {
  const flat = site({ groups: [group('a', 'electric-blast-furnace', [3, 3])] });
  const stacked = site({
    groups: [group('a', 'electric-blast-furnace', [3, 3], { limits: { x: 1, y: 2, z: 1 } })],
  });
  const run = (s: SiteState, cache: GroupCache, prune?: boolean) => {
    const d = deriveSiteDemand(s);
    placeGroups(s, d.demands, groupToward(s, d.endsOf), false, cache, prune);
  };

  it('shares maintenance and energy hatches only when the group asks, with its own cache entry', () => {
    const cache: GroupCache = new Map();
    const hatchesOf = (extra: Partial<SiteGroup>) => {
      const s = site({
        groups: [
          group('a', 'pyrolyse-oven', [3, 3], {
            limits: { x: 2, y: 1, z: 1 },
            enabledHatches: ['energy', 'maintenance'],
            ...extra,
          }),
        ],
      });
      const d = deriveSiteDemand(s);
      const { groups } = placeGroups(s, d.demands, groupToward(s, d.endsOf), false, cache, false);
      const of = (kind: string) =>
        groups[0].hatches.filter((h) => h.kind === kind).map((h) => h.unitIds.length);
      const hints = Object.values(groups[0].build?.validity ?? {})
        .flat()
        .map((p) => p.type)
        .filter((type) => type === 'sharedEnergy' || type === 'sharedMaintenance')
        .sort();
      return { energy: of('energy'), maintenance: of('maintenance'), hints };
    };
    const off = hatchesOf({});
    expect(off).toMatchObject({ energy: [1, 1], maintenance: [1, 1] });
    expect(off.hints).toEqual([]);
    const on = hatchesOf({ shareEnergy: true, shareMaintenance: true });
    expect(on).toMatchObject({ energy: [2], maintenance: [2] });
    expect(on.hints).toEqual(['sharedEnergy', 'sharedEnergy', 'sharedMaintenance', 'sharedMaintenance']);
    expect(cache.size).toBe(2);
    expect(hatchesOf({})).toEqual(off);
    expect(cache.size).toBe(2);
  });

  it('checks the glass tier on every placement without keying the pack cache on it', () => {
    const glassOf = (extra: Partial<SiteGroup>) => {
      const s = site({
        groups: [
          group('a', 'mega-oil-cracker', [3, 3], { enabledHatches: ['energy', 'maintenance'], ...extra }),
        ],
      });
      const d = deriveSiteDemand(s);
      const cache: GroupCache = new Map();
      const { groups } = placeGroups(s, d.demands, groupToward(s, d.endsOf), false, cache);
      return { glass: groups[0].glassValidity, size: cache.size };
    };
    expect(glassOf({}).glass).toBeUndefined();
    const high = glassOf({ tier: 'EV' });
    expect(Object.values(high.glass!).flat()).toEqual([
      { type: 'glassTier', kind: 'energy', hatchTier: 'EV', glassTier: 'HV', severity: 'error' },
      { type: 'glassTier', kind: 'energy', hatchTier: 'EV', glassTier: 'HV', severity: 'error' },
    ]);
    expect(glassOf({ tier: 'EV', glassTier: 'UV' }).glass).toBeUndefined();
    // A hatch tier override of an energy hatch counts too (keys as in `groupKey`).
    expect(glassOf({ tier: 'HV', hatchTiers: { 'energy:0': 'IV' } }).glass).toBeDefined();
  });

  it('drops the packs a site does not use, so editing keeps memory bounded', () => {
    const cache: GroupCache = new Map();
    run(flat, cache);
    run(stacked, cache);
    expect(cache.size).toBe(1);
  });

  it('keeps them all when asked, for a search that comes back to the same packs', () => {
    const cache: GroupCache = new Map();
    run(flat, cache, false);
    run(stacked, cache, false);
    expect(cache.size).toBe(2);
    // Going back to the first layout packs nothing new.
    const before = new Set(cache.keys());
    run(flat, cache, false);
    expect(new Set(cache.keys())).toEqual(before);
  });

  it('is what the builder’s keepCache option does', () => {
    const build = createSiteBuilder();
    const a = build(flat, { pipes: false, cables: false, keepCache: true });
    build(stacked, { pipes: false, cables: false, keepCache: true });
    // The same pack comes back for the same group, not a rebuilt one.
    const again = build(flat, { pipes: false, cables: false, keepCache: true });
    expect(again.groups[0].build).toBe(a.groups[0].build);
  });
});
