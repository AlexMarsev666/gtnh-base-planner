import { describe, expect, it } from 'vitest';
import { getMultiblock } from '../../data/catalog';
import { countRules, minimumCasings, withRequiredAlternatives } from './rules';
import { hatchTiers } from '../../data/single-machines';
import type { HatchKind } from './types';

describe('RC2 rules independently of shape hints', () => {
  it('keeps any-input and any-output requirements as alternatives for the blast furnace', () => {
    const def = getMultiblock('electric-blast-furnace')!;
    expect(countRules(def.id)).toContainEqual(
      expect.objectContaining({ helper: 'checkHasAnyInput', anyOf: ['itemIn', 'fluidIn'], min: 1 }),
    );
    const enabled: HatchKind[] = ['fluidIn', 'itemOut', 'energy'];
    const resolved = withRequiredAlternatives(def, enabled);
    expect(resolved.requiredHatches?.fluidIn?.min).toBeGreaterThanOrEqual(1);
    expect(enabled).not.toContain('itemIn');
    const empty: HatchKind[] = ['energy'];
    withRequiredAlternatives(def, empty);
    expect(empty).toContain('itemIn');
    expect(empty).toContain('itemOut');
  });

  it('preserves the oil cracker maintenance minimum and exact maintenance limits where required', () => {
    const def = getMultiblock('oil-cracking-unit')!;
    expect(def.requiredHatches?.maintenance).toMatchObject({ min: 1 });
    expect(getMultiblock('large-naquadah-reactor')!.requiredHatches?.maintenance).toMatchObject({
      min: 1,
      max: 1,
    });
    expect(minimumCasings(def)).toBe(18);
    expect(minimumCasings(getMultiblock('large-chemical-reactor')!)).toBe(8);
  });

  it('offers actual standard hatch variants registered in RC2', () => {
    expect(hatchTiers('itemIn')).toEqual(['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV']);
    expect(hatchTiers('itemOut')).not.toContain('UEV');
    expect(hatchTiers('fluidIn')).toContain('MAX');
    expect(hatchTiers('energy')).toContain('UXV');
    expect(hatchTiers('energy')).not.toContain('MAX');
  });
});
