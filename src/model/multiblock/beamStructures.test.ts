import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { validateMultiblockDef } from '../../data/validate';
import { effectiveSize, sizedDef } from '../resize';
import { unitCells } from '../geometry';
import { buildGroup, defaultGroupHatches } from '../site/group';
import { validateResourceHatches } from '../site/resourcePlacement';
import { emptySite, siteFromJson, siteToJson } from '../../share/siteCodec';
import { withGroupAdded } from '../../ui/siteActions';

describe('exact RC2 beam structures', () => {
  for (const kind of ['itemIn', 'fluidIn'] as const)
    it(`Source Chamber: ${kind} occupies the single mandatory input and the bus connects below`, () => {
      const def = getMultiblock('source-chamber')!;
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        defaultGroupHatches(def),
        { [kind]: ['feed'] },
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced).toEqual([]);
      expect(built.missing).toEqual([]);
      expect(built.hatches.find((h) => h.resource === 'feed')).toMatchObject({ kind, cell: [2, 2, 0] });
      expect(built.hatches.filter((h) => h.kind === 'itemIn' || h.kind === 'fluidIn')).toHaveLength(1);
      expect(built.hatches.find((h) => h.kind === 'itemOut')).toMatchObject({
        cell: [2, 0, 1],
        face: 'down',
      });
      expect(
        unitCells(def, built.units[0]).find((c) => c.blockId === 'gregtech:gt.blockmachines@10504'),
      ).toMatchObject({
        local: [2, 2, 5],
        facing: 'south',
      });
      expect(validateResourceHatches(built.def, built.units, built.hatches, { voltageTier: 'LV' })).toEqual(
        [],
      );
      expect(validateMultiblockDef(def)).toEqual([]);
    });
  it('Source Chamber reports a two-resource conflict and an inaccessible output instead of replacing glass', () => {
    const def = getMultiblock('source-chamber')!;
    const conflict = buildGroup(
      def,
      1,
      { x: 1, y: 1, z: 1 },
      defaultGroupHatches(def),
      { itemIn: ['item'], fluidIn: ['fluid'] },
      true,
      {},
      { voltageTier: 'LV' },
    );
    expect(conflict.missing).toHaveLength(1);
    const surface = buildGroup(
      def,
      1,
      { x: 1, y: 1, z: 1 },
      def.defaultHatches,
      {},
      false,
      {},
      { voltageTier: 'LV' },
    );
    expect(surface.unplaced).toContainEqual({ unitId: 0, kind: 'itemOut' });
    expect(def.requiredHatches?.energy).toEqual({ min: 1, max: 1 });
    expect(def.requiredHatches?.maintenance).toEqual({ min: 1, max: 1 });
  });
  for (const [id, inputs, outputs, outputId] of [
    ['beam-mirror', 1, 1, 'gregtech:gt.blockmachines@10504'],
    ['beam-splitter', 1, 4, 'gregtech:gt.blockmachines@3014'],
    ['beam-stabilizer', 1, 1, 'gregtech:gt.blockmachines@10504'],
    ['beam-crafter', 2, 0, 'gregtech:gt.blockmachines@10504'],
  ] as const)
    it(`${id}: retains concrete beam interface roles and source occupancy`, () => {
      const def = getMultiblock(id)!;
      expect(validateMultiblockDef(def)).toEqual([]);
      const built = buildGroup(
        def,
        1,
        { x: 1, y: 1, z: 1 },
        def.defaultHatches,
        {},
        true,
        {},
        { voltageTier: 'LV' },
      );
      expect(built.unplaced).toEqual([]);
      const cells = unitCells(def, built.units[0]);
      expect(cells.filter((c) => c.blockId === 'gregtech:gt.blockmachines@10503')).toHaveLength(inputs);
      expect(cells.filter((c) => c.blockId === outputId)).toHaveLength(outputs);
      expect(cells.some((c) => c.blockId === 'gt.hatch.special')).toBe(false);
    });
  it('changes Mirror topology and output direction at height six and retains the default at five', () => {
    const def = getMultiblock('beam-mirror')!;
    expect(effectiveSize(def, undefined)).toBe(5);
    const t2 = sizedDef(def, 6);
    expect(t2.size).toEqual([3, 6, 5]);
    for (const [form, pos, face] of [
      [def, [1, 4, 3], 'up'],
      [t2, [1, 4, 0], 'north'],
    ] as const) {
      const cells = unitCells(form, { id: 0, origin: [0, 0, 0], rotation: 0 });
      expect(cells.find((c) => c.blockId === 'gregtech:gt.blockmachines@10504')).toMatchObject({
        pos,
        facing: face,
      });
      expect(validateMultiblockDef(form)).toEqual([]);
    }
    const site = withGroupAdded(emptySite(), def.id);
    site.groups[0].size = 6;
    expect(siteFromJson(siteToJson(site)).groups[0].size).toBe(6);
    expect(sizedDef(def, 6)).toBe(t2);
  });
});
