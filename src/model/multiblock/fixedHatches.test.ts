import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { fixedHatchCounts, fixedHatchKind } from './fixedHatches';
import { quota } from '../hatches/quota';
import { sizedDef } from '../resize';
import { buildGroup } from '../site/group';
import { unitCells } from '../geometry';
import { validateResourceHatches, hatchAssignmentKey } from '../site/resourcePlacement';
import { createSiteBuilder } from '../site/build';
import { withGroupAdded, withGroupPatched, withGroupRotated, withPlanAdded } from '../../ui/siteActions';
import { defaultPlan } from '../../state/store';
import { emptySite } from '../../share/siteCodec';
import { requiredBlocks } from '../bom';
import { createPipeline } from '../../ui/pipeline';
import { placeHatches } from '../hatches/placement';
import { placeResourceHatches } from '../site/resourcePlacement';
import type { MultiblockDef } from './types';

describe('mandatory physical hatch cells', () => {
  const mixed: MultiblockDef = {
    id: 'fixed-bus-regression',
    name: 'Fixed bus regression',
    size: [4, 1, 1],
    layers: [['~CII']],
    legend: {
      C: { blockId: 'casing', hatches: ['itemIn'] },
      I: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn'] },
    },
    controller: { pos: [0, 0, 0], facing: 'north', blockId: 'controller' },
    hatchBlocks: { itemIn: 'gt.hatch.inputBus' },
    shareableHatches: [],
    defaultHatches: ['itemIn'],
    wallshare: false,
  };
  const unit = { id: 0, origin: [0, 0, 0] as [number, number, number], rotation: 0 as const };

  it('greedy placement fills mandatory buses before a nearer optional casing', () => {
    const result = placeHatches(mixed, [unit], ['itemIn'], undefined, {
      toward: { itemIn: [-100, 0, 0] },
    });
    expect(result.unplaced).toEqual([]);
    expect(result.hatches.map((h) => h.cell[0]).sort()).toEqual([2, 3]);
    expect(validateResourceHatches(mixed, [unit], result.hatches, {})).toEqual([]);
  });

  it('resource assignments fill fixed cells and use optional casing only for excess demand', () => {
    for (const resources of [
      ['iron', 'gold'],
      ['iron', 'gold', 'copper'],
    ]) {
      const result = placeResourceHatches(
        mixed,
        [unit],
        ['itemIn'],
        { itemIn: resources },
        { voltageTier: 'LV' },
        false,
        { itemIn: 'west' },
      );
      expect(result.unplaced).toEqual([]);
      expect(result.hatches.map((h) => h.cell[0]).sort()).toEqual(
        resources.length === 2 ? [2, 3] : [1, 2, 3],
      );
      expect(result.hatches.map((h) => h.resource).sort()).toEqual([...resources].sort());
      expect(validateResourceHatches(mixed, [unit], result.hatches, { voltageTier: 'LV' })).toEqual([]);
    }
  });

  it('reports inaccessible mandatory cells even when an optional casing can take a bus', () => {
    const result = placeHatches(mixed, [unit], ['itemIn'], new Map([['itemIn', new Set(['3,0,0'])]]));
    expect(validateResourceHatches(mixed, [unit], result.hatches, {})).toContain(
      'Controller 0: itemIn is required at 3,0,0 under RC2.',
    );
    expect(result.unplaced).toContainEqual({ unitId: 0, kind: 'itemIn' });
  });

  it('Assembly Line reports inaccessible interior buses when bottom connections are disabled', () => {
    const def = sizedDef(getMultiblock('assembly-line')!, 5);
    const result = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, false);
    expect(result.unplaced.filter((h) => h.kind === 'itemIn').length).toBeGreaterThan(0);
  });

  for (const length of [5, 9, 16]) {
    it(`Assembly Line ${length}: assigns every input bus and preserves its individual tier`, () => {
      const def = sizedDef(getMultiblock('assembly-line')!, length);
      expect(fixedHatchCounts(def).itemIn).toBe(1);
      expect(quota(def, 'itemIn').target).toBe(1);
      const key = hatchAssignmentKey(0, 'itemIn', undefined, 2);
      const settings = { voltageTier: 'LV' as const, hatchTiers: { [key]: 'EV' as const } };
      const built = buildGroup(def, 1, { x: 1, y: 1, z: 1 }, def.defaultHatches, {}, true, {}, settings);
      expect(built.unplaced).toEqual([]);
      expect(built.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(length);
      const cells = unitCells(def, built.units[0]).filter(
        (c) => fixedHatchKind(def, def.legend[c.char]) === 'itemIn',
      );
      for (const cell of cells)
        expect(built.hatches.some((h) => h.kind === 'itemIn' && h.cell.join() === cell.pos.join())).toBe(
          true,
        );
      expect(built.hatches.find((h) => h.assignments?.includes(key))?.tier).toBe('EV');
      const removed = built.hatches.filter((h) => !h.assignments?.includes(key));
      expect(
        validateResourceHatches(def, built.units, removed, settings).some((e) =>
          e.includes('is required at'),
        ),
      ).toBe(true);
      const plan = { ...defaultPlan('assembly-line'), count: 1, size: length, ...settings };
      const result = createPipeline()(plan, false, false, true);
      expect(result.error).toBeNull();
      const materials = requiredBlocks(result.scene!).blocks;
      expect(materials.find((b) => b.blockId === 'gt.hatch.inputBus.EV')?.count).toBe(1);
      expect(materials.find((b) => b.blockId === 'gt.hatch.inputBus.LV')?.count).toBe(length - 1);
      const site = withPlanAdded(emptySite(), plan, [3, 3]);
      const original = site.groups[0];
      const rotated = withGroupRotated(site, original.id);
      expect(
        createSiteBuilder()(rotated, { pipes: false, cables: false, below: true }).groups[0].hatches.find(
          (h) => h.assignments?.includes(key),
        )?.tier,
      ).toBe('EV');
      const resized = withGroupPatched(rotated, original.id, { size: 5 });
      expect(
        createSiteBuilder()(resized, { pipes: false, cables: false, below: true }).groups[0].hatches.filter(
          (h) => h.kind === 'itemIn',
        ),
      ).toHaveLength(5);
    });
  }

  it('advanced line fills all five fixed input buses; new and saved hatch flags remain distinct', () => {
    const def = getMultiblock('advanced-assembly-line')!;
    expect(fixedHatchCounts(def).itemIn).toBe(1);
    const fresh = withGroupAdded(emptySite(), def.id);
    const build = createSiteBuilder();
    const good = build(fresh, { pipes: false, cables: false, below: true });
    expect(good.groups[0].hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(5);
    const disabled = {
      ...fresh,
      groups: fresh.groups.map((g) => ({
        ...g,
        enabledHatches: g.enabledHatches.filter((k) => k !== 'itemIn'),
      })),
    };
    const saved = JSON.stringify(disabled);
    const errors = build(disabled, { pipes: false, cables: false, below: true }).warnings.filter(
      (w) => w.type === 'error',
    );
    expect(errors.some((e) => e.message.includes('itemIn is required at'))).toBe(true);
    expect(JSON.stringify(disabled)).toBe(saved);
  });

  it('does not force one kind in multi-kind exclusive cells or machine-specific placeholders', () => {
    const def = getMultiblock('linear-accelerator')!;
    const ambiguous = Object.values(def.legend).find((e) => e.blockId === 'gt.hatch.inputHatch')!;
    expect(ambiguous.hatches).toEqual(['fluidIn', 'fluidOut']);
    expect(fixedHatchKind(def, ambiguous)).toBeUndefined();
    expect(fixedHatchKind(def, { blockId: 'gt.hatch.special' })).toBeUndefined();
  });

  it('matches overlapping mandatory alternatives without consuming the only fluid cell for an item', () => {
    const def: MultiblockDef = {
      ...mixed,
      size: [4, 1, 1],
      layers: [['~CIA']],
      legend: {
        C: { blockId: 'casing', hatches: ['itemIn', 'fluidIn'] },
        I: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn'], requiredHatch: true },
        A: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn', 'fluidIn'], requiredHatch: true },
      },
      hatchBlocks: { itemIn: 'gt.hatch.inputBus', fluidIn: 'gt.hatch.inputHatch' },
    };
    const result = placeResourceHatches(
      def,
      [unit],
      ['itemIn', 'fluidIn'],
      { itemIn: ['iron'], fluidIn: ['water'] },
      { voltageTier: 'LV' },
      false,
      {},
    );
    expect(result.unplaced).toEqual([]);
    expect(result.hatches.find((h) => h.resource === 'iron')?.cell).toEqual([2, 0, 0]);
    expect(result.hatches.find((h) => h.resource === 'water')?.cell).toEqual([3, 0, 0]);
    expect(validateResourceHatches(def, [unit], result.hatches)).toEqual([]);
    const optionalOnly = result.hatches.map((h) =>
      h.resource === 'water' ? { ...h, cell: [1, 0, 0] as [number, number, number] } : h,
    );
    expect(validateResourceHatches(def, [unit], optionalOnly)).toContain(
      'Controller 0: itemIn or fluidIn is required at 3,0,0 under RC2.',
    );
  });

  it('fills repeated alternative cells with one enabled kind and respects avoidance in classic placement', () => {
    const def: MultiblockDef = {
      ...mixed,
      layers: [['~CAA']],
      legend: {
        C: { blockId: 'casing', hatches: ['fluidIn'] },
        A: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn', 'fluidIn'], requiredHatch: true },
      },
      hatchBlocks: { itemIn: 'gt.hatch.inputBus', fluidIn: 'gt.hatch.inputHatch' },
    };
    const good = placeHatches(def, [unit], ['fluidIn'], undefined, { toward: { fluidIn: [-100, 0, 0] } });
    expect(good.unplaced).toEqual([]);
    expect(good.hatches.map((h) => h.cell[0]).sort()).toEqual([2, 3]);
    const absent = placeHatches(def, [unit], ['fluidIn'], new Map([['fluidIn', new Set(['3,0,0'])]]));
    expect(absent.hatches.some((h) => h.cell[0] === 3)).toBe(false);
    expect(absent.unplaced.length).toBeGreaterThan(0);
  });
  it('selects filler alternatives within exact count limits', () => {
    const def: MultiblockDef = {
      ...mixed,
      layers: [['~AAA']],
      legend: { A: { blockId: 'gt.hatch.inputBus', hatches: ['itemIn', 'fluidIn'], requiredHatch: true } },
      hatchBlocks: { itemIn: 'gt.hatch.inputBus', fluidIn: 'gt.hatch.inputHatch' },
      requiredHatches: { itemIn: { min: 0, max: 1 }, fluidIn: { min: 0, max: 2 } },
    };
    const result = placeResourceHatches(def, [unit], ['itemIn', 'fluidIn'], {}, {}, false, {});
    expect(result.unplaced).toEqual([]);
    expect(result.hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(1);
    expect(result.hatches.filter((h) => h.kind === 'fluidIn')).toHaveLength(2);
    expect(validateResourceHatches(def, [unit], result.hatches)).toEqual([]);
  });

  it('Drone Centre keeps the legacy probe cell free and places its ordinary input bus on real casing', () => {
    const def = getMultiblock('drone-centre')!;
    expect(def.layers[0][0][7]).toBe(' ');
    expect(fixedHatchCounts(def).itemIn).toBeUndefined();
    const site = withGroupAdded(emptySite(), def.id);
    expect(site.groups[0].enabledHatches).toContain('itemIn');
    const built = createSiteBuilder()(site, { pipes: false, cables: false, below: true });
    expect(built.groups[0].hatches.filter((h) => h.kind === 'itemIn')).toHaveLength(1);
    expect(built.warnings.filter((w) => w.type === 'error')).toEqual([]);
  });
});
