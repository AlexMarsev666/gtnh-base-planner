import { describe, expect, it } from 'vitest';
import reference from '../../../docs/fixtures/reference-01-oil-refinery.json';
import sharedOverload from '../../../docs/fixtures/user-shared-cracker-overload.json';
import corrected from '../../../docs/fixtures/gtnh-site-site (3)-corrected.json';
import { siteFromJson } from '../../share/siteCodec';
import { createSiteBuilder } from './build';
import { validateResourceHatches } from './resourcePlacement';

export function refinerySite(fixed = false) {
  const site = siteFromJson(JSON.stringify(reference));
  if (fixed)
    for (const b of site.groups.find((g) => g.id === 'g9')!.resourceBindings!)
      if (['fluid:resource', 'fluid:light-steam-cracked-napthta'].includes(b.resource)) b.unitId = 1;
  return site;
}

describe('user reference refinery, g9 manual assignments', () => {
  it('routes the approved separate-catalyst copy without warnings and preserves all other data', () => {
    const site = siteFromJson(JSON.stringify(corrected));
    const group = site.groups.find((g) => g.id === 'g9')!;
    expect(group.resourceBindings).toHaveLength(10);
    expect(group.resourceBindings!.every((b) => b.unitId !== undefined && !b.unitIds)).toBe(true);
    const restored = JSON.parse(JSON.stringify(corrected)) as typeof sharedOverload;
    restored.groups.find((g) => g.id === 'g9')!.resourceBindings = structuredClone(
      sharedOverload.groups.find((g) => g.id === 'g9')!.resourceBindings,
    );
    expect(restored).toEqual(sharedOverload);
    const built = createSiteBuilder()(site, { pipes: true, cables: true, below: true });
    expect(built.warnings).toEqual([]);
    expect(built.stats.connected).toBe(built.stats.terminals);
    const placed = built.groups.find((g) => g.group.id === 'g9')!;
    for (const binding of group.resourceBindings!) {
      const unit = placed.units[binding.unitId!];
      expect(placed.hatches.filter((h) => h.resource === binding.resource)).toEqual([
        expect.objectContaining({ unitIds: [unit.id] }),
      ]);
    }
  }, 20000);

  it('explains machine 1 overload once, with all four quantities', () => {
    const built = createSiteBuilder()(refinerySite(), { pipes: true, cables: true, below: true });
    const warnings = built.warnings.filter((w) => 'group' in w && w.group === 'g9');
    expect(built.warnings).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      type: 'error',
      code: 'structure',
      message: 'Machine 1: assigned 7 fluids, mandatory hatches 2, capacity 7; remove 2 assignments.',
    });
    const group = built.groups.find((g) => g.group.id === 'g9')!;
    for (const unit of group.units)
      for (const kind of ['energy', 'maintenance'])
        expect(
          group.hatches.filter((h) => h.kind === kind && h.unitIds.includes(unit.id)),
          JSON.stringify({
            kind,
            unit: unit.id,
            hatches: group.hatches.map((h) => [h.kind, h.unitIds]),
            unplaced: group.build?.unplaced,
          }),
        ).toHaveLength(1);
    const broken = group.hatches.map((h, i) =>
      i === 0 ? { ...h, cell: [0, 100, 0] as [number, number, number] } : h,
    );
    expect(
      validateResourceHatches(group.def!, group.units, broken, group.group, group.demand).some((message) =>
        message.includes('is not allowed'),
      ),
    ).toBe(true);
  }, 20000);

  it('has no g9 warnings when naphtha and its cracked output serve machine 2', () => {
    const built = createSiteBuilder()(refinerySite(true), { pipes: true, cables: true, below: true });
    expect(built.warnings.filter((w) => 'group' in w && w.group === 'g9')).toEqual([]);
  }, 20000);

  it('reports one group overload for auto resources while keeping both catalysts in separate shared hatches', () => {
    const site = siteFromJson(JSON.stringify(sharedOverload));
    const before = JSON.stringify(site);
    const built = createSiteBuilder()(site, { pipes: true, cables: true, below: true });
    expect(JSON.stringify(site)).toBe(before);
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toMatchObject({
      type: 'error',
      group: 'g9',
      code: 'structure',
      message: expect.stringMatching(/16.*14/),
    });
    const group = built.groups.find((g) => g.group.id === 'g9')!;
    for (const resource of ['fluid:hydrogen', 'fluid:steam'])
      expect(group.hatches.filter((h) => h.resource === resource)).toEqual([
        expect.objectContaining({ unitIds: group.units.map((u) => u.id) }),
      ]);
    for (const unit of group.units)
      for (const kind of ['energy', 'maintenance'])
        expect(group.hatches.some((h) => h.kind === kind && h.unitIds.includes(unit.id))).toBe(true);
    const broken = group.hatches.map((h, i) =>
      i === 0 ? { ...h, cell: [0, 100, 0] as [number, number, number] } : h,
    );
    expect(
      validateResourceHatches(group.def!, group.units, broken, group.group, group.demand).some((message) =>
        message.includes('is not allowed'),
      ),
    ).toBe(true);
  }, 20000);

  it('routes the user plan at depth 3 on multiple layers while keeping pipes and cables apart', () => {
    const site = siteFromJson(JSON.stringify(sharedOverload));
    site.routing = { mode: 'neat', depth: 3 };
    const before = JSON.stringify(site);
    const built = createSiteBuilder()(site, { pipes: true, cables: true, below: true });
    expect(JSON.stringify(site)).toBe(before);
    expect(built.stats.connected).toBe(built.stats.terminals);
    const owners = new Map<string, number>();
    const layers = new Set<number>();
    for (const net of built.nets)
      for (const cell of net.route!.paths.flat()) {
        const key = cell.join(',');
        expect(owners.get(key) ?? net.id).toBe(net.id);
        owners.set(key, net.id);
        layers.add(cell[1]);
        expect(cell[1]).toBeGreaterThanOrEqual(-3);
      }
    expect(layers.has(-1)).toBe(true);
    expect(layers.has(-2)).toBe(true);
    expect([...layers].some((y) => y >= 0)).toBe(true);
    expect(built.warnings).toHaveLength(1);
    expect(built.warnings[0]).toMatchObject({ group: 'g9', message: expect.stringMatching(/16.*14/) });
  }, 20000);
});
