import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { controllerFacing, rotateLocal, unitCells, unitDir } from '../geometry';
import { findSites } from '../hatches/sites';
import { layoutCandidates, packUnits } from '../layout/packer';
import { defCache } from '../layout/cache';
import { pairOk } from '../layout/shapes';
import { matchesWallsharing } from '../layout/wallsharing';
import { hatchCapacity, validateCasings } from '../multiblock/casingConstraints';
import type { Unit, WallsharingVariant } from '../multiblock/types';
import { buildGroup, placeUnit } from './group';
import { validateResourceHatches } from './resourcePlacement';
import { createHash } from 'node:crypto';
import evidence from '../../../tools/game-dump/cracker-wallsharing.result.json';
import lock from '../../../tools/game-dump/rc2-source-lock.json';
import { crackerWallsharingCase } from './fixtures/mirroredCrackers';
import { createSiteBuilder } from './build';
import { arrangeHere } from '../../ui/siteArrange';
import { optimizeSite } from './optimize';
import { withGroupAdded, withGroupDuplicated, withGroupPatched } from '../../ui/siteActions';
import { emptySite } from '../../share/siteCodec';

const def = getMultiblock('oil-cracking-unit')!;
const limits = { x: 2, y: 1, z: 1 };
const demand = { fluidIn: ['feed', 'agent'], fluidOut: ['product'] };
const settings = {
  voltageTier: 'HV' as const,
  resourceBindings: [
    { kind: 'fluidIn' as const, resource: 'feed', role: 'feed' as const },
    { kind: 'fluidIn' as const, resource: 'agent', role: 'catalyst' as const },
  ],
};
const pair = (mirrored = true): Unit[] => [
  { id: 0, origin: [0, 0, 0], rotation: 0 },
  { id: 1, origin: [4, 0, 0], rotation: 0, mirrored },
];

describe('per-machine mirror and wallsharing', () => {
  it('matches the successful native pair, both loaded pinned jars, two casing minima and the same side input in both controllers', () => {
    const test = crackerWallsharingCase();
    const hash = createHash('sha256')
      .update(JSON.stringify({ circuit: test.circuit, cells: test.cells, crackingPair: test.crackingPair }))
      .digest('hex');
    expect(evidence.pack).toBe(lock.pack);
    expect(evidence.sourceCommit).toBe(lock['GT5-Unofficial'].commit);
    expect(evidence.loadedJars.map((jar) => jar.sha256)).toEqual([
      lock['GT5-Unofficial'].devJarSha256,
      lock.StructureLib.devJarSha256,
    ]);
    expect(evidence.failed).toBe(0);
    expect(evidence.passed).toBe(1);
    expect(evidence.results).toHaveLength(1);
    expect(evidence.results[0].placementSha256).toBe(hash);
    expect(evidence.results[0].controllers).toEqual([
      { formed: true, casings: 20, sharedInput: true, errors: [] },
      { formed: true, casings: 20, sharedInput: true, errors: [] },
    ]);
  });
  it.each([0, 1, 2, 3] as const)(
    'reflects local X before rotation %i, including directions and controller',
    (rotation) => {
      const unit: Unit = { id: 1, origin: [10, 2, 20], rotation, mirrored: true };
      const input = unitCells(def, unit).find((c) => c.local.join() === '4,0,0')!;
      const offset = rotateLocal(def, [0, 0, 0], rotation);
      expect(input.pos).toEqual([10 + offset[0], 2, 20 + offset[2]]);
      expect(input.hatches).toContain('fluidIn');
      expect(unitDir('east', unit)).toBe(['west', 'north', 'east', 'south'][rotation]);
      expect(controllerFacing(def, unit)).toBe(['north', 'east', 'south', 'west'][rotation]);
      const placed = placeUnit(def, unit, [30, 5, 30], 1, [3, 4]);
      expect(placed.mirrored).toBe(true);
      expect(placed.rotation).toBe((rotation + 1) % 4);
    },
  );

  it('allows a same-role side hatch only when the neighbouring sides are compatible', () => {
    const mirrored = findSites(def, pair(), true).sites.filter((s) => s.unitIds.length === 2);
    expect(
      mirrored.some((s) => s.kinds.has('fluidIn') && [...s.regions.values()].every((r) => r === 'side')),
    ).toBe(true);
    const normal = findSites(def, pair(false), true).sites.filter((s) => s.unitIds.length === 2);
    expect(normal.every((s) => !s.kinds.has('fluidIn') && !s.kinds.has('fluidOut'))).toBe(true);
    expect(pairOk(def, defCache(def), 0, 4, [4, 0, 0])).toBe(true);
    expect(pairOk(def, defCache(def), 0, 4, [1, 0, 0])).toBe(false);
  });

  it.each(['oil-cracking-unit', 'mega-oil-cracker'])(
    '%s keeps its physical shape under reflection while exchanging side roles',
    (id) => {
      const cracker = getMultiblock(id)!;
      for (const rotation of [0, 1, 2, 3] as const) {
        const unit: Unit = { id: 0, origin: [0, 0, 0], rotation };
        const shape = (mirrored: boolean) =>
          unitCells(cracker, { ...unit, mirrored })
            .map((c) => JSON.stringify([c.pos, c.role, c.blockId, c.facing]))
            .sort();
        expect(shape(true)).toEqual(shape(false));
      }
    },
  );

  it('independently charges a shared side hatch to both casing minima even if its claimed owners are missing', () => {
    const units = pair();
    const sites = findSites(def, units, true).sites;
    const shared = sites.find((s) => s.unitIds.length === 2 && s.kinds.has('fluidIn'))!;
    const hatches = units.flatMap((unit) =>
      sites
        .filter((s) => s.unitIds.length === 1 && s.unitIds[0] === unit.id)
        .slice(0, 7)
        .map((s) => ({ kind: 'energy' as const, cell: s.pos, face: s.faces[0].dir, unitIds: [unit.id] })),
    );
    expect(validateCasings(def, units, hatches)).toEqual([]);
    hatches.push({ kind: 'energy', cell: shared.pos, face: shared.faces[0].dir, unitIds: [0] });
    const problems = validateCasings(def, units, hatches);
    for (const unit of units)
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`Controller ${unit.id}: 17 casings; RC2 requires at least 18`),
        ]),
      );
  });

  it('shares feed in the side wall while retaining private energy, maintenance and per-machine minima', () => {
    const built = buildGroup(
      def,
      2,
      limits,
      def.defaultHatches,
      demand,
      true,
      {},
      { ...settings, wallsharing: 'side' },
    );
    expect(built.unplaced).toEqual([]);
    expect(built.missing).toEqual([]);
    expect(built.stats.conflicts).toEqual([]);
    const feed = built.hatches.find((h) => h.resource === 'feed' && h.unitIds.length === 2)!;
    expect(feed).toBeDefined();
    expect(feed.unitIds).toEqual([0, 1]);
    for (const unit of built.units) {
      expect(hatchCapacity(built.def, unit).capacity).toBe(7);
      expect(built.hatches.filter((h) => h.unitIds.includes(unit.id)).length).toBeLessThanOrEqual(7);
      for (const kind of ['energy', 'maintenance'] as const)
        expect(built.hatches.filter((h) => h.kind === kind && h.unitIds.includes(unit.id))).toEqual([
          expect.objectContaining({ unitIds: [unit.id], tier: kind === 'energy' ? 'HV' : undefined }),
        ]);
    }
    expect(validateResourceHatches(built.def, built.units, built.hatches, settings, demand)).toEqual([]);
    const incompatible = built.units.map((u) => ({ ...u, mirrored: false }));
    expect(
      validateResourceHatches(built.def, incompatible, built.hatches, settings, demand).some((e) =>
        e.includes('not allowed'),
      ),
    ).toBe(true);
  });

  it.each(['side', 'stack', 'back', 'none'] as WallsharingVariant[])(
    'tries preferred %s contacts before alternatives',
    (wallsharing) => {
      const packed = packUnits(def, 2, { x: null, y: null, z: null }, { wallsharing });
      expect(matchesWallsharing(def, packed.units, wallsharing)).toBe(true);
      expect(packed.placed).toBe(2);
    },
  );

  it('falls back from an unavailable stack without violating locked one-layer limits', () => {
    const packed = packUnits(def, 2, limits, { wallsharing: 'stack' });
    expect(packed.units.every((u) => u.origin[1] === 0)).toBe(true);
    expect(matchesWallsharing(def, packed.units, 'stack')).toBe(false);
  });

  it('tries another arrangement when a separate-machines preference conflicts with an explicitly shared resource', () => {
    const selected = {
      ...settings,
      wallsharing: 'none' as const,
      resourceBindings: [{ ...settings.resourceBindings[0], unitIds: [0, 1] }, settings.resourceBindings[1]],
    };
    const built = buildGroup(def, 2, limits, def.defaultHatches, demand, true, {}, selected);
    expect(built.unplaced).toEqual([]);
    expect(built.hatches.some((h) => h.resource === 'feed' && h.unitIds.length === 2)).toBe(true);
    expect(matchesWallsharing(built.def, built.units, 'none')).toBe(false);
    expect(validateResourceHatches(built.def, built.units, built.hatches, selected, demand)).toEqual([]);
  });

  it('automatically selects compatible mirrors when a shared side resource cannot fit the original row', () => {
    const selected = {
      ...settings,
      resourceBindings: [{ ...settings.resourceBindings[0], unitIds: [0, 1] }, settings.resourceBindings[1]],
    };
    const built = buildGroup(def, 2, limits, def.defaultHatches, demand, true, {}, selected);
    expect(built.unplaced).toEqual([]);
    expect(built.hatches.find((h) => h.resource === 'feed')?.unitIds).toEqual([0, 1]);
    expect(built.units.some((u) => u.mirrored)).toBe(true);
    expect(validateResourceHatches(built.def, built.units, built.hatches, selected, demand)).toEqual([]);
  });

  it('includes both mirror phases and respects explicit per-unit choices in every candidate and cached copy', () => {
    const candidates = [...layoutCandidates(def, 2, limits)];
    expect(candidates.some((units) => !units[0].mirrored && units[1].mirrored)).toBe(true);
    expect(candidates.some((units) => units[0].mirrored && !units[1].mirrored)).toBe(true);
    const chosen = { unitMirrors: { '0': true, '1': false } };
    for (const units of layoutCandidates(def, 2, limits, chosen)) {
      expect(units[0].mirrored).toBe(true);
      expect(units[1].mirrored).toBeUndefined();
    }
    const a = packUnits(def, 2, limits, chosen);
    a.units[0].mirrored = false;
    expect(packUnits(def, 2, limits, chosen).units[0].mirrored).toBe(true);
    expect(
      packUnits(def, 2, limits, { unitMirrors: { '0': false, '1': false } }).units.every((u) => !u.mirrored),
    ).toBe(true);
  });

  it('a shared agent works vertically and through the back middle column', () => {
    for (const origin of [
      [0, 2, 0],
      [0, 0, 2],
    ] as const) {
      const units: Unit[] = [
        { id: 0, origin: [0, 0, 0], rotation: 0 },
        { id: 1, origin, rotation: origin[2] ? 2 : 0 },
      ];
      expect(
        findSites(def, units, true).sites.some(
          (s) =>
            s.unitIds.length === 2 &&
            s.kinds.has('fluidIn') &&
            [...s.regions.values()].every((r) => r === 'middle'),
        ),
      ).toBe(true);
    }
  });

  it('shares output in the opposite mirror phase and counts its slot in both controllers', () => {
    const selected = {
      ...settings,
      unitMirrors: { '0': true, '1': false },
      resourceBindings: [
        ...settings.resourceBindings,
        { kind: 'fluidOut' as const, resource: 'product', unitIds: [0, 1] },
      ],
    };
    const built = buildGroup(def, 2, limits, def.defaultHatches, demand, true, {}, selected);
    expect(built.unplaced).toEqual([]);
    expect(built.hatches.find((h) => h.resource === 'product')?.unitIds).toEqual([0, 1]);
    expect(validateResourceHatches(built.def, built.units, built.hatches, selected, demand)).toEqual([]);
    const unmirrored = built.units.map((u) => ({ ...u, mirrored: false }));
    expect(
      validateResourceHatches(built.def, unmirrored, built.hatches, selected, demand).some((e) =>
        e.includes('not allowed'),
      ),
    ).toBe(true);
  });

  it('preserves preference, mirrors, roles and tiers in Arrange/Optimize and duplicates without cache cross-talk', () => {
    let site = withGroupAdded({ ...emptySite(), size: [64, 64] }, def.id);
    const id = site.groups[0].id;
    site = withGroupPatched(site, id, {
      count: 2,
      wallsharing: 'side',
      unitMirrors: { '0': false, '1': true },
      voltageTier: 'HV',
      resourceBindings: settings.resourceBindings,
      hatchTiers: { '[0,"energy",null,0]': 'EV' },
    });
    site.resources = Object.fromEntries(
      ['feed', 'agent', 'product'].map((resource) => [
        resource,
        { kind: 'fluid' as const, name: resource, color: '#123456' },
      ]),
    );
    for (const resource of ['feed', 'agent', 'product']) {
      const input = resource !== 'product';
      site.ports.push({ id: resource, dir: input ? 'in' : 'out', resource });
      site.links.push({
        id: resource,
        resource,
        from: input ? { port: resource } : { group: id },
        to: input ? { group: id } : { port: resource },
      });
    }
    const builder = createSiteBuilder();
    const frozen = structuredClone(site);
    const expected = site.groups[0];
    const arranged = arrangeHere(site, true, builder).site;
    const optimized = optimizeSite(site, builder, {
      iterations: 24,
      seeds: 1,
      refineSteps: 0,
      refineRuns: 0,
      now: () => 0,
      budgetMs: 1000,
    }).site;
    for (const result of [site, arranged, optimized]) {
      const built = builder(result, { pipes: true, cables: true, below: true });
      expect(built.warnings).toEqual([]);
      const group = built.groups[0];
      expect(
        validateResourceHatches(group.def!, group.units, group.hatches, group.group, group.demand),
      ).toEqual([]);
    }
    for (const result of [arranged, optimized, withGroupDuplicated(site, id, [30, 30])]) {
      const group = result.groups.at(-1)!;
      for (const field of [
        'wallsharing',
        'unitMirrors',
        'resourceBindings',
        'hatchTiers',
        'voltageTier',
      ] as const)
        expect(group[field]).toEqual(expected[field]);
    }
    const original = builder(site, { pipes: false, cables: false });
    const changed = withGroupPatched(site, id, { unitMirrors: { '0': true, '1': false } });
    const next = builder(changed, { pipes: false, cables: false });
    expect(next.groups[0].build?.units.map((u) => !!u.mirrored)).not.toEqual(
      original.groups[0].build?.units.map((u) => !!u.mirrored),
    );
    expect(site).toEqual(frozen);
    const smaller = builder(withGroupPatched(site, id, { count: 1 }), { pipes: false, cables: false });
    expect(smaller.warnings).toContainEqual(
      expect.objectContaining({
        type: 'assignment',
        message: 'Machine 2 no longer exists; ignoring its mirror override.',
      }),
    );
  });
});
