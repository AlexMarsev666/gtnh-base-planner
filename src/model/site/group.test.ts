import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { SINGLE_BLOCK_DEF } from '../../data/generic';
import { localCells, toWorld } from '../geometry';
import { withHatchZones, zoneOfCell } from '../hatches/zones';
import { mirroredDef } from '../mirror';
import type { HatchKind } from '../multiblock/types';
import { buildGroup, type Demand, type GroupOptions } from './group';
import { placeGroups, type GroupCache } from './groups';
import type { SiteGroup, SiteState } from './types';

const ebf = getMultiblock('electric-blast-furnace')!;
const oil = getMultiblock('oil-cracking-unit')!;
const none = { x: null, y: null, z: null };
// The EBF also needs a muffler; these tests are about the resource hatches.
const plain: HatchKind[] = ['energy', 'maintenance'];

const items = (n: number) => Array.from({ length: n }, (_, i) => `item:r${i}`);

// ULV buses and hatches hold one resource, so unless a test says otherwise each resource has its own hatch.
function build(count: number, demand: Demand, opts: GroupOptions = {}, def = ebf, base = plain) {
  return buildGroup(def, count, none, base, demand, false, {}, { tier: 'ULV', ...opts });
}

/** Resources a unit gets (itemIn hatches serving it). */
function resourcesOf(b: ReturnType<typeof build>, unitId: number, kind: HatchKind = 'itemIn'): string[] {
  return b.hatches
    .filter((h) => h.kind === kind && h.unitIds.includes(unitId))
    .map((h) => h.resource!)
    .sort();
}

describe('where a resource may attach (ends)', () => {
  const demand: Demand = { fluidOut: ['fluid:f'] };
  it('boxes the cells a kind may take, and has none where every open face is disallowed for it', () => {
    const b = build(1, demand, {}, oil, ['energy']);
    expect(b.ends?.['fluid:f']).toBeDefined();
    const sealed = {
      ...oil,
      legend: {
        ...oil.legend,
        r: { ...oil.legend.r, disallowFaces: { fluidOut: ['north', 'south', 'east', 'west', 'up', 'down'] } },
      },
    } as typeof oil;
    expect(build(1, demand, {}, sealed, ['energy']).ends?.['fluid:f']).toBeUndefined();
  });
});

describe('resource hatches as requests', () => {
  it('gives every unit the full set when it fits', () => {
    const b = build(3, { itemIn: items(2) });
    for (const u of b.units) expect(resourcesOf(b, u.id)).toEqual(items(2));
    expect(b.missing).toEqual([]);
    expect(b.notes).toEqual([]);
    expect(b.problems.filter((p) => p.type !== 'hatch')).toEqual([]);
  });

  it('spreads the resources over the units when the full set does not fit', () => {
    const resources = items(8);
    const b = build(3, { itemIn: resources });
    expect(b.notes).toHaveLength(1);
    const note = b.notes[0];
    if (note.type !== 'distributed') throw new Error('unreachable');
    // Only the resources that ended on some of the units are listed.
    for (const r of note.resources)
      expect(b.units.filter((u) => resourcesOf(b, u.id).includes(r)).length).toBeLessThan(3);
    expect(b.missing).toEqual([]);
    const per = b.units.map((u) => resourcesOf(b, u.id));
    // Every resource lands on at least one unit, no unit has them all, and the loads stay close.
    for (const r of resources) expect(per.some((list) => list.includes(r))).toBe(true);
    for (const list of per) expect(list.length).toBeLessThan(resources.length);
    const sizes = per.map((l) => l.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(2);
    expect(b.problems.some((p) => p.type === 'capacity')).toBe(false);
  });

  it('is deterministic', () => {
    expect(build(3, { itemIn: items(8) }).hatches).toEqual(build(3, { itemIn: items(8) }).hatches);
  });

  it('puts an assigned resource on its unit only', () => {
    const b = build(3, { itemIn: items(2) }, { assign: { 'item:r1': { unit: 1 } } });
    expect(resourcesOf(b, 0)).toEqual(['item:r0']);
    expect(resourcesOf(b, 1)).toEqual(items(2));
    expect(resourcesOf(b, 2)).toEqual(['item:r0']);
    expect(b.missing).toEqual([]);
  });

  it('gives an `all` resource one hatch that serves every unit', () => {
    const b = build(2, { itemIn: items(2) }, { assign: { 'item:r0': { unit: 'all' } } });
    const shared = b.hatches.filter((h) => h.resource === 'item:r0');
    expect(shared).toHaveLength(1);
    expect(shared[0].unitIds).toEqual([0, 1]);
    expect(b.missing).toEqual([]);
  });

  it('reports an assignment to a unit the group does not have, and places nothing for it', () => {
    const b = build(2, { itemIn: items(2) }, { assign: { 'item:r0': { unit: 5 } } });
    expect(b.problems).toContainEqual({ type: 'assignInactive', resource: 'item:r0', unit: 5 });
    expect(b.hatches.some((h) => h.resource === 'item:r0')).toBe(false);
    expect(b.missing).toEqual([]);
    for (const u of b.units) expect(resourcesOf(b, u.id)).toEqual(['item:r1']);
  });

  it('keeps hatches in the zone they were assigned to', () => {
    const demand: Demand = { fluidIn: ['fluid:h2', 'fluid:steam', 'fluid:oil'], fluidOut: ['fluid:out'] };
    const zones: Record<string, string> = {
      'fluid:h2': 'dot1',
      'fluid:steam': 'dot1',
      'fluid:oil': 'dot2',
      'fluid:out': 'dot3',
    };
    const assign = Object.fromEntries(Object.entries(zones).map(([r, zone]) => [r, { zone }]));
    const b = build(1, demand, { assign }, oil);
    expect(b.missing).toEqual([]);
    const zoned = withHatchZones(oil);
    const unit = b.units[0];
    for (const h of b.hatches.filter((x) => x.resource)) {
      const cell = localCells(oil).find((c) => toWorld(oil, unit, c.local).join() === h.cell.join())!;
      expect(zoneOfCell(zoned, cell.local, cell.char), h.resource).toBe(zones[h.resource!]);
    }
  });

  it('keeps the minimum a kind requires, whatever the resources', () => {
    const tower = getMultiblock('distillation-tower')!;
    const b = build(1, { fluidOut: ['fluid:a', 'fluid:b'] }, {}, tower, plain);
    const min = tower.requiredHatches!.fluidOut!.min;
    expect(b.hatches.filter((h) => h.kind === 'fluidOut')).toHaveLength(min);
    expect(b.hatches.filter((h) => h.resource)).toHaveLength(2);
  });
});

describe('unrequested kinds', () => {
  it.each(['distillation-tower', 'electric-blast-furnace'])(
    '%s reports nothing it was not asked for',
    (id) => {
      const def = getMultiblock(id)!;
      for (const demand of [{}, { itemIn: ['item:a'] }]) {
        const b = buildGroup(def, 2, none, [], demand, false, {}, {});
        expect(b.unplaced.filter((u) => u.reason === 'required' && demand.itemIn === undefined)).toEqual([]);
        expect(b.problems.filter((p) => p.type === 'hatch' && p.kind === 'muffler')).toEqual([]);
      }
    },
  );
});

describe('spreading under pressure', () => {
  it('places items and fluids that compete for the cells of 32 furnaces', () => {
    const demand: Demand = { itemIn: items(6), fluidIn: ['fluid:a', 'fluid:b'] };
    const b = buildGroup(ebf, 32, none, [...plain, 'muffler'], demand, false, {}, {});
    expect(b.unplaced).toEqual([]);
    expect(b.missing).toEqual([]);
  });

  it('notes an all resource that had to be split', () => {
    const b = build(3, { itemIn: items(2) }, { assign: { 'item:r0': { unit: 'all' } } });
    expect(b.notes).toContainEqual({ type: 'split', resource: 'item:r0', hatches: 2 });
  });

  it('leaves a unit the packer did not place to the fewer warning', () => {
    const b = buildGroup(
      ebf,
      3,
      { x: 1, y: 1, z: 1 },
      plain,
      { itemIn: items(1) },
      false,
      {},
      {
        assign: { 'item:r0': { unit: 2 } },
      },
    );
    expect(b.units.length).toBeLessThan(3);
    expect(b.problems.some((p) => p.type === 'assignInactive')).toBe(false);
  });
});

describe('required regions', () => {
  it('gives a tower one output per layer, resources first, with nothing left required', () => {
    const tower = getMultiblock('distillation-tower')!;
    const b = build(1, { fluidOut: ['fluid:b', 'fluid:a'] }, {}, tower, plain);
    expect(
      b.problems.filter((p) => p.type === 'hatch' && p.reason === 'required' && p.kind === 'fluidOut'),
    ).toEqual([]);
    expect(b.hatches.filter((h) => h.resource)).toHaveLength(2);
  });

  it('never overrides a zone the user set', () => {
    const tower = getMultiblock('distillation-tower')!;
    const b = build(
      1,
      { fluidOut: ['fluid:a', 'fluid:b'] },
      { assign: { 'fluid:a': { zone: 'top' } } },
      tower,
      plain,
    );
    expect(b.missing).toEqual([]);
    expect(
      b.problems.filter((p) => p.type === 'hatch' && p.reason === 'required' && p.kind === 'fluidOut'),
    ).toEqual([]);
  });
});

describe('single-block groups', () => {
  const single = (assign: GroupOptions['assign']) =>
    buildGroup(SINGLE_BLOCK_DEF, 3, none, [], { itemIn: ['item:a', 'item:b'] }, false, {}, { assign });

  it('gives an assigned flow to its unit only', () => {
    const b = single({ 'item:a': { unit: 1 } });
    expect(b.hatches.filter((h) => h.resource === 'item:a').map((h) => h.unitIds)).toEqual([[1]]);
    expect(b.hatches.filter((h) => h.resource === 'item:b')).toHaveLength(3);
  });

  it('keeps every unit for all and for no assignment, and reports an inactive unit', () => {
    expect(single({ 'item:a': { unit: 'all' } }).hatches).toHaveLength(6);
    const b = single({ 'item:a': { unit: 7 } });
    expect(b.problems).toEqual([{ type: 'assignInactive', resource: 'item:a', unit: 7 }]);
    expect(b.hatches.some((h) => h.resource === 'item:a')).toBe(false);
  });
});

describe('one warning per overload', () => {
  it('reports a capacity overload once, with numbers', () => {
    const b = build(3, { itemIn: items(30) });
    const capacity = b.problems.filter((p) => p.type === 'capacity');
    expect(capacity).toHaveLength(1);
    const c = capacity[0];
    if (c.type !== 'capacity') throw new Error('unreachable');
    expect(c.remove).toBe(c.needed - c.fits);
    expect(c.remove).toBeGreaterThan(0);
  });

  it('lists each kind, reason and region once per group', () => {
    const b = build(3, { itemIn: items(30) }, {}, ebf, ['energy']);
    const keys = b.problems
      .filter((p) => p.type === 'hatch')
      .map((p) => JSON.stringify([p.kind, p.reason, p.region]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(b.problems.some((p) => p.type === 'hatch' && p.kind === 'maintenance')).toBe(false);
  });
});

describe('template groups', () => {
  const group = (extra: Partial<SiteGroup> = {}): SiteGroup => ({
    id: 'g',
    multiblockId: 'electric-blast-furnace',
    count: 2,
    limits: none,
    enabledHatches: ['energy', 'maintenance'],
    origin: [0, 0],
    rotation: 0,
    ...extra,
  });
  const site = (g: SiteGroup): SiteState => ({
    v: 1,
    kind: 'site',
    size: [30, 30],
    corridor: 2,
    groups: [g],
    links: [],
    ports: [],
    resources: {},
    colors: {},
  });
  const run = (g: SiteGroup, demand: Demand = {}, cache: GroupCache = new Map()) =>
    placeGroups(site(g), new Map([['g', demand]]), () => ({}), false, cache);

  it('builds a mirrored group from the mirrored def', () => {
    const plainDef = run(group()).groups[0].def!;
    const mirrored = run(group({ mirror: true })).groups[0].def!;
    expect(mirrored).toBe(mirroredDef(plainDef));
    expect(mirrored.controller.pos[0]).toBe(plainDef.size[0] - 1 - plainDef.controller.pos[0]);
  });

  it('honours a wallshare mode', () => {
    const shared = run(group()).groups[0].build!;
    const apart = run(group({ wallshare: 'separate' })).groups[0].build!;
    expect(shared.stats.sharedWalls.length).toBeGreaterThan(0);
    expect(apart.stats.sharedWalls).toEqual([]);
  });

  it('notes a wallshare mode that cannot be honoured', () => {
    // Four units in a row of at most 1 cannot stack: 'stack' falls back (the exact reason is the packer's).
    const r = run(group({ count: 3, limits: { x: 1, y: 1, z: 1 }, wallshare: 'stack' }));
    expect(r.notes).toContainEqual(
      expect.objectContaining({ type: 'wallshare', wanted: 'stack', group: 'g' }),
    );
  });

  it('adds the group to its notes and problems', () => {
    const r = run(group({ assign: { 'item:r0': { unit: 9 } } }), { itemIn: items(2) });
    expect(r.problems).toContainEqual({ type: 'assignInactive', resource: 'item:r0', unit: 9, group: 'g' });
    const d = run(group({ count: 3, tier: 'ULV' }), { itemIn: items(8) });
    expect(d.notes).toContainEqual(expect.objectContaining({ type: 'distributed', group: 'g' }));
  });

  it('rebuilds when an assignment changes, but not for one naming no resource of the group', () => {
    const cache: GroupCache = new Map();
    const demand = { itemIn: items(2) };
    const a = run(group(), demand, cache).groups[0].build;
    expect(run(group({ assign: { stale: { unit: 1 } } }), demand, cache).groups[0].build).toBe(a);
    expect(run(group({ assign: { 'item:r0': { unit: 1 } } }), demand, cache).groups[0].build).not.toBe(a);
  });
});
