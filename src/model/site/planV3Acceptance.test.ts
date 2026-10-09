import { describe, expect, it } from 'vitest';
import { unitCells } from '../geometry';
import { minimumCasings } from '../multiblock/rules';
import { createSiteBuilder } from './build';
import { validateResourceHatches } from './resourcePlacement';
import type { SiteGroup, SiteState } from './types';
import {
  cracker,
  feeds,
  agents,
  inputs,
  products,
  resources,
  enumerateCrackingCapacity,
  routeCrackingWitness,
} from './fixtures/crackingCapacity';

// Explicit user inputs and roles, with one ordinary hatch per fluid. No recipe lookup.
function crackingSite(count: number, extraProduct = false): SiteState {
  const outputs = extraProduct ? [...products, 'product-5'] : products;
  const allResources = [...inputs, ...outputs];
  const group: SiteGroup = {
    id: 'crackers',
    multiblockId: cracker.id,
    count,
    limits: { x: null, y: null, z: null },
    enabledHatches: ['energy', 'maintenance', 'fluidIn', 'fluidOut'],
    origin: [8, 8],
    rotation: 0,
    voltageTier: 'HV',
    crackingFeedSide: 'right',
    resourceBindings: [
      ...feeds.map((resource) => ({ kind: 'fluidIn' as const, resource, role: 'feed' as const })),
      ...agents.map((resource) => ({ kind: 'fluidIn' as const, resource, role: 'catalyst' as const })),
    ],
  };
  return {
    v: 2,
    kind: 'site',
    size: [40, 30],
    corridor: 2,
    groups: [group],
    resources: Object.fromEntries(
      allResources.map((resource) => [
        resource,
        { kind: 'fluid' as const, name: resource, color: '#123456' },
      ]),
    ),
    colors: {},
    routing: { mode: 'neat', depth: 3 },
    ports: allResources.map((resource, i) => ({
      id: `port-${resource}`,
      resource,
      dir: inputs.includes(resource) ? ('in' as const) : ('out' as const),
      pos: [inputs.includes(resource) ? 0 : 39, 2 + i * 2],
    })),
    links: allResources.map((resource) => ({
      id: `link-${resource}`,
      resource,
      from: inputs.includes(resource) ? { port: `port-${resource}` } : { group: group.id },
      to: inputs.includes(resource) ? { group: group.id } : { port: `port-${resource}` },
    })),
  };
}

describe('PLAN revision 3, stage 0 acceptance (intentionally failing until stages 1–3)', () => {
  it('C1: explains the 12 versus 7 hatch deficit and retains energy and maintenance first', () => {
    // Expected capacity comes from the catalogue geometry and its casing rule, not the placer.
    const cells = unitCells(cracker, { id: 0, origin: [0, 0, 0], rotation: 0 });
    const hatchable = cells.filter((cell) => cell.role === 'casing' && cell.hatches?.length).length;
    expect(hatchable).toBe(25);
    expect(minimumCasings(cracker)).toBe(18);
    expect(hatchable - minimumCasings(cracker)!).toBe(7);
    expect(resources.length + 2).toBe(12);

    const build = createSiteBuilder()(crackingSite(1), { pipes: true, cables: true });
    const placed = build.groups[0];
    expect(placed.units).toHaveLength(1);
    expect.soft(placed.hatches.filter((hatch) => hatch.kind === 'energy')).toHaveLength(1);
    expect.soft(placed.hatches.filter((hatch) => hatch.kind === 'maintenance')).toHaveLength(1);
    const messages = build.warnings.flatMap((warning) => (warning.type === 'error' ? [warning.message] : []));
    // Required message: 12 hatches needed, capacity 7 (25 casing cells, at least 18 retained).
    // Wording/localisation is free; the four quantities must be explained together.
    expect
      .soft(messages, 'C1 must explain needed hatches and structure capacity')
      .toEqual(expect.arrayContaining([expect.stringMatching(/\b12\b[^\n]*\b7\b[^\n]*\b25\b[^\n]*\b18\b/)]));
  });

  it('C2: distributes the same fluids over two wallsharing crackers and passes post-routing validation', () => {
    const site = crackingSite(2);
    const build = createSiteBuilder()(site, { pipes: true, cables: true });
    const placed = build.groups[0];
    expect(placed.units).toHaveLength(2);
    expect.soft(placed.build!.unplaced).toEqual([]);
    expect.soft(placed.build!.missing).toEqual([]);
    const covered = [...new Set(placed.hatches.flatMap((hatch) => (hatch.resource ? [hatch.resource] : [])))];
    expect.soft(covered.sort()).toEqual([...resources].sort());
    for (const unit of placed.units) {
      expect
        .soft(placed.hatches.filter((h) => h.kind === 'fluidIn' && h.unitIds.includes(unit.id)))
        .toHaveLength(3);
      expect
        .soft(placed.hatches.filter((h) => h.kind === 'fluidOut' && h.unitIds.includes(unit.id)))
        .toHaveLength(2);
      expect.soft(placed.hatches.filter((h) => h.unitIds.includes(unit.id))).toHaveLength(7);
      for (const kind of ['energy', 'maintenance'] as const) {
        const hatches = placed.hatches.filter(
          (hatch) => hatch.kind === kind && hatch.unitIds.includes(unit.id),
        );
        expect.soft(hatches, `C2 controller ${unit.id}: mandatory ${kind}`).toHaveLength(1);
        expect.soft(hatches.every((hatch) => hatch.unitIds.length === 1)).toBe(true);
      }
    }
    // Use the same independent checker as createSiteBuilder, on the final faces after routing.
    expect.soft(validateResourceHatches(placed.def!, placed.units, placed.hatches, placed.group)).toEqual([]);
    expect.soft(build.warnings).toEqual([]);
    expect.soft(build.stats.connected).toBe(build.stats.terminals);
    // The layout is feasible; the current per-controller resource model still cannot find it.
  }, 20_000);

  it('C2b: reports 15 required hatches versus capacity 14 for eleven fluids on two crackers', () => {
    const build = createSiteBuilder()(crackingSite(2, true), { pipes: true, cables: true });
    const messages = build.warnings.flatMap((w) => (w.type === 'error' ? [w.message] : []));
    expect.soft(messages).toEqual(expect.arrayContaining([expect.stringMatching(/\b15\b[^\n]*\b14\b/)]));
    for (const unit of build.groups[0].units)
      for (const kind of ['energy', 'maintenance'] as const)
        expect
          .soft(build.groups[0].hatches.filter((h) => h.kind === kind && h.unitIds.includes(unit.id)))
          .toHaveLength(1);
  }, 20_000);

  it('C2c: chooses a valid layout no more costly than independently enumerated routable witnesses', () => {
    const site = crackingSite(2);
    const references = enumerateCrackingCapacity()
      .witnesses.map((witness) => ({ witness, routed: routeCrackingWitness(site, witness) }))
      .filter((r) => r.routed.warnings.length === 0);
    expect(references.length).toBeGreaterThan(1);
    references.sort(
      (a, b) => a.witness.blocks - b.witness.blocks || a.routed.pipeBlocks - b.routed.pipeBlocks,
    );
    const best = references[0];
    console.info(
      'C2 routed witnesses:',
      JSON.stringify({
        routable: references.length,
        best: {
          axis: best.witness.axis,
          pitch: best.witness.pitch,
          rotation: best.witness.units[1].rotation,
          blocks: best.witness.blocks,
          pipes: best.routed.pipeBlocks,
        },
        examples: references
          .filter(
            (r) =>
              ((r.witness.axis === 1 && r.witness.pitch === 2) ||
                (r.witness.axis === 0 && r.witness.pitch === 6)) &&
              r.witness.units[1].rotation === 0,
          )
          .map((r) => ({
            axis: r.witness.axis,
            pitch: r.witness.pitch,
            blocks: r.witness.blocks,
            pipes: r.routed.pipeBlocks,
          })),
      }),
    );
    const build = createSiteBuilder()(site, { pipes: true, cables: true });
    expect(build.warnings).toEqual([]);
    const blocks = build.groups[0].build!.stats.totalBlocks;
    expect(blocks).toBeLessThanOrEqual(best.witness.blocks);
    if (blocks === best.witness.blocks)
      expect(build.stats.pipeBlocks).toBeLessThanOrEqual(best.routed.pipeBlocks);
  }, 20_000);
});
