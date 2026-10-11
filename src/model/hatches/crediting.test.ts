import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { sizedDef } from '../resize';
import { placeHatches } from './placement';
import { stagesOf } from './requests';
import type { ZonedDef } from './types';

const unit = (id: number, x = 0): Unit => ({ id, origin: [x, 0, 0], rotation: 0 });

/** Three units in a row; the middle one's cells are all shared with a neighbour. */
function line(kind: 'fluidIn' | 'itemIn', over: Partial<ZonedDef> = {}): ZonedDef {
  return {
    id: 'line',
    name: 'Line',
    size: [3, 1, 1],
    layers: [['A~B']],
    legend: {
      A: { blockId: 'casing', hatches: [kind] },
      B: { blockId: 'casing', hatches: [kind] },
    },
    controller: { pos: [1, 0, 0], facing: 'north', blockId: 'controller' },
    hatchBlocks: { [kind]: 'hatch' },
    shareableHatches: [kind],
    defaultHatches: [],
    wallshare: true,
    ...over,
  };
}
const row = [unit(1), unit(2, 2), unit(3, 4)];

describe('crediting a hatch placed for an earlier stage', () => {
  it('does not credit a fluid hatch outside the stage zone', () => {
    const def = line('fluidIn', {
      zones: { dot1: { kinds: ['fluidIn'] }, dot2: { kinds: ['fluidIn'] } },
      zoneCells: { '0,0,0': 'dot1', '2,0,0': 'dot1' },
      zoneSize: [3, 1, 1],
    });
    // Unit 2's only dot1 cells are shared; unit 1 then wants its own dot2 hatch, which has no cell.
    const r = placeHatches(def, row, [], undefined, {
      requests: [
        { kind: 'fluidIn', units: [2], zone: 'dot1', key: 'w' },
        { kind: 'fluidIn', units: [1], zone: 'dot2', key: 'w' },
      ],
    });
    expect(r.hatches).toHaveLength(1);
    expect(r.unplaced).toEqual([{ unitId: 1, kind: 'fluidIn', key: 'w', reason: 'noCell' }]);
  });

  it('credits a shared hatch of a shareable item kind to the unit it already serves', () => {
    const r = placeHatches(line('itemIn'), row, [], undefined, {
      requests: [
        { kind: 'itemIn', units: [2], key: 'k' },
        { kind: 'itemIn', units: [1, 3], key: 'k' },
      ],
    });
    expect(r.unplaced).toEqual([]);
    expect(r.hatches).toHaveLength(2);
    expect(r.hatches[0].unitIds).toEqual([1, 2]);
  });

  it('still places a second hatch when a unit is named twice', () => {
    const r = placeHatches(line('itemIn'), [unit(1)], [], undefined, {
      requests: [
        { kind: 'itemIn', units: 'each', key: 'k' },
        { kind: 'itemIn', units: 'each', key: 'k' },
      ],
    });
    expect(r.hatches).toHaveLength(2);
  });
});

describe('mandatory hatches per unit', () => {
  it('marks the first min requests naming each unit', () => {
    const def = {
      requiredHatches: { energy: { min: 1 } },
      hatchBlocks: { energy: 'e' },
    } as unknown as MultiblockDef;
    const { stages } = stagesOf(
      def,
      [
        { kind: 'energy', units: [1] },
        { kind: 'energy', units: [2] },
        { kind: 'energy', units: [1, 2] },
      ],
      [1, 2],
      ['energy'],
    );
    expect(stages.map((s) => [...s.mandatoryFor])).toEqual([[1], [2], []]);
    expect(stages.map((s) => s.mandatory)).toEqual([true, true, false]);
  });
});

describe('required hatches reported once', () => {
  it('counts a missing region instead of, not on top of, the shortfall of min', () => {
    const tower = sizedDef(getMultiblock('distillation-tower')!, 5);
    const req = tower.requiredHatches!.fluidOut!;
    const r = placeHatches(tower, [unit(1)], [], undefined, {
      requests: [{ kind: 'fluidOut', units: 'each' }],
    });
    const entries = r.unplaced.filter((u) => u.kind === 'fluidOut' && u.reason === 'required');
    const regions = entries.filter((u) => u.region !== undefined).length;
    const plain = entries.length - regions;
    // One output hatch was requested: the rest of min is short, and regions explain part of that.
    expect(regions).toBeGreaterThan(0);
    expect(regions + plain).toBe(Math.max(req.min - 1, regions));
  });
});
