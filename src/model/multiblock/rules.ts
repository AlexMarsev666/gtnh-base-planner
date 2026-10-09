import type { MultiblockDef } from './types';
import type { HatchKind, HatchRequirement } from './types';
import type { Unit } from './types';
import type { HatchPlacement } from '../plan/types';
import sourceCounts from '../../data/constraints.runtime.generated.json' with { type: 'json' };
import sourceCasings from '../../data/casings.runtime.generated.json' with { type: 'json' };
import steamPump from '../../data/steam-water-pump.rc2.generated.json';
import { fixedHatchCounts, fixedHatchKinds } from './fixedHatches';
import { dataInterfaceCountRules } from './dataInterfaces';
import { computationCountRules } from './computation';

export const RC2_RULES_VERSION = 'GTNH-2.9.0-RC-2/GT5U-5.09.54.205';
const RC2_SOURCE =
  'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/src/main/java/';

/** Rules reviewed against checkMachine, adders and resource processing, independently of shape hints. */
export const REVIEWED_RULES = {
  'water-pump': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/steam/MTESteamWaterPump.java',
    minCasings: steamPump.minimumCasings,
    blocks: ['gregtech:gt.blockcasings9@2'],
  },
  'cryogenic-freezer': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTECryogenicFreezer.java',
    minCasings: 46,
    blocks: ['miscutils:gtplusplus.blockcasings.3@10'],
  },
  volcanus: {
    source:
      RC2_SOURCE +
      'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/advanced/MTEAdvEBF.java',
    minCasings: 6,
    blocks: ['miscutils:gtplusplus.blockcasings.3@11'],
  },
  'large-heat-exchanger': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEHeatExchanger.java',
    minCasings: 20,
    blocks: ['gt.casing.stableTitanium'],
  },
  'oil-cracking-unit': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEOilCracker.java',
    minCasings: 18,
  },
  'large-chemical-reactor': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTELargeChemicalReactor.java',
    minCasings: 8,
  },
  'distillation-tower': {
    source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEDistillationTower.java',
    minCasings: (def: MultiblockDef) => 7 * def.size[1] - 5,
  },
  'exxonmobil-chemical-plant': {
    source:
      RC2_SOURCE +
      'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/production/chemplant/MTEChemicalPlant.java',
    minCasings: 70,
  },
  'reactor-fuel-processing-plant': {
    source:
      RC2_SOURCE + 'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/production/MTERefinery.java',
    minCasings: 7,
    blocks: ['miscutils:gtplusplus.blockcasings.2@2'],
  },
  'nuclear-salt-processing-plant': {
    source:
      RC2_SOURCE +
      'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/MTENuclearSaltProcessingPlant.java',
    minCasings: 1,
    blocks: ['miscutils:gtplusplus.blockspecialcasings.1@8'],
  },
} as const;

export function minimumCasings(def: MultiblockDef): number | undefined {
  const rule = REVIEWED_RULES[def.id as keyof typeof REVIEWED_RULES];
  return rule
    ? typeof rule.minCasings === 'function'
      ? rule.minCasings(def)
      : rule.minCasings
    : (sourceCasings as Record<string, CasingRule[]>)[def.id]?.[0]?.min;
}

export interface CasingRule {
  blocks: readonly string[];
  min: number;
  /** Fixed decoration using the same block does not increment the source counter. */
  hatchableOnly?: boolean;
}
/** Each counter has its own block set: fixed pipe casings must not be counted as outer shells. */
export function casingRules(def: MultiblockDef): readonly CasingRule[] {
  const generated = (sourceCasings as Record<string, CasingRule[]>)[def.id];
  if (generated) return generated;
  const min = minimumCasings(def);
  const reviewed = REVIEWED_RULES[def.id as keyof typeof REVIEWED_RULES];
  return min === undefined
    ? []
    : [
        {
          min,
          blocks:
            reviewed && 'blocks' in reviewed
              ? reviewed.blocks
              : [
                  ...new Set(
                    Object.values(def.legend)
                      .filter((cell) => cell.hatches?.length)
                      .map((cell) => cell.blockId),
                  ),
                ],
        },
      ];
}

export interface SourceCountRule {
  kind?: HatchKind;
  anyOf?: HatchKind[];
  min?: number;
  max?: number;
  source?: string;
  helper: string;
}
export function countRules(id: string): readonly SourceCountRule[] {
  const data = [...dataInterfaceCountRules(id), ...computationCountRules(id)];
  const generated = ((sourceCounts as Record<string, SourceCountRule[]>)[id] ?? []).map((rule) =>
    id === 'industrial-arc-furnace' && rule.helper === 'checkHasAnyInput'
      ? { ...rule, anyOf: [...rule.anyOf!, 'electrodeBus' as const] }
      : rule,
  );
  return data.length ? [...generated, ...data] : generated;
}

/** Alternatives belong to each controller, including when its physical interface is shared. */
export function validateAlternativeCounts(
  def: MultiblockDef,
  units: readonly Unit[],
  hatches: readonly HatchPlacement[],
): string[] {
  const errors: string[] = [];
  for (const unit of units)
    for (const rule of countRules(def.id)) {
      if (!rule.anyOf) continue;
      const n = hatches.filter((h) => rule.anyOf!.includes(h.kind) && h.unitIds.includes(unit.id)).length;
      if (n < (rule.min ?? 0) || n > (rule.max ?? Infinity))
        errors.push(
          `Controller ${unit.id}: ${rule.anyOf.join(' or ')} count ${n}; RC2 requires ${rule.min ?? 0}–${rule.max ?? 'unlimited'} (${rule.helper}).`,
        );
    }
  return errors;
}

/** Adds only verified helper semantics. Shape generation and complex adapters remain separate. */
export function withSourceCounts(def: MultiblockDef): MultiblockDef {
  const counts = countRules(def.id);
  if (!counts.length) return def;
  const requiredHatches: Partial<Record<HatchKind, HatchRequirement>> = { ...def.requiredHatches };
  const initialized = new Set<HatchKind>();
  for (const rule of counts) {
    if (!rule.kind) continue;
    let old = requiredHatches[rule.kind];
    if (def.generated && !initialized.has(rule.kind)) {
      // Hologram-derived counts are defaults, not a proof of a minimum or an exact maximum.
      old = { ...old, min: 0 };
      delete old.max;
      initialized.add(rule.kind);
    }
    requiredHatches[rule.kind] = {
      ...old,
      min: Math.max(old?.min ?? 0, rule.min ?? 0),
      ...(rule.max === undefined ? {} : { max: Math.min(old?.max ?? Infinity, rule.max) }),
    };
  }
  return { ...def, requiredHatches };
}

/** Alternative resource interfaces stay alternatives: a fluid input satisfies "any input" without
 * forcing an item bus. Empty machines receive a structural filler interface of a permitted kind. */
export function withRequiredAlternatives(def: MultiblockDef, enabled: HatchKind[]): MultiblockDef {
  const requiredHatches = { ...def.requiredHatches };
  for (const rule of countRules(def.id)) {
    if (!rule.anyOf) continue;
    if (!(rule.min && rule.min > 0)) continue;
    const existing = rule.anyOf.find((kind) => enabled.includes(kind));
    const kind =
      existing ??
      rule.anyOf.find(
        (kind) =>
          def.hatchBlocks[kind] && Object.values(def.legend).some((cell) => cell.hatches?.includes(kind)),
      );
    if (!kind) continue;
    if (!enabled.includes(kind)) enabled.push(kind);
    const old = requiredHatches[kind];
    requiredHatches[kind] = {
      ...old,
      min: Math.max(old?.min ?? 0, rule.min ?? 0),
      ...(rule.max === undefined ? {} : { max: Math.min(old?.max ?? Infinity, rule.max) }),
    };
  }
  return { ...def, requiredHatches };
}

/** Defaults affect newly created plans only. A loaded plan retains its saved interfaces. */
export function withRequiredDefaults(def: MultiblockDef): MultiblockDef {
  const enabled = [...def.defaultHatches];
  for (const [kind, requirement] of Object.entries(def.requiredHatches ?? {}))
    if ((requirement.min ?? 0) > 0 && !enabled.includes(kind as HatchKind)) enabled.push(kind as HatchKind);
  for (const kind of Object.keys(fixedHatchCounts(def)) as HatchKind[])
    if (!enabled.includes(kind)) enabled.push(kind);
  for (const cell of Object.values(def.legend)) {
    const alternatives = fixedHatchKinds(def, cell);
    if (alternatives.length && !alternatives.some((kind) => enabled.includes(kind)))
      enabled.push(alternatives[0]);
  }
  withRequiredAlternatives(def, enabled);
  return { ...def, defaultHatches: enabled };
}
