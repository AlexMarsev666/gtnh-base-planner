import { describe, expect, it } from 'vitest';
import { t } from '../i18n/en';
import type { MultiblockDef } from '../model/multiblock/types';
import { GROUP_STRIDE } from '../model/site/ids';
import type { ValidityProblem } from '../model/validity';
import { statsParts } from './statsText';
import type { PipelineResult } from './pipeline';
import {
  casingNames,
  errorCount,
  glassChoices,
  groupErrorCount,
  groupValidity,
  validityLines,
} from './validityText';

const def = {
  legend: {
    a: { blockId: 'gt.casing.heatProof' },
    b: { blockId: 'gt.casing.frostProof' },
    g: { blockId: 'bartworks:BW_TieredGlass@0' },
  },
  glassTierLimits: { kinds: ['energy'], chars: ['g'] },
} as unknown as MultiblockDef;

const err = (p: object): ValidityProblem => ({ ...p, severity: 'error' }) as ValidityProblem;
const text = (p: ValidityProblem, casings = '') => t.validity.text(p, casings);

describe('validity text', () => {
  it('words every problem kind', () => {
    expect(text(err({ type: 'missingEnergy', have: 0, min: 1 }))).toBe('no energy hatch');
    expect(text(err({ type: 'missingEnergy', have: 1, min: 2 }))).toBe('1 of 2 energy hatches');
    expect(text(err({ type: 'missingMaintenance', have: 0, min: 1 }))).toBe('no maintenance hatch');
    expect(text(err({ type: 'hatchCount', kind: 'muffler', have: 0, min: 1 }))).toBe(
      '0 muffler hatches, GT needs 1',
    );
    expect(text(err({ type: 'hatchCount', kind: 'muffler', have: 3, max: 2 }))).toBe(
      '3 muffler hatches, GT allows 2',
    );
    expect(text(err({ type: 'requiredAny', kinds: ['itemIn', 'fluidIn'], have: 0, min: 1 }))).toBe(
      '0 of 1 needed hatches (item in or fluid in)',
    );
    expect(text(err({ type: 'casings', chars: ['a'], have: 14, min: 18 }), 'Clean Casing')).toBe(
      'Clean Casing (14 left after hatches, GT needs at least 18)',
    );
    expect(text(err({ type: 'glassTier', kind: 'energy', hatchTier: 'IV', glassTier: 'HV' }))).toBe(
      'energy hatch IV is above the glass (HV)',
    );
    const hint = text({
      type: 'forbiddenFace',
      kind: 'fluidIn',
      cell: [0, 0, 0],
      face: 'down',
      severity: 'hint',
    });
    expect(hint).toContain('Fluid in hatch faces bottom');
    expect(hint).toContain('the machine still forms');
  });

  it('names the counted casing blocks once each', () => {
    expect(casingNames(def, ['a', 'b', 'a'])).toBe('Heat Proof Machine Casing or Frost Proof Machine Casing');
    expect(casingNames(def, ['?'])).toBe('');
  });

  it('numbers units by position, errors before hints, and skips unknown units', () => {
    const hint: ValidityProblem = {
      type: 'forbiddenFace',
      kind: 'itemIn',
      cell: [1, 2, 3],
      face: 'up',
      severity: 'hint',
    };
    const lines = validityLines(
      {
        7: [hint, err({ type: 'missingEnergy', have: 0, min: 1 })],
        4: [err({ type: 'casings', chars: ['a'], have: 1, min: 2 })],
        99: [err({ type: 'missingEnergy', have: 0, min: 1 })],
      },
      [4, 7],
      def,
    );
    expect(lines.errors.map((l) => l.text)).toEqual([
      'Unit 1: Heat Proof Machine Casing (1 left after hatches, GT needs at least 2)',
      'Unit 2: no energy hatch',
    ]);
    expect(lines.hints).toHaveLength(1);
    expect(lines.hints[0]).toMatchObject({ unitId: 7, cell: [1, 2, 3] });
    expect(validityLines(undefined, [1], def)).toEqual({ errors: [], hints: [] });
  });

  it('counts only errors', () => {
    expect(errorCount(undefined)).toBe(0);
    expect(
      errorCount({
        1: [err({ type: 'missingEnergy', have: 0, min: 1 }), { ...hintOf(), severity: 'hint' }],
      }),
    ).toBe(1);
  });

  it('joins a group build and its glass problems under global unit ids', () => {
    const glass = err({ type: 'glassTier', kind: 'energy', hatchTier: 'IV', glassTier: 'HV' });
    const own = err({ type: 'missingEnergy', have: 0, min: 1 });
    const joined = groupValidity({
      index: 2,
      build: { validity: { 0: [own] } } as never,
      glassValidity: { [2 * GROUP_STRIDE]: [glass], [2 * GROUP_STRIDE + 1]: [glass] },
    });
    expect(joined[2 * GROUP_STRIDE]).toEqual([own, glass]);
    expect(joined[2 * GROUP_STRIDE + 1]).toEqual([glass]);
    expect(groupValidity({ index: 0 })).toEqual({});
  });

  it('counts the errors that keep a placed group from forming', () => {
    const glass = err({ type: 'glassTier', kind: 'energy', hatchTier: 'IV', glassTier: 'HV' });
    const own = err({ type: 'missingEnergy', have: 0, min: 1 });
    expect(groupErrorCount(undefined)).toBe(0);
    expect(groupErrorCount({ index: 1 })).toBe(0);
    expect(
      groupErrorCount({
        index: 1,
        build: { validity: { 0: [own], 1: [own, { ...own, severity: 'hint' }] } } as never,
        glassValidity: { [GROUP_STRIDE]: [glass] },
      }),
    ).toBe(3);
  });

  it('offers the drawn glass tier first, then the tiers', () => {
    const choices = glassChoices(def, undefined);
    expect(choices[0]).toEqual({ value: '', label: 'HV (drawn)' });
    expect(choices.map((c) => c.value)).toContain('EV');
    expect(choices.map((c) => c.value)).not.toContain('LV');
    expect(glassChoices(def, 'LV').map((c) => c.value)).toContain('LV');
  });

  it('adds the verdict to the stats line only when something would not form', () => {
    const base = { pack: { placed: 1, units: [] } } as unknown as PipelineResult;
    expect(statsParts(base, []).main).not.toContain(t.validity.wontForm(1));
    const bad = { ...base, validity: { 0: [err({ type: 'missingEnergy', have: 0, min: 1 })] } };
    expect(statsParts(bad, []).main).toContain(t.validity.wontForm(1));
  });
});

function hintOf() {
  return { type: 'forbiddenFace', kind: 'itemIn', cell: [0, 0, 0], face: 'up' } as const;
}
