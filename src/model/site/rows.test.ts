import { describe, expect, it } from 'vitest';
import { arrangeSite } from './arrange';
import { annealGroups, type Shape } from './anneal';
import { emptySite } from '../../share/siteCodec';
import type { SiteGroup } from './types';

function fixture() {
  const site = emptySite();
  site.size = [50, 30];
  site.corridor = 2;
  site.groups = ['a', 'b', 'c', 'd'].map((id): SiteGroup => ({
    id,
    multiblockId: 'electric-blast-furnace',
    count: 1,
    origin: [0, 0],
    rotation: 0,
    limits: { x: 1, y: 1, z: 1 },
    enabledHatches: [],
  }));
  site.links = [
    { id: 'ab', from: { group: 'a' }, to: { group: 'b' }, resource: 'r' },
    { id: 'cd', from: { group: 'c' }, to: { group: 'd' }, resource: 'r' },
  ];
  site.resources.r = { kind: 'fluid', name: 'r', color: '#888888' };
  return site;
}

describe('stage 5: common row bands and corridors', () => {
  const sizes: Record<string, [number, number]> = { a: [3, 3], b: [8, 8], c: [5, 5], d: [4, 4] };
  it('aligns mixed footprints across flow columns and reserves the tallest row plus corridor', () => {
    const site = fixture();
    const result = arrangeSite(site, (id) => sizes[id]);
    const [a, b, c, d] = result.groups;
    expect(result.fits).toBe(true);
    expect(a.origin[1]).toBe(b.origin[1]);
    expect(c.origin[1]).toBe(d.origin[1]);
    expect(a.origin[0]).toBe(c.origin[0]);
    expect(b.origin[0]).toBe(d.origin[0]);
    expect(c.origin[1] - a.origin[1]).toBe(8 + site.corridor);
  });

  it('splits oversized columns into aligned bands without losing corridor clearance', () => {
    const site = { ...fixture(), size: [50, 13] as [number, number] };
    const result = arrangeSite(site, (id) => sizes[id]);
    expect(result.fits).toBe(true);
    expect(new Set(result.groups.map((g) => g.origin[1])).size).toBe(1);
    const sorted = [...result.groups].sort((a, b) => a.origin[0] - b.origin[0]);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const width = sizes[prev.id][prev.rotation % 2 ? 1 : 0];
      expect(sorted[i].origin[0] - prev.origin[0] - width).toBeGreaterThanOrEqual(site.corridor);
    }
  });

  it('annealing can leave the readable rows while retaining geometry clearance', () => {
    const site = fixture();
    site.groups = arrangeSite(site, () => [3, 3]).groups;
    const home = new Map(site.groups.map((g) => [g.id, g.origin[1]]));
    const shapes = new Map<string, Shape[]>(
      site.groups.map((g) => [
        g.id,
        [
          { limits: g.limits, size: [3, 3], height: 3 },
          { limits: { x: 1, y: 2, z: 1 }, size: [1, 20], height: 6 },
        ],
      ]),
    );
    let checked = 0;
    let leftRows = false;
    for (let seed = 1; seed <= 8; seed++) {
      const result = annealGroups(site, () => [3, 3], {
        seed,
        iterations: 250,
        shapes,
        evaluate: (groups) => {
          checked++;
          for (const g of groups) {
            if (g.origin[1] !== home.get(g.id)) leftRows = true;
            const shape = shapes.get(g.id)!.find((s) => s.limits.y === g.limits.y)!;
            const width = shape.size[g.rotation % 2 ? 1 : 0];
            const depth = shape.size[g.rotation % 2 ? 0 : 1];
            expect(g.origin[0] + width).toBeLessThanOrEqual(47);
            expect(g.origin[1] + depth).toBeLessThanOrEqual(28);
            for (const other of groups.filter((o) => o.id !== g.id)) {
              const os = shapes.get(other.id)!.find((s) => s.limits.y === other.limits.y)!;
              expect(
                g.origin[0] + width + 2 <= other.origin[0] ||
                  other.origin[0] + os.size[other.rotation % 2 ? 1 : 0] + 2 <= g.origin[0] ||
                  g.origin[1] + depth + 2 <= other.origin[1] ||
                  other.origin[1] + os.size[other.rotation % 2 ? 0 : 1] + 2 <= g.origin[1],
              ).toBe(true);
            }
          }
          return groups.reduce((sum, g) => sum + g.origin[0], 0);
        },
      });
      expect(result.after).toBeLessThanOrEqual(result.before);
    }
    expect(checked).toBeGreaterThan(100);
    expect(leftRows).toBe(true);
  });
});
