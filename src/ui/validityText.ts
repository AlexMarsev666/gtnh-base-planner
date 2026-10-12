import { blockInfo } from '../data/blocks';
import { t } from '../i18n/en';
import { TIERS, type Tier, type Vec3 } from '../model/core/types';
import type { MultiblockDef } from '../model/multiblock/types';
import type { PlacedGroup } from '../model/site/buildTypes';
import { GROUP_STRIDE } from '../model/site/ids';
import { HIGHEST_TIER, effectiveGlassTier } from '../model/tiers';
import type { UnitValidity, ValidityProblem } from '../model/validity';

/** One problem of the buildability list. */
export interface ValidityLine {
  unitId: number;
  severity: ValidityProblem['severity'];
  /** "Unit 3: no energy hatch". */
  text: string;
  /** The hatch the problem is about, when it names one. */
  cell?: Vec3;
}

/** The block names of the legend chars a casing minimum counts, without repeats ("A or B"). */
export function casingNames(def: MultiblockDef, chars: readonly string[]): string {
  const names = chars.flatMap((c) => {
    const id = def.legend[c]?.blockId;
    return id === undefined ? [] : [blockInfo(id).name];
  });
  return [...new Set(names)].join(' or ');
}

/**
 * The problems as lines, errors first and then hints, each group in unit order. `unitIds` is the order of the
 * units, which numbers them from 1; ids not in it (stale) are skipped.
 */
export function validityLines(
  validity: UnitValidity | undefined,
  unitIds: readonly number[],
  def: MultiblockDef | undefined,
): { errors: ValidityLine[]; hints: ValidityLine[] } {
  const errors: ValidityLine[] = [];
  const hints: ValidityLine[] = [];
  unitIds.forEach((id, i) => {
    for (const p of validity?.[id] ?? []) {
      const casings = p.type === 'casings' && def ? casingNames(def, p.chars) : '';
      (p.severity === 'error' ? errors : hints).push({
        unitId: id,
        severity: p.severity,
        text: `${t.validity.unit(i + 1)}: ${t.validity.text(p, casings)}`,
        ...(p.type === 'forbiddenFace' ? { cell: p.cell } : {}),
      });
    }
  });
  return { errors, hints };
}

/** How many errors the validity holds. */
export function errorCount(validity: UnitValidity | undefined): number {
  return Object.values(validity ?? {}).reduce(
    (n, ps) => n + ps.filter((p) => p.severity === 'error').length,
    0,
  );
}

/**
 * The problems of a placed template group by global unit id: the build's (its own unit ids, shifted into the
 * group's range) and the glass tier problems, which are checked on the placed group.
 */
export function groupValidity(placed: Pick<PlacedGroup, 'build' | 'index' | 'glassValidity'>): UnitValidity {
  const out: UnitValidity = {};
  for (const [id, ps] of Object.entries(placed.build?.validity ?? {}))
    out[placed.index * GROUP_STRIDE + Number(id)] = [...ps];
  for (const [id, ps] of Object.entries(placed.glassValidity ?? {})) (out[Number(id)] ??= []).push(...ps);
  return out;
}

/**
 * Choices of the glass tier picker: the glass the machine draws (empty value) and the tiers tiered glass has (HV
 * up). A `current` tier outside them (an old link) is kept so the select is not blank.
 */
export function glassChoices(
  def: MultiblockDef,
  current: Tier | undefined,
): { value: string; label: string }[] {
  const drawn = effectiveGlassTier(def);
  const tiers = TIERS.slice(TIERS.indexOf('HV'), TIERS.indexOf(HIGHEST_TIER) + 1);
  return [
    { value: '', label: drawn ? t.validity.glassDrawn(drawn) : t.defaultTier },
    ...(current && !tiers.includes(current) ? [{ value: current, label: current }] : []),
    ...tiers.map((x) => ({ value: x, label: x })),
  ];
}
