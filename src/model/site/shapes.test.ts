import { describe, expect, it } from 'vitest';
import { createSiteBuilder } from './build';
import { groupShapes } from './shapes';
import type { SiteGroup, SiteState } from './types';

function group(id: string, multiblockId: string, count: number): SiteGroup {
  return {
    id,
    multiblockId,
    count,
    limits: { x: null, y: 1, z: null },
    enabledHatches: [],
    origin: [4, 4],
    rotation: 0,
  };
}

const site = (groups: SiteGroup[]): SiteState => ({
  v: 1,
  kind: 'site',
  size: [60, 60],
  corridor: 2,
  groups,
  links: [],
  ports: [],
  resources: {},
  colors: {},
});

describe('groupShapes', () => {
  it('offers other packings of a group of several units, each with a measured footprint', () => {
    const s = site([group('a', 'electric-blast-furnace', 6)]);
    const shapes = groupShapes(s, createSiteBuilder(), false).get('a')!;
    expect(shapes.length).toBeGreaterThan(2);
    // The group's own packing is first, and every shape is a different footprint or height.
    expect(shapes[0].limits).toEqual(s.groups[0].limits);
    const keys = shapes.map((sh) => `${sh.size}/${sh.height}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const sh of shapes) {
      expect(sh.size[0]).toBeGreaterThan(0);
      expect(sh.size[1]).toBeGreaterThan(0);
    }
    // Some shape is taller and some is flatter than the start.
    expect(shapes.some((sh) => sh.height > shapes[0].height)).toBe(true);
    expect(shapes.some((sh) => sh.size[0] * sh.size[1] < shapes[0].size[0] * shapes[0].size[1])).toBe(true);
  });

  it('gives no shapes to a group whose limits are locked', () => {
    const locked = { ...group('a', 'electric-blast-furnace', 6), limitsLocked: true };
    const s = site([locked, group('b', 'electric-blast-furnace', 6)]);
    const shapes = groupShapes(s, createSiteBuilder(), false);
    expect(shapes.has('a')).toBe(false);
    expect(shapes.has('b')).toBe(true);
  });

  it('measures the smallest groups first and stops when the budget is used up', () => {
    const s = site([group('big', 'electric-blast-furnace', 8), group('small', 'electric-blast-furnace', 2)]);
    // No time at all: nothing is measured.
    expect(groupShapes(s, createSiteBuilder(), false, { budgetMs: 0 }).size).toBe(0);
    // Charge work rather than reading the clock. Each individual assessment has its own deadline check.
    let t = 0;
    const build = createSiteBuilder();
    const shapes = groupShapes(
      s,
      (site, opts) => {
        t += 40;
        return build(site, opts);
      },
      false,
      { budgetMs: 100, now: () => t },
    );
    expect(shapes.has('small')).toBe(true);
    expect(shapes.has('big')).toBe(false);
    expect(t).toBeLessThanOrEqual(140);
    // With no limit both are measured.
    expect([...groupShapes(s, createSiteBuilder(), false).keys()].sort()).toEqual(['big', 'small']);
  });

  it('leaves single units and single-block machines alone', () => {
    const s = site([group('a', 'electric-blast-furnace', 1)]);
    expect(groupShapes(s, createSiteBuilder(), false).size).toBe(0);
  });

  it('uses the global absolute deadline instead of granting measurement a fresh budget', () => {
    const s = site([group('a', 'electric-blast-furnace', 6)]);
    const build = createSiteBuilder();
    const baseline = build(s, { pipes: false, cables: false });
    let t = 1000;
    let calls = 0;
    groupShapes(
      s,
      (trial, options) => {
        calls++;
        t += 400;
        return build(trial, options);
      },
      false,
      { baseline, budgetMs: 10000, deadline: 1300, now: () => t },
    );
    expect(calls).toBe(1);
    expect(t).toBe(1400);
  });

  it('every offered shape builds with the units it claims, at the footprint it claims', () => {
    const s = site([group('a', 'large-chemical-reactor', 4)]);
    const build = createSiteBuilder();
    const shapes = groupShapes(s, build, false).get('a')!;
    for (const sh of shapes) {
      const pg = build(
        { ...s, groups: [{ ...s.groups[0], limits: sh.limits }] },
        { pipes: false, cables: false },
      ).groups[0];
      expect(pg.build!.pack.placed).toBe(4);
      expect([pg.build!.size[0], pg.build!.size[2], pg.build!.size[1]]).toEqual([
        sh.size[0],
        sh.size[1],
        sh.height,
      ]);
    }
  });
});
