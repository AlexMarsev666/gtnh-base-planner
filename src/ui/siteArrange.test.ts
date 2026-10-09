import { describe, expect, it } from 'vitest';
import { arrangeOnFloors } from '../import/gtnhplanner';
import { addsLayoutViolations } from '../model/site/layoutViolations';
import { createSiteBuilder } from '../model/site/build';
import { layoutFixture } from '../model/site/layoutInvariantFixtures';
import { unitCells } from '../model/geometry';
import { arrangeHere } from './siteArrange';

const opts = { pipes: true, cables: true, below: true };
const violations = (b: ReturnType<ReturnType<typeof createSiteBuilder>>) =>
  b.warnings.filter((w) => w.type !== 'unrouted' && w.type !== 'assignment');

describe('Arrange and Optimize compare with the user original site', () => {
  for (const optimize of [false, true])
    it(`${optimize ? 'Optimize' : 'Arrange'} preserves a valid site when packing would swallow a fixed port`, () => {
      const site = layoutFixture('pyrolyse-oven', 19);
      const measured = createSiteBuilder();
      const layout = arrangeOnFloors(site, measured, true).site;
      const placed = measured(layout, opts).groups[0];
      const cell = unitCells(placed.def!, placed.units[0]).find(
        (c) => c.pos[1] === 0 && c.role === 'casing',
      )!;
      site.ports[0].pos = [cell.pos[0], cell.pos[2]];
      const builder = createSiteBuilder();
      expect(violations(builder(site, opts))).toEqual([]);
      const unsafe = arrangeOnFloors(site, builder, true).site;
      const unsafeBuild = builder(unsafe, opts);
      const port = unsafeBuild.ports.find((p) => p.port.id === site.ports[0].id);
      expect(
        port &&
          unitCells(unsafeBuild.groups[0].def!, unsafeBuild.groups[0].units[0]).some(
            (c) => c.pos.join() === port.cell.join(),
          ),
        'fixed port occupies a casing cell',
      ).toBeFalsy();
      const result = arrangeHere(site, true, builder, optimize, {
        budgetMs: 200,
        seeds: 1,
        iterations: 24,
        refineSteps: 8,
      });
      expect(violations(builder(result.site, opts))).toEqual([]);
      expect(result.site.ports).toEqual(site.ports);
      if (!optimize) {
        expect(result.site).toBe(site);
        expect(result.rejected).toBe(true);
      }
    }, 30000);
});

describe('existing violations do not permit new Arrange violations', () => {
  it('allows a deficit to decrease but rejects a new kind, controller or increased deficit', () => {
    const b = (warnings: Parameters<typeof addsLayoutViolations>[0]['warnings']) =>
      ({ warnings }) as Parameters<typeof addsLayoutViolations>[0];
    expect(
      addsLayoutViolations(
        b([{ type: 'unplaced', group: 'a', count: 3 }]),
        b([{ type: 'unplaced', group: 'a', count: 1 }]),
      ),
    ).toBe(false);
    expect(
      addsLayoutViolations(
        b([{ type: 'unplaced', group: 'a', count: 1 }]),
        b([{ type: 'unplaced', group: 'a', count: 2 }]),
      ),
    ).toBe(true);
    expect(
      addsLayoutViolations(
        b([{ type: 'unplaced', group: 'a', count: 1 }]),
        b([{ type: 'outside', group: 'a' }]),
      ),
    ).toBe(true);
    expect(
      addsLayoutViolations(
        b([{ type: 'unplaced', group: 'a', count: 1 }]),
        b([{ type: 'unplaced', group: 'b', count: 1 }]),
      ),
    ).toBe(true);
  });
  it('an invalid input with no role is retained as unresolved, with no new violations in either button', () => {
    const site = layoutFixture('oil-cracking-unit', 19);
    site.groups[0].resourceBindings = site.groups[0].resourceBindings!.filter((b) => b.role !== 'catalyst');
    const builder = createSiteBuilder();
    const baseline = builder(site, opts);
    expect(violations(baseline).length).toBeGreaterThan(0);
    for (const optimize of [false, true]) {
      const result = arrangeHere(site, true, builder, optimize, {
        budgetMs: 200,
        seeds: 1,
        iterations: 24,
        refineSteps: 8,
      });
      const after = builder(result.site, opts);
      if (!optimize) expect(addsLayoutViolations(baseline, after)).toBe(false);
      else expect(violations(after).length).toBeLessThanOrEqual(violations(baseline).length);
      expect(result.site.groups[0].resourceBindings).toEqual(site.groups[0].resourceBindings);
    }
  });
});

it('multiple locked groups on floors retain roles, local unit IDs and individual tiers', () => {
  const cases = ['pyrolyse-oven', 'electric-blast-furnace', 'distillation-tower'];
  const site = layoutFixture(cases[0], 19);
  site.size = [15, 32];
  site.groups = cases.map((id, i) => ({
    ...layoutFixture(id, 19).groups[0],
    id: `g${i}`,
    count: 4,
    limits: { x: 1, y: 1, z: 4 },
    limitsLocked: true,
    origin: [4, 4],
    rotation: 0,
    elevation: i * 30,
  }));
  site.resources = {};
  site.ports = [];
  site.links = [];
  for (const [i, id] of cases.entries()) {
    const source = layoutFixture(id, 19);
    Object.assign(site.resources, source.resources);
    site.ports.push(...source.ports.map((p) => ({ ...p, id: `g${i}_${p.id}` })));
    site.links.push(
      ...source.links.map((l) => ({
        ...l,
        id: `g${i}_${l.id}`,
        from: 'group' in l.from ? { group: `g${i}` } : { port: `g${i}_${l.from.port}` },
        to: 'group' in l.to ? { group: `g${i}` } : { port: `g${i}_${l.to.port}` },
      })),
    );
  }
  site.links.push(
    { id: 'chain0', from: { group: 'g0' }, to: { group: 'g1' }, resource: 'itemOut_common' },
    { id: 'chain1', from: { group: 'g1' }, to: { group: 'g2' }, resource: 'itemOut_common' },
  );
  const builder = createSiteBuilder();
  const before = builder(site, opts);
  expect(
    violations(before),
    JSON.stringify(before.groups.map((g) => ({ id: g.group.id, min: g.min, max: g.max }))),
  ).toEqual([]);
  for (const optimize of [false, true]) {
    const result = arrangeHere(site, true, builder, optimize, {
      budgetMs: 200,
      seeds: 1,
      iterations: 24,
      refineSteps: 8,
    });
    expect(result.floors).toBeGreaterThan(1);
    expect(violations(builder(result.site, opts))).toEqual([]);
    for (const [i, group] of result.site.groups.entries()) {
      expect(group.resourceBindings).toEqual(site.groups[i].resourceBindings);
      expect(group.hatchTiers).toEqual(site.groups[i].hatchTiers);
      expect(group.voltageTier).toEqual(site.groups[i].voltageTier);
      expect(group.limits).toEqual(site.groups[i].limits);
    }
  }
}, 30000);
