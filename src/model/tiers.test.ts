import { describe, expect, it } from 'vitest';
import { catalog, getMultiblock } from '../data/catalog';
import { PLACEHOLDER_DEF, SINGLE_BLOCK_DEF } from '../data/generic';
import { validateHatchTiers } from '../share/codec';
import { TIERS } from './core/types';
import {
  allowedTiers,
  groupHatchKey,
  groupKey,
  hatchTier,
  planHatchKey,
  planHatchKeys,
  tierByName,
  tierRange,
} from './tiers';

describe('allowedTiers', () => {
  it('offers nothing for steam machines and machines without energy hatches', () => {
    expect(allowedTiers(getMultiblock('coke-oven')!)).toEqual([]);
    expect(allowedTiers(getMultiblock('bricked-blast-furnace')!)).toEqual([]);
    for (const def of catalog) {
      if (def.tier === 'Steam') expect(allowedTiers(def), def.id).toEqual([]);
      const energy = def.hatchBlocks.energy !== undefined || def.hatchBlocks.dynamo !== undefined;
      if (!energy) expect(allowedTiers(def), def.id).toEqual([]);
    }
  });

  it('starts at the tier tag when it names a voltage, else at LV, and ends at UXV, the highest tier with energy hatches', () => {
    const asm = allowedTiers(getMultiblock('assembly-line')!);
    expect(asm[0]).toBe('LuV');
    expect(asm.at(-1)).toBe('UXV');
    const ebf = getMultiblock('electric-blast-furnace')!;
    expect(ebf.tier).toBeUndefined();
    expect(allowedTiers(ebf)).toEqual(tierRange('LV', 'UXV'));
    for (const def of catalog) {
      const tiers = allowedTiers(def);
      if (tiers.length === 0) continue;
      expect(tiers, def.id).toEqual(tierRange(tierByName(def.tier) ?? 'LV', 'UXV'));
    }
  });

  it('takes the tiers GT registers for a known single-block machine, and any from LV otherwise', () => {
    expect(allowedTiers(SINGLE_BLOCK_DEF)).toEqual(tierRange('LV', 'UXV'));
    expect(allowedTiers(SINGLE_BLOCK_DEF, 'nonsense')).toEqual(tierRange('LV', 'UXV'));
    expect(allowedTiers(SINGLE_BLOCK_DEF, 'pump')).toEqual(['LV', 'MV', 'HV']);
    expect(allowedTiers(SINGLE_BLOCK_DEF, 'macerator')).toEqual(tierRange('LV', 'UMV'));
    expect(allowedTiers(PLACEHOLDER_DEF)).toEqual(tierRange('LV', 'UXV'));
    // The machine means nothing on a multiblock.
    expect(allowedTiers(getMultiblock('assembly-line')!, 'pump')[0]).toBe('LuV');
  });
});

describe('tier names', () => {
  it('finds a tier by name in any case', () => {
    expect(tierByName('luv')).toBe('LuV');
    expect(tierByName(' HV ')).toBe('HV');
    expect(tierByName('Steam')).toBeUndefined();
    expect(tierByName(undefined)).toBeUndefined();
    expect(tierRange('HV', 'IV')).toEqual(['HV', 'EV', 'IV']);
    expect(tierRange('ULV', 'MAX')).toEqual([...TIERS]);
  });
});

describe('hatch tier keys', () => {
  it('counts the ordinal per kind in placement order', () => {
    const kinds = ['itemIn', 'energy', 'itemIn', 'fluidIn', 'itemIn', 'energy'] as const;
    expect(planHatchKeys(kinds.map((kind) => ({ kind })))).toEqual([
      'itemIn:0',
      'energy:0',
      'itemIn:1',
      'fluidIn:0',
      'itemIn:2',
      'energy:1',
    ]);
  });

  it('builds keys the codecs accept', () => {
    expect(validateHatchTiers({ [planHatchKey('itemOut', 3)]: 'HV' }, 'x')).toEqual({ 'itemOut:3': 'HV' });
    // A template key does not fit a machine plan.
    expect(() => validateHatchTiers({ [groupHatchKey('itemIn', 'iron', 0)]: 'HV' }, 'x')).toThrow();
    expect(groupHatchKey('fluidIn', 'fluid:water', 'shared')).toBe('fluidIn:fluid:water:shared');
    expect(groupHatchKey('itemIn', 'item:iron', 2)).toBe('itemIn:item:iron:2');
    expect(groupKey('energy', 1, 'power')).toBe('energy:1');
    expect(groupKey('muffler', 0)).toBe('muffler:0');
    expect(groupKey('itemIn', 0, 'item:iron', 2)).toBe('itemIn:item:iron:2');
  });
});

describe('hatchTier', () => {
  it('follows the machine for energy and dynamo hatches only, and an override wins', () => {
    const own = { 'energy:1': 'IV', 'itemIn:0': 'HV' } as const;
    expect(hatchTier('energy', 'energy:0', 'EV', own)).toBe('EV');
    expect(hatchTier('energy', 'energy:1', 'EV', own)).toBe('IV');
    expect(hatchTier('dynamo', 'dynamo:0', 'EV')).toBe('EV');
    expect(hatchTier('itemIn', 'itemIn:0', 'EV', own)).toBe('HV');
    expect(hatchTier('itemIn', 'itemIn:1', 'EV', own)).toBeUndefined();
    expect(hatchTier('energy', 'energy:0')).toBeUndefined();
    // No MAX energy or dynamo hatch exists.
    expect(hatchTier('energy', 'energy:0', 'MAX')).toBe('UXV');
    expect(hatchTier('dynamo', 'dynamo:0', 'LV', { 'dynamo:0': 'MAX' })).toBe('UXV');
    expect(hatchTier('itemIn', 'itemIn:0', 'LV', { 'itemIn:0': 'MAX' })).toBe('MAX');
    expect(hatchTier('itemIn', 'constructor', 'EV', {})).toBeUndefined();
  });
});
