import { describe, expect, it } from 'vitest';
import {
  hatchCellsOf,
  hatchKeyAt,
  hatchPickHolds,
  hatchTierOptions,
  hatchTierRows,
  unmatchedHatchTiers,
} from './hatchTierRows';

const h = (kind: Parameters<typeof hatchTierOptions>[0], unitIds: number[]) => ({ kind, unitIds });

describe('hatch tier rows', () => {
  const hatches = [
    h('itemIn', [0]),
    h('maintenance', [0]),
    h('itemIn', [1]),
    h('energy', [0, 1]),
    h('steamIn', [0]),
  ];

  it('numbers hatches per kind as the bill of materials keys them and skips untiered kinds', () => {
    expect(hatchTierRows(hatches)).toEqual([
      { key: 'itemIn:0', kind: 'itemIn', number: 1 },
      { key: 'itemIn:1', kind: 'itemIn', number: 2 },
      { key: 'energy:0', kind: 'energy', number: 1 },
    ]);
  });

  it('lists only hatches of the selected units, keeping the whole-build keys', () => {
    expect(hatchTierRows(hatches, [1]).map((r) => r.key)).toEqual(['itemIn:1', 'energy:0']);
  });

  it('stops energy and dynamo hatches at UXV', () => {
    expect(hatchTierOptions('energy').at(-1)).toBe('UXV');
    expect(hatchTierOptions('dynamo')).not.toContain('MAX');
    expect(hatchTierOptions('itemIn').at(-1)).toBe('MAX');
    expect(hatchTierOptions('itemIn')[0]).toBe('ULV');
  });
});

describe('unmatched hatch tiers', () => {
  it('counts keys that name no hatch of the build', () => {
    const hatches = [{ kind: 'itemIn' as const }, { kind: 'fluidIn' as const }];
    expect(unmatchedHatchTiers(undefined, hatches)).toBe(0);
    expect(unmatchedHatchTiers({ 'itemIn:0': 'EV', 'fluidIn:0': 'LV' }, hatches)).toBe(0);
    expect(unmatchedHatchTiers({ 'itemIn:1': 'EV', 'fluidIn:0': 'LV', 'energy:0': 'HV' }, hatches)).toBe(2);
  });
});

describe('picking a hatch block', () => {
  const placed = [
    { kind: 'itemIn' as const, cell: [1, 0, 0] as [number, number, number] },
    { kind: 'energy' as const, cell: [2, 0, 0] as [number, number, number] },
    { kind: 'itemIn' as const, cell: [3, 1, 0] as [number, number, number] },
  ];

  it('maps a clicked cell to the key of the hatch on it', () => {
    expect(hatchKeyAt(placed, [3, 1, 0])).toBe('itemIn:1');
    expect(hatchKeyAt(placed, [2, 0, 0])).toBe('energy:0');
    expect(hatchKeyAt(placed, [9, 9, 9])).toBeNull();
  });

  it('maps a key back to the cell to highlight', () => {
    expect(hatchCellsOf(placed, 'itemIn:1')).toEqual([[3, 1, 0]]);
    expect(hatchCellsOf(placed, 'itemIn:7')).toEqual([]);
  });
});

describe('a picked hatch after a rebuild', () => {
  const cell = (x: number): [number, number, number] => [x, 0, 0];
  it('holds only while the hatch on its cell has the same key', () => {
    const before = [
      { kind: 'itemIn' as const, cell: cell(1) },
      { kind: 'energy' as const, cell: cell(2) },
    ];
    const pick = { key: 'energy:0', cell: cell(2) };
    expect(hatchPickHolds(before, pick)).toBe(true);
    expect(hatchPickHolds([{ kind: 'itemIn', cell: cell(2) }, ...before.slice(1, 1)], pick)).toBe(false);
    expect(hatchPickHolds([{ kind: 'energy', cell: cell(5) }], pick)).toBe(false);
  });
});
