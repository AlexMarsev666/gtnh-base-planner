import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../data/catalog';
import { placeHatches } from './hatches/placement';
import { packUnits } from './layout/packer';
import type { Dir, Tier } from './core/types';
import type { HatchKind, MultiblockDef, Unit } from './multiblock/types';
import type { HatchPlacement } from './plan/types';
import { effectiveSize, sizedDef } from './resize';
import { DEFAULT_TIER, effectiveGlassTier, tierByName } from './tiers';
import { checkValidity, glassTierProblems } from './validity';

const free = { x: null, y: null, z: null };

describe('checkValidity', () => {
  it('reports an unmet requiredAny group on the Vacuum Freezer, and nothing with the defaults', () => {
    const def = getMultiblock('vacuum-freezer')!;
    const units = packUnits(def, 1, free).units;
    const ok = placeHatches(def, units, def.defaultHatches);
    expect(checkValidity(def, units, ok.hatches)).toEqual({});
    const noInputs = def.defaultHatches.filter((k) => k !== 'itemIn' && k !== 'fluidIn');
    const bare = placeHatches(def, units, noInputs);
    expect(checkValidity(def, units, bare.hatches)).toEqual({
      0: [{ type: 'requiredAny', kinds: ['itemIn', 'fluidIn'], have: 0, min: 1, severity: 'error' }],
    });
    const none = placeHatches(def, units, ['energy', 'maintenance']);
    expect(checkValidity(def, units, none.hatches)[0].map((p) => p.type)).toEqual([
      'requiredAny',
      'requiredAny',
    ]);
  });

  it('reports a missing energy or maintenance hatch and a count over the maximum', () => {
    const def = getMultiblock('electric-blast-furnace')!;
    const units = packUnits(def, 1, free).units;
    const types = (enabled: HatchKind[]) =>
      (checkValidity(def, units, placeHatches(def, units, enabled).hatches)[0] ?? [])
        .map((p) => p.type)
        .filter((type) => type !== 'requiredAny');
    expect(types(['maintenance', 'muffler'])).toEqual(['missingEnergy']);
    expect(types(['energy', 'muffler'])).toEqual(['missingMaintenance']);
    const hatches = placeHatches(def, units, def.defaultHatches).hatches;
    const muffler = hatches.find((h) => h.kind === 'muffler')!;
    const twice = [...hatches, { ...muffler, cell: [9, 9, 9] as HatchPlacement['cell'] }];
    expect(checkValidity(def, units, twice)[0]).toEqual([
      { type: 'hatchCount', kind: 'muffler', have: 2, max: 1, severity: 'error' },
    ]);
  });

  it('counts a shared hatch for every unit it serves and takes its casing from each', () => {
    const def: MultiblockDef = {
      id: 'ring',
      name: 'Ring',
      size: [3, 1, 3],
      layers: [['CCC', 'C~C', 'CCC']],
      legend: { C: { blockId: 'casing', hatches: ['itemIn'] } },
      controller: { pos: [1, 0, 1], facing: 'north', blockId: 'controller' },
      hatchBlocks: { itemIn: 'bus' },
      shareableHatches: ['itemIn'],
      minCasings: [{ chars: ['C'], min: 7 }],
      defaultHatches: [],
      wallshare: true,
    };
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [2, 0, 0], rotation: 0 },
    ];
    const hatch = (cell: [number, number, number], unitIds: number[]): HatchPlacement => ({
      kind: 'itemIn',
      cell,
      face: 'up',
      unitIds,
    });
    const casings = { type: 'casings', chars: ['C'], min: 7, severity: 'error' };
    // Shared: both units drop to 7, still fine.
    expect(checkValidity(def, units, [hatch([2, 0, 0], [0, 1])])).toEqual({});
    // A second hatch on unit 0's own wall takes it to 6; unit 1 is unaffected.
    expect(checkValidity(def, units, [hatch([2, 0, 0], [0, 1]), hatch([0, 0, 0], [0])])).toEqual({
      0: [{ ...casings, have: 6 }],
    });
    // The shared one plus one on each side: both fall short.
    expect(
      checkValidity(def, units, [hatch([2, 0, 0], [0, 1]), hatch([0, 0, 0], [0]), hatch([4, 0, 0], [1])]),
    ).toEqual({ 0: [{ ...casings, have: 6 }], 1: [{ ...casings, have: 6 }] });
  });

  it('reports a hatch on a forbidden face', () => {
    const def = getMultiblock('distillation-tower')!;
    const units = packUnits(def, 1, free).units;
    const placed = placeHatches(def, units, def.defaultHatches).hatches;
    expect(checkValidity(def, units, placed)).toEqual({});
    const out = placed.find((h) => h.kind === 'fluidOut')!;
    const turned = placed.map((h) => (h === out ? { ...h, face: 'up' as const } : h));
    // GT does not check hatch facing: a hint, and the machine still forms.
    expect(checkValidity(def, units, turned)[0]).toEqual([
      { type: 'forbiddenFace', kind: 'fluidOut', cell: out.cell, face: 'up', severity: 'hint' },
    ]);
  });

  it('is clean for every def at its default size and hatches, apart from known placement shortfalls', () => {
    // These cannot fit their required hatches on one unit (no cell with an open face): not casing floors.
    const short = [
      'advanced-assembly-line',
      'nuclear-salt-processing-plant',
      'source-chamber',
      'synchrotron',
    ];
    const bad: string[] = [];
    for (const raw of catalog) {
      const def = sizedDef(raw, effectiveSize(raw, undefined));
      const units = packUnits(def, 1, free).units;
      const placed = placeHatches(def, units, def.defaultHatches);
      expect(units, def.id).toHaveLength(1);
      // Hints (a hatch GT would turn elsewhere, e.g. an Assembly Line's floor casings face down) are fine.
      const errors = Object.values(checkValidity(def, units, placed.hatches))
        .flat()
        .filter((p) => p.severity === 'error');
      if (errors.length > 0) bad.push(def.id);
    }
    expect(bad).toEqual(short);
  });

  it('turns a hatch to a side its cell allows when it can, and hints when it cannot', () => {
    const ring = (allow: Dir[]): MultiblockDef => ({
      id: 'ring',
      name: 'Ring',
      size: [3, 1, 3],
      layers: [['CCC', 'C~C', 'CCC']],
      legend: { C: { blockId: 'casing', hatches: ['itemIn'], allowFaces: { itemIn: allow } } },
      controller: { pos: [1, 0, 1], facing: 'north', blockId: 'controller' },
      hatchBlocks: { itemIn: 'bus' },
      shareableHatches: [],
      defaultHatches: [],
      wallshare: false,
    });
    const run = (def: MultiblockDef) => {
      const units = packUnits(def, 1, free).units;
      const placed = placeHatches(def, units, ['itemIn']);
      return { units, hatches: placed.hatches, unplaced: placed.unplaced };
    };
    const east = run(ring(['east']));
    expect(east.hatches.map((h) => h.face)).toEqual(['east']);
    expect(checkValidity(ring(['east']), east.units, east.hatches)).toEqual({});
    // Every open side of a one-layer ring is allowed except down, which is the ground: the hatch faces another.
    const down = run(ring(['down']));
    expect(down.unplaced).toEqual([]);
    expect(down.hatches).toHaveLength(1);
    expect(down.hatches[0].face).not.toBe('down');
    expect(checkValidity(ring(['down']), down.units, down.hatches)[0]).toEqual([
      {
        type: 'forbiddenFace',
        kind: 'itemIn',
        cell: down.hatches[0].cell,
        face: down.hatches[0].face,
        severity: 'hint',
      },
    ]);
  });
});

describe('glass tier', () => {
  const setup = (id: string) => {
    const def = getMultiblock(id)!;
    const units = packUnits(def, 1, free).units;
    const hatches = placeHatches(def, units, def.defaultHatches).hatches;
    return { def, units, hatches };
  };
  const energyAt = (tier: Tier) => (hatches: HatchPlacement[]) => (i: number) =>
    hatches[i].kind === 'energy' ? tier : undefined;

  it('reads the tier of the glass a def draws, and a set one wins', () => {
    const { def } = setup('mega-oil-cracker');
    expect(effectiveGlassTier(def)).toBe('HV');
    expect(effectiveGlassTier(def, 'UV')).toBe('UV');
    expect(effectiveGlassTier(setup('electric-blast-furnace').def)).toBeUndefined();
    // The planner's own stand-in has no tier, so it never limits.
    expect(effectiveGlassTier(setup('extreme-entity-crusher').def)).toBeUndefined();
  });

  it('is an error when an energy hatch is above the glass, and clean otherwise', () => {
    const { def, units, hatches } = setup('mega-oil-cracker');
    const of = energyAt('EV')(hatches);
    expect(checkValidity(def, units, hatches, { hatchTierOf: of })[0]).toEqual([
      { type: 'glassTier', kind: 'energy', hatchTier: 'EV', glassTier: 'HV', severity: 'error' },
    ]);
    expect(checkValidity(def, units, hatches, { hatchTierOf: energyAt('HV')(hatches) })).toEqual({});
    expect(checkValidity(def, units, hatches, { glassTier: 'EV', hatchTierOf: of })).toEqual({});
    expect(checkValidity(def, units, hatches, { glassTier: 'HV', hatchTierOf: of })[0]).toHaveLength(1);
    // Without tiers (any tier) nothing is compared; without a glass check nothing is either.
    expect(checkValidity(def, units, hatches, { hatchTierOf: () => undefined })).toEqual({});
    expect(checkValidity(def, units, hatches)).toEqual({});
  });

  it('ignores a def without a glass limit, and counts a shared hatch for every unit', () => {
    const ebf = setup('electric-blast-furnace');
    expect(checkValidity(ebf.def, ebf.units, ebf.hatches, { hatchTierOf: () => 'UXV' })).toEqual({});
    const { def, hatches } = setup('mega-oil-cracker');
    const units: Unit[] = [
      { id: 0, origin: [0, 0, 0], rotation: 0 },
      { id: 1, origin: [50, 0, 0], rotation: 0 },
    ];
    const shared = hatches.filter((h) => h.kind === 'energy').map((h) => ({ ...h, unitIds: [0, 1] }));
    const out = glassTierProblems(def, shared, { hatchTierOf: () => 'IV' });
    expect([...out.keys()]).toEqual([0, 1]);
  });

  it('reports no def at its default tier (the tag, else LV) with its own glass', () => {
    const bad: string[] = [];
    for (const raw of catalog) {
      if (!raw.glassTierLimits) continue;
      const def = sizedDef(raw, effectiveSize(raw, undefined));
      const { units, hatches } = (() => {
        const u = packUnits(def, 1, free).units;
        return { units: u, hatches: placeHatches(def, u, def.defaultHatches).hatches };
      })();
      const tier = tierByName(def.tier) ?? DEFAULT_TIER;
      const v = checkValidity(def, units, hatches, {
        hatchTierOf: (i) => (hatches[i].kind === 'energy' ? tier : undefined),
      });
      if (
        Object.values(v)
          .flat()
          .some((p) => p.type === 'glassTier')
      )
        bad.push(`${def.id} ${tier}`);
    }
    expect(bad).toEqual([]);
  });
});
