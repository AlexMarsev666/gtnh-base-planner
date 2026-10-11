import { describe, expect, it } from 'vitest';
import { hatchTierOptions, hatchTierRows, unmatchedHatchTiers } from './hatchTierRows';

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
