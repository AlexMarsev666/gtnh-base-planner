import { describe, expect, it } from 'vitest';
import { catalog } from '../../data/catalog';
import { arrangeHere } from '../../ui/siteArrange';
import { createSiteBuilder } from './build';
import type { SiteBuild } from './buildTypes';
import { hasLayeredFluidOutputs, isOilCracker } from '../multiblock/structureAdapters';
import { validateAlternativeCounts } from '../multiblock/rules';
import { analyzeOccupancy } from './occupancy';
import { validateHatchAccess } from './hatchAccess';
import { validateResourceHatches } from './resourcePlacement';
import { optimizeSite } from './optimize';
import type { SiteState } from './types';
import {
  layoutFixture,
  PROPERTY_MACHINES,
  PROPERTY_SEEDS,
  ROLE_MACHINES,
  TYPICAL_MACHINES,
} from './layoutInvariantFixtures';

const options = { pipes: true, cables: true };
const violationTotal = (warnings: ReturnType<typeof independent>) =>
  warnings.reduce(
    (sum, w) =>
      sum +
      (w.type === 'unplaced'
        ? w.count
        : w.type === 'missing'
          ? w.units
          : w.type === 'fewer'
            ? w.requested - w.placed
            : 1),
    0,
  );

const optimize = { seeds: 1, iterations: 24, refineSteps: 8, refineRuns: 1, budgetMs: 200, reshape: true };

/** Re-run the actual post-routing validators on the final geometry, independent of score/placement. */
function independent(site: SiteState, build: SiteBuild) {
  const occupancy = analyzeOccupancy(site, build.groups);
  const access = validateHatchAccess(
    build.groups,
    occupancy,
    new Set(occupancy.keepFree.map((p) => p.join())),
    build.ports,
  );
  const structural = build.groups.flatMap((g) =>
    g.def
      ? [
          ...validateResourceHatches(g.def, g.units, g.hatches, g.group, g.demand),
          ...validateAlternativeCounts(g.def, g.units, g.hatches),
        ].map((message) => ({ type: 'error', group: g.group.id, code: 'structure', message }))
      : [],
  );
  for (const warning of [...access, ...structural]) expect(build.warnings).toContainEqual(warning);
  // Ports must not replace any structure/required-air cell, even if routing reports success.
  for (const port of build.ports)
    expect(occupancy.occ.has(port.cell.join()), `port ${port.port.id} inside structure`).toBe(false);
  expect(new Set(build.ports.map((p) => p.cell.join())).size).toBe(build.ports.length);
  return build.warnings.filter((w) => w.type !== 'assignment' && w.type !== 'unrouted');
}

function assignments(site: SiteState) {
  return site.groups.map(({ id, resourceBindings, voltageTier, hatchTiers, structureGlassTier }) => ({
    id,
    resourceBindings,
    voltageTier,
    hatchTiers,
    structureGlassTier,
  }));
}

// Position-bearing errors are compared by their semantic kind, retaining multiplicity and group.
function key(w: ReturnType<typeof independent>[number]) {
  return JSON.stringify(w).replace(/(\bat \(?|\bcell )-?\d+(?:, ?-?\d+){2}/g, '$1<cell>');
}

function noNew(before: ReturnType<typeof independent>, after: ReturnType<typeof independent>) {
  const counts = new Map<string, number>();
  before.forEach((w) => counts.set(key(w), (counts.get(key(w)) ?? 0) + 1));
  for (const w of after) {
    expect(counts.get(key(w)) ?? 0, `new violation: ${JSON.stringify(w)}`).toBeGreaterThan(0);
    counts.set(key(w), counts.get(key(w))! - 1);
  }
}

describe('bounded layout properties (fixed machines and seeds)', () => {
  it('covers all existing role adapters plus exactly 20 distinct typical machines', () => {
    const adapted = catalog
      .filter(
        (d) =>
          d.resourceHatchRegions ||
          isOilCracker(d) ||
          hasLayeredFluidOutputs(d) ||
          d.lockedFluidInputs ||
          d.lockedItemInputs ||
          d.fixedFluidOutputs,
      )
      .map((d) => d.id)
      .sort();
    expect(adapted).toEqual([...ROLE_MACHINES].sort());
    expect(TYPICAL_MACHINES).toHaveLength(20);
    expect(new Set(PROPERTY_MACHINES).size).toBe(PROPERTY_MACHINES.length);
  });
  for (const id of PROPERTY_MACHINES)
    for (const seed of PROPERTY_SEEDS)
      it(`${id}, seed ${seed}: arrange adds no violations, optimise never worsens them, assignments survive`, () => {
        const site = layoutFixture(id, seed);
        const frozen = structuredClone(site);
        const builder = createSiteBuilder();
        const below = true;
        const build = (s: SiteState) => builder(s, { ...options, below });
        const baselineBuild = build(site);
        const baseline = independent(site, baselineBuild);
        expect(baseline, 'valid input fixture').toEqual([]);
        const arranged = arrangeHere(site, below, builder).site;
        const arrangedBuild = build(arranged);
        const arrangedViolations = independent(arranged, arrangedBuild);
        noNew(baseline, arrangedViolations);
        const tuned = optimizeSite(arranged, builder, { ...optimize, below }).site;
        const tunedBuild = build(tuned);
        const tunedViolations = independent(tuned, tunedBuild);
        expect(tunedViolations.length).toBeLessThanOrEqual(baseline.length);
        expect(violationTotal(tunedViolations)).toBeLessThanOrEqual(violationTotal(baseline));
        expect(assignments(arranged)).toEqual(assignments(site));
        expect(assignments(tuned)).toEqual(assignments(site));
        for (const finalBuild of [baselineBuild, arrangedBuild, tunedBuild])
          for (const group of finalBuild.groups)
            for (const [key, tier] of Object.entries(group.group.hatchTiers ?? {}))
              expect(
                group.hatches.some((h) => h.assignments?.includes(key) && h.tier === tier),
                `individual tier ${key}`,
              ).toBe(true);
        expect(site).toEqual(frozen);
      }, 120000);
});

describe('ambiguous roles remain errors without guessing recipes', () => {
  for (const id of ROLE_MACHINES)
    it(`${id}: missing manual role remains unresolved after Arrange and Optimize`, () => {
      const site = layoutFixture(id, 19);
      const adapted = catalog.find((d) => d.id === id)!;
      const chosen = site.groups[0].resourceBindings!.find(
        (b) =>
          adapted.resourceHatchRegions?.[b.kind] ||
          (isOilCracker(adapted) && b.kind === 'fluidIn') ||
          (hasLayeredFluidOutputs(adapted) && b.kind === 'fluidOut') ||
          adapted.lockedFluidInputs?.[b.kind] ||
          adapted.lockedItemInputs?.[b.kind] ||
          adapted.fixedFluidOutputs?.[b.kind],
      )!;
      const resource = chosen.resource;
      site.groups[0].resourceBindings = site.groups[0].resourceBindings!.filter((b) => b !== chosen);
      delete site.resources[resource].gameId;
      // Names and list positions are deliberately misleading; neither supplies a manual structural role.
      site.resources[resource].name = 'Hydrogen Steam Feed Product';
      const frozen = structuredClone(site);
      const builder = createSiteBuilder();
      const build = (s: SiteState) => builder(s, { ...options, below: true });
      const baseline = independent(site, build(site));
      expect(
        baseline.some((w) =>
          'resource' in w ? w.resource === resource : w.type === 'error' && w.message.includes(resource),
        ),
      ).toBe(true);
      const arranged = arrangeHere(site, true, builder).site;
      noNew(baseline, independent(arranged, build(arranged)));
      const tuned = optimizeSite(arranged, builder, { ...optimize, below: true }).site;
      const after = independent(tuned, build(tuned));
      expect(after.length).toBeLessThanOrEqual(baseline.length);
      expect(violationTotal(after)).toBeLessThanOrEqual(violationTotal(baseline));
      expect(
        after.some((w) =>
          'resource' in w ? w.resource === resource : w.type === 'error' && w.message.includes(resource),
        ),
      ).toBe(true);
      expect(assignments(arranged)).toEqual(assignments(site));
      expect(assignments(tuned)).toEqual(assignments(site));
      expect(site).toEqual(frozen);
    }, 120000);
});
