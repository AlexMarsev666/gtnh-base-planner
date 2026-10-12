import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { unitCells } from '../geometry';
import { packUnits } from '../layout/packer';
import type { HatchKind, MultiblockDef, Unit } from '../multiblock/types';
import { sizedDef } from '../resize';
import { checkValidity } from '../validity';
import { casingCells, casingRooms } from './floor';
import { placeHatches } from './placement';
import type { HatchRequest } from './types';

const free = { x: null, y: null, z: null };
const times = (n: number, request: HatchRequest): HatchRequest[] => Array.from({ length: n }, () => request);
const unit = (id: number, x = 0): Unit => ({ id, origin: [x, 0, 0], rotation: 0 });

/** A 3x1x3 ring of 8 casings around the controller (min 7 leaves room for one hatch); units 2 apart share a column. */
function ring(): MultiblockDef {
  return {
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
}

/** Hatches of the result standing in a counted casing of the unit. */
function counted(def: MultiblockDef, u: Unit, hatches: { cell: readonly number[] }[]): number {
  const chars = def.minCasings![0].chars;
  const at = new Map(unitCells(def, u).map((c) => [c.pos.join(), c.char]));
  return hatches.filter((h) => chars.includes(at.get(h.cell.join()) ?? '')).length;
}

describe('casing floors in placement', () => {
  it('stops at the floor and says why', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    const room = casingRooms(def)[0];
    expect(room).toBeGreaterThan(0);
    const units = packUnits(def, 1, free).units;
    const requests: HatchRequest[] = [
      { kind: 'energy', units: 'each' },
      { kind: 'maintenance', units: 'each' },
      ...times(20, { kind: 'fluidIn', units: 'each' }),
      ...times(20, { kind: 'fluidOut', units: 'each' }),
    ];
    const r = placeHatches(def, units, [], undefined, { requests });
    expect(counted(def, units[0], r.hatches)).toBe(room);
    expect(r.unplaced.some((u) => u.reason === 'casings')).toBe(true);
    // The mandatory hatches kept their place; what was placed is valid.
    expect(r.hatches.filter((h) => h.kind === 'energy' || h.kind === 'maintenance')).toHaveLength(2);
    expect(checkValidity(def, units, r.hatches)).toEqual({});
  });

  it('counts the room against the capacity', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    const units = packUnits(def, 1, free).units;
    const fluids = times(40, { kind: 'fluidIn', units: 'each' });
    const withFloor = placeHatches(def, units, [], undefined, { requests: fluids });
    const without = placeHatches({ ...def, minCasings: undefined }, units, [], undefined, {
      requests: fluids,
    });
    expect(withFloor.capacity?.[0].fits).toBeLessThan(without.capacity?.[0].fits ?? Infinity);
    expect(withFloor.hatches.length).toBeLessThan(without.hatches.length);
  });

  it('uses the grown minimum of a larger Distillation Tower', () => {
    const base = getMultiblock('distillation-tower')!;
    const def = sizedDef(base, 5);
    expect(def.minCasings![0].min).toBe(30);
    expect(casingRooms(def)[0]).toBe(casingCells(def)[0] - 30);
    const units = packUnits(def, 1, free).units;
    const requests: HatchRequest[] = [
      { kind: 'energy', units: 'each' },
      { kind: 'maintenance', units: 'each' },
      { kind: 'fluidIn', units: 'each' },
      ...times(30, { kind: 'fluidOut', units: 'each' }),
    ];
    const r = placeHatches(def, units, [], undefined, { requests });
    expect(counted(def, units[0], r.hatches)).toBeLessThanOrEqual(casingRooms(def)[0]);
    expect(checkValidity(def, units, r.hatches)).toEqual({});
  });

  it('takes a casing from every unit a shared hatch serves', () => {
    const def = ring();
    const units = [unit(0), unit(1, 2)];
    const requests = times(3, { kind: 'itemIn', units: 'each' });
    const r = placeHatches(def, units, [], undefined, { requests });
    // One shared hatch uses up the one spare casing of both units.
    expect(r.hatches).toHaveLength(1);
    expect(r.hatches[0].unitIds).toEqual([0, 1]);
    expect(r.unplaced.map((u) => u.reason)).toEqual(['casings', 'casings', 'casings', 'casings']);
    expect(checkValidity(def, units, r.hatches)).toEqual({});
    const loose = placeHatches({ ...def, minCasings: undefined }, units, [], undefined, { requests });
    expect(loose.hatches.length).toBeGreaterThan(1);
  });

  it('places the plain call on the same floor', () => {
    const def = { ...ring(), requiredHatches: { itemIn: { min: 3 } } };
    const r = placeHatches(def, [unit(0)], ['itemIn']);
    expect(r.hatches).toHaveLength(1);
    expect(r.unplaced).toHaveLength(2);
  });

  it('places a requiredAny group of the first enabled kind', () => {
    const def: MultiblockDef = {
      ...ring(),
      legend: { C: { blockId: 'casing', hatches: ['itemIn', 'fluidIn'] } },
      hatchBlocks: { itemIn: 'bus', fluidIn: 'hatch' },
      requiredAny: [{ kinds: ['itemIn', 'fluidIn'], min: 1 }],
      minCasings: undefined,
    };
    const kinds = (enabled: HatchKind[]) => placeHatches(def, [unit(0)], enabled).hatches.map((h) => h.kind);
    expect(kinds(['fluidIn'])).toEqual(['fluidIn']);
    expect(kinds([])).toEqual([]);
    const asked = placeHatches(def, [unit(0)], [], undefined, {
      requests: [],
    });
    expect(asked.unplaced).toEqual([{ unitId: 0, kind: 'itemIn', reason: 'required' }]);
  });

  /** Like the ring, but the corner at x 0, z 2 is a `D` casing: the same block, which `minCasings` may leave uncounted. */
  function lopsided(minCasings: MultiblockDef['minCasings']): MultiblockDef {
    return {
      ...ring(),
      layers: [['CCC', 'C~C', 'DCC']],
      legend: {
        C: { blockId: 'casing', hatches: ['itemIn'] },
        D: { blockId: 'casing', hatches: ['itemIn'] },
      },
      minCasings,
    };
  }

  it('reads the chars of a unit turned to share a wall', () => {
    const def = lopsided([{ chars: ['C'], min: 6 }]);
    // Unit 1 is turned: its D corner lands on the shared column at z 0, a cell unit 0 counts as C.
    const units: Unit[] = [unit(0), { id: 1, origin: [2, 0, 0], rotation: 1 }];
    const requests = times(3, { kind: 'itemIn', units: 'each' } as HatchRequest);
    const r = placeHatches(def, units, [], undefined, { requests });
    // The shared hatch costs unit 0 a casing only (unit 1 does not count its D corner). Unit 0 then has only
    // its own D corner left, uncounted, and unit 1 one casing of its own.
    expect(r.hatches.map((h) => [h.cell.join(), h.unitIds])).toEqual([
      ['2,0,0', [0, 1]],
      ['3,0,0', [1]],
      ['0,0,2', [0]],
    ]);
    expect(r.unplaced.map((u) => u.reason)).toEqual(['casings', 'casings']);
    expect(checkValidity(def, units, r.hatches)).toEqual({});
  });

  it('counts a cell against every minimum its char is in, in capacity as in placement', () => {
    // C counts toward both minimums, D toward the first only: room 4 and 2, so 2 C + the D = 3 hatches.
    const def = lopsided([
      { chars: ['C', 'D'], min: 4 },
      { chars: ['C'], min: 5 },
    ]);
    expect(casingRooms(def)).toEqual([4, 2]);
    const requests = times(8, { kind: 'itemIn', units: 'each' } as HatchRequest);
    const r = placeHatches(def, [unit(0)], [], undefined, { requests });
    expect(r.hatches).toHaveLength(3);
    expect(r.capacity?.[0].fits).toBe(3);
    expect(checkValidity(def, [unit(0)], r.hatches)).toEqual({});
  });
});
