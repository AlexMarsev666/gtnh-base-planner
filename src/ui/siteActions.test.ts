import { describe, expect, it } from 'vitest';
import { emptySite, validateSiteState } from '../share/siteCodec';
import type { PlanState } from '../model/plan/types';
import {
  groupLimitAxis,
  pruned,
  withCorridor,
  withGroupAdded,
  withGroupDuplicated,
  withGrownToFit,
  withGroupMoved,
  withGroupPatched,
  withGroupRemoved,
  withGroupRotated,
  withLinkAdded,
  withLinkRemoved,
  withName,
  withPlanAdded,
  withPortPlaced,
  withResourceColor,
  withSiteSize,
} from './siteActions';

function two() {
  let s = withGroupAdded(emptySite(), 'electric-blast-furnace', [3, 3]);
  s = withGroupAdded(s, 'vacuum-freezer', [12, 3]);
  return s;
}

describe('site actions', () => {
  it('adds groups with fresh ids and non-IO default hatches', () => {
    const s = two();
    expect(s.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(s.groups[0].enabledHatches).toEqual(['energy', 'maintenance', 'muffler']);
    expect(withGroupAdded(s, 'nope')).toBe(s);
    expect(() => validateSiteState(s)).not.toThrow();
  });

  it('turns a machine plan into a group', () => {
    const p: PlanState = {
      v: 1,
      multiblockId: 'distillation-tower',
      count: 3,
      limits: { x: 2, y: null, z: null },
      enabledHatches: ['fluidIn', 'fluidOut', 'energy', 'maintenance'],
      colors: {},
      size: 8,
    };
    const g = withPlanAdded(emptySite(), p, [5, 5]).groups[0];
    expect(g).toMatchObject({ multiblockId: 'distillation-tower', count: 3, size: 8, origin: [5, 5] });
    expect(g.limits.x).toBe(2);
    expect(g.enabledHatches).toEqual(['energy', 'maintenance']);
  });

  it('locks a group’s limits when they are edited by hand, and lets the lock be switched', () => {
    let s = two();
    expect(s.groups[0].limitsLocked).toBeUndefined();
    s = withGroupPatched(s, 'g1', { limits: { x: 2, y: 1, z: null } });
    expect(s.groups[0]).toMatchObject({ limits: { x: 2, y: 1, z: null }, limitsLocked: true });
    // Other edits leave the lock alone, and only the edited group is locked.
    s = withGroupPatched(s, 'g1', { count: 4 });
    expect(s.groups[0].limitsLocked).toBe(true);
    expect(s.groups[1].limitsLocked).toBeUndefined();
    s = withGroupPatched(s, 'g1', { limitsLocked: false });
    expect(s.groups[0].limitsLocked).toBeUndefined();
    s = withGroupPatched(s, 'g1', { limitsLocked: true });
    expect(s.groups[0].limitsLocked).toBe(true);
    // A copy keeps the lock with the limits.
    expect(withGroupDuplicated(s, 'g1', [30, 3]).groups[2]).toMatchObject({ limitsLocked: true });
  });

  it('locks the limits of a machine plan that set some, and not one that left them open', () => {
    const plan = (limits: PlanState['limits']): PlanState =>
      ({
        v: 1,
        multiblockId: 'electric-blast-furnace',
        count: 2,
        limits,
        enabledHatches: ['energy'],
        colors: {},
      }) as PlanState;
    const open = withPlanAdded(emptySite(), plan({ x: null, y: null, z: null }), [5, 5]).groups[0];
    expect(open.limitsLocked).toBeUndefined();
    const set = withPlanAdded(emptySite(), plan({ x: null, y: 2, z: null }), [5, 5]).groups[0];
    expect(set.limitsLocked).toBe(true);
  });

  it('links groups and ports, reusing ports and resources', () => {
    let s = two();
    s = withLinkAdded(s, { port: true }, { group: 'g1' }, { name: 'Iron Dust', kind: 'item' }, 2);
    s = withLinkAdded(s, { group: 'g1' }, { group: 'g2' }, { name: 'Hot Steel Ingot', kind: 'item' });
    s = withLinkAdded(s, { port: true }, { group: 'g2' }, { name: 'iron dust', kind: 'item' });
    expect(s.ports).toHaveLength(1);
    expect(Object.keys(s.resources).sort()).toEqual(['item:hot-steel-ingot', 'item:iron-dust']);
    expect(s.links[0].rate).toBe(2);
    expect(() => validateSiteState(s)).not.toThrow();
    // No self links, no port-to-port links, no duplicates.
    expect(withLinkAdded(s, { group: 'g1' }, { group: 'g1' }, { key: 'item:iron-dust' })).toBe(s);
    expect(withLinkAdded(s, { port: true }, { port: true }, { key: 'item:iron-dust' })).toBe(s);
    expect(withLinkAdded(s, { port: true }, { group: 'g1' }, { key: 'item:iron-dust' })).toBe(s);
  });

  it('prunes ports and resources when links or groups go away', () => {
    let s = two();
    s = withLinkAdded(s, { port: true }, { group: 'g1' }, { name: 'Iron Dust', kind: 'item' });
    s = withLinkAdded(s, { group: 'g1' }, { group: 'g2' }, { name: 'Hot Steel Ingot', kind: 'item' });
    const noFirst = withLinkRemoved(s, s.links[0].id);
    expect(noFirst.ports).toEqual([]);
    expect(Object.keys(noFirst.resources)).toEqual(['item:hot-steel-ingot']);
    const noG1 = withGroupRemoved(s, 'g1');
    expect(noG1.links).toEqual([]);
    expect(noG1.resources).toEqual({});
    expect(pruned(s)).toEqual(s);
  });

  it('moves, turns and patches groups within bounds', () => {
    let s = two();
    s = withGroupMoved(s, 'g1', 2, -1);
    expect(s.groups[0].origin).toEqual([5, 2]);
    s = withGroupRotated(withGroupRotated(withGroupRotated(withGroupRotated(s, 'g1'), 'g1'), 'g1'), 'g1');
    expect(s.groups[0].rotation).toBe(0);
    s = withGroupPatched(s, 'g1', { count: 5000, origin: [1e6, -1e6] });
    expect(s.groups[0].count).toBe(2000);
    expect(s.groups[0].origin).toEqual([512, -256]);
    s = withGroupPatched(s, 'g2', { multiblockId: 'distillation-tower' });
    s = withGroupPatched(s, 'g2', { size: 9 });
    expect(s.groups[1]).toMatchObject({ multiblockId: 'distillation-tower', size: 9 });
    expect(withGroupPatched(s, 'g2', { size: 9 })).toBe(s);
  });

  it('stores quadFluid only when off', () => {
    const s = two();
    const off = withGroupPatched(s, 'g1', { quadFluid: false });
    expect(off.groups[0].quadFluid).toBe(false);
    expect(withGroupPatched(off, 'g1', { quadFluid: false })).toBe(off);
    const on = withGroupPatched(off, 'g1', { quadFluid: true });
    expect('quadFluid' in on.groups[0]).toBe(false);
    expect(on).toEqual(s);
  });

  it('turns both ways', () => {
    let s = two();
    s = withGroupRotated(s, 'g1', -1);
    expect(s.groups[0].rotation).toBe(3);
    s = withGroupRotated(s, 'g1', 1);
    expect(s.groups[0].rotation).toBe(0);
  });

  it('duplicates a group without its links or source', () => {
    let s = two();
    s = withGroupPatched(s, 'g1', { count: 3, label: 'Titanium EBF', rotation: 2 });
    s = { ...s, groups: s.groups.map((g) => (g.id === 'g1' ? { ...g, source: { name: 'Titanium' } } : g)) };
    s = withLinkAdded(s, { port: true }, { group: 'g1' }, { name: 'Iron Dust', kind: 'item' });
    const d = withGroupDuplicated(s, 'g1', [20, 5]);
    const copy = d.groups[2];
    expect(copy).toMatchObject({
      id: 'g3',
      multiblockId: 'electric-blast-furnace',
      count: 3,
      label: 'Titanium EBF',
      rotation: 2,
      origin: [20, 5],
    });
    expect(copy.source).toBeUndefined();
    expect(d.links).toEqual(s.links);
    expect(withGroupDuplicated(s, 'nope', [0, 0])).toBe(s);
    expect(() => validateSiteState(d)).not.toThrow();
  });

  it('sets extra hatches, never IO kinds', () => {
    const s = withGroupPatched(two(), 'g1', { enabledHatches: ['maintenance', 'itemIn', 'maintenance'] });
    expect(s.groups[0].enabledHatches).toEqual(['maintenance']);
  });

  it('grows the site to fit a group past an edge, never shrinking it', () => {
    const s = two(); // 30 x 30
    expect(withGrownToFit(s, [3, 3], [10, 10], 2)).toBe(s);
    // Past the east edge: wider by what sticks out plus the margin.
    const east = withGrownToFit(s, [26, 3], [33, 10], 2);
    expect(east.size).toEqual([35, 30]);
    expect(east.groups.map((g) => g.origin)).toEqual(s.groups.map((g) => g.origin));
    // Past the north-west corner: the site grows that way and everything moves along.
    const nw = withGrownToFit(s, [-4, -1], [3, 6], 2);
    expect(nw.size).toEqual([36, 33]);
    expect(nw.groups.map((g) => g.origin)).toEqual([
      [9, 6],
      [18, 6],
    ]);
    // At most SITE_MAX_SIZE.
    expect(withGrownToFit(s, [250, 0], [300, 5], 2).size).toEqual([256, 30]);
  });

  it('keeps fixed ports on their edge when growing', () => {
    let s = two();
    s = withLinkAdded(s, { port: true }, { group: 'g1' }, { name: 'Iron Dust', kind: 'item' });
    s = { ...s, ports: s.ports.map((p) => ({ ...p, pos: [0, 12] as [number, number] })) };
    const g = withGrownToFit(s, [-3, -2], [2, 4], 1);
    expect(g.ports[0].pos).toEqual([0, 15]);
    expect(() => validateSiteState(g)).not.toThrow();
  });

  it('pins a port to a cell inside the site and gives it back to automatic placement', () => {
    let s = two();
    s = withLinkAdded(s, { port: true }, { group: 'g1' }, { name: 'Iron Dust', kind: 'item' });
    const id = s.ports[0].id;
    const pinned = withPortPlaced(s, id, [5, 7]);
    expect(pinned.ports[0].pos).toEqual([5, 7]);
    expect(withPortPlaced(pinned, id, [5, 7])).toBe(pinned);
    // Dragged past an edge it stops on the edge cell.
    const [w, d] = s.size;
    expect(withPortPlaced(s, id, [-4, 999]).ports[0].pos).toEqual([0, d - 1]);
    expect(withPortPlaced(s, id, [w + 3, 2]).ports[0].pos).toEqual([w - 1, 2]);
    const auto = withPortPlaced(pinned, id, null);
    expect('pos' in auto.ports[0]).toBe(false);
    expect(withPortPlaced(s, id, null)).toBe(s);
    expect(withPortPlaced(s, 'nope', [1, 1])).toBe(s);
    expect(() => validateSiteState(pinned)).not.toThrow();
  });

  it('clamps size and corridor, names and colours', () => {
    let s = withSiteSize(emptySite(), 2, 500);
    expect(s.size).toEqual([8, 256]);
    s = withCorridor(s, 99);
    expect(s.corridor).toBe(6);
    s = withName(s, '  Steel  ');
    expect(s.name).toBe('Steel');
    expect(withName(s, ' ').name).toBeUndefined();
    s = withLinkAdded(
      withGroupAdded(s, 'coke-oven'),
      { group: 'g1' },
      { port: true },
      { name: 'Coke', kind: 'item' },
    );
    expect(withResourceColor(s, 'item:coke', '#ABCDEF').resources['item:coke'].color).toBe('#abcdef');
    expect(withResourceColor(s, 'item:coke', 'red')).toBe(s);
  });
});

describe('group limits', () => {
  it('map the site axes onto a turned group', () => {
    expect([0, 2].map((r) => groupLimitAxis('x', r as 0 | 2))).toEqual(['x', 'x']);
    expect([1, 3].map((r) => groupLimitAxis('x', r as 1 | 3))).toEqual(['z', 'z']);
    expect(groupLimitAxis('z', 1)).toBe('x');
    expect(groupLimitAxis('y', 1)).toBe('y');
  });
});
