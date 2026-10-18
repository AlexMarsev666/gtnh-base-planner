import { glassBlockTier } from '../data/glass-tiers';
import { PLACEHOLDER_ID, SINGLE_BLOCK_ID } from '../data/generic';
import { singleMachineTiers } from '../data/single-machines';
import { TIERS, type Tier } from './core/types';
import type { HatchKind, MultiblockDef } from './multiblock/types';
import type { HatchPlacement } from './plan/types';

/**
 * Voltage tiers of a machine and its hatches. The machine tier sets the tier of its energy (or dynamo)
 * hatches; every other hatch can be given a tier of its own (`HatchTiers`, keyed as below).
 */

/** The tier a new plan starts with when none is set: the lowest one a multiblock normally runs on. */
export const DEFAULT_TIER: Tier = 'LV';

/**
 * The highest tier GT has energy and dynamo hatches for: UXV (the MAX hatch is a debug item). `TIERS` is
 * lowest first.
 */
export const HIGHEST_TIER: Tier = 'UXV';

/** Hatch kinds whose tier is the machine's tier unless overridden. */
export function followsMachineTier(kind: HatchKind): boolean {
  return kind === 'energy' || kind === 'dynamo';
}

/**
 * Hatch kinds of a template group whose tier is the group's tier unless overridden: the energy and dynamo hatches,
 * and the buses and input hatches that hold several items or fluids (their tier sets how many).
 */
export function followsGroupTier(kind: HatchKind): boolean {
  return followsMachineTier(kind) || kind === 'itemIn' || kind === 'itemOut' || kind === 'fluidIn';
}

/** The tier from which an input hatch is a Quadruple Input Hatch (four fluids). */
export const QUAD_TIER: Tier = 'EV';

/**
 * How many items or fluids one hatch of `kind` at `tier` serves: a bus has (tier + 1)^2 slots (ULV 1 ... UHV 100,
 * the highest bus GT has), a Quadruple Input Hatch (fluidIn from EV) four fluids, any other hatch one.
 */
export function hatchCapacity(kind: HatchKind, tier: Tier): number {
  const at = TIERS.indexOf(tier);
  if (kind === 'itemIn' || kind === 'itemOut') return (Math.min(at, TIERS.indexOf('UHV')) + 1) ** 2;
  if (kind === 'fluidIn') return at >= TIERS.indexOf(QUAD_TIER) ? 4 : 1;
  return 1;
}

/** Hatch kinds a template key identifies by ordinal only (no resource). */
export function hasNoResource(kind: HatchKind): boolean {
  return kind === 'energy' || kind === 'dynamo' || kind === 'maintenance' || kind === 'muffler';
}

/** The tier a name or tag stands for ("HV", "LuV", any case), or undefined (e.g. "Steam"). */
export function tierByName(name: string | undefined): Tier | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  return TIERS.find((t) => t.toLowerCase() === lower);
}

/** The tiers from `from` to `to`, both included. */
export function tierRange(from: Tier, to: Tier): Tier[] {
  return TIERS.slice(TIERS.indexOf(from), TIERS.indexOf(to) + 1);
}

/** Whether a machine runs on EU at all: its structure takes energy or dynamo hatches. */
function usesEnergy(def: MultiblockDef): boolean {
  if (def.id === SINGLE_BLOCK_ID || def.id === PLACEHOLDER_ID) return true;
  return def.hatchBlocks.energy !== undefined || def.hatchBlocks.dynamo !== undefined;
}

/**
 * The tiers a machine can be set to, derived from its definition without per-machine lists:
 * - none for steam machines (`tier` tag "Steam") and anything without an energy or dynamo hatch;
 * - otherwise from the `tier` tag as the minimum when it names a voltage (the Assembly Line wants LuV,
 *   so nothing below), else from LV, up to the highest tier GT has energy hatches for (UXV).
 * A single-block machine with a known `machine` (src/data/single-machines.json) takes the tiers GT registers
 * for it instead.
 */
export function allowedTiers(def: MultiblockDef, machine?: string): Tier[] {
  if (def.tier?.trim().toLowerCase() === 'steam' || !usesEnergy(def)) return [];
  if (def.id === SINGLE_BLOCK_ID && machine) {
    const own = singleMachineTiers(machine);
    if (own.length > 0) return own;
  }
  return tierRange(tierByName(def.tier) ?? DEFAULT_TIER, HIGHEST_TIER);
}

/** Key of a hatch in `HatchTiers` of a machine plan: its ordinal among the hatches of its kind. */
export function planHatchKey(kind: HatchKind, ordinal: number): string {
  return `${kind}:${ordinal}`;
}

/** Key of a hatch in `HatchTiers` of a template group with a resource: unit index or `shared`. */
export function groupHatchKey(kind: HatchKind, resource: string, unit: number | 'shared'): string {
  return `${kind}:${resource}:${unit}`;
}

/**
 * Key of a template group hatch: `<kind>:<ordinal>` for kinds without a resource (energy, dynamo,
 * maintenance, muffler), else `<kind>:<resource>:<unit|shared>`.
 */
export function groupKey(
  kind: HatchKind,
  ordinal: number,
  resource?: string,
  unit: number | 'shared' = 'shared',
): string {
  return hasNoResource(kind) || resource === undefined
    ? planHatchKey(kind, ordinal)
    : groupHatchKey(kind, resource, unit);
}

/** The `HatchTiers` key of each hatch, in the order given (ordinal counted per kind, from 0). */
export function planHatchKeys(hatches: readonly Pick<HatchPlacement, 'kind'>[]): string[] {
  const seen = new Map<HatchKind, number>();
  return hatches.map((h) => {
    const n = seen.get(h.kind) ?? 0;
    seen.set(h.kind, n + 1);
    return planHatchKey(h.kind, n);
  });
}

/**
 * The tier of one hatch: its own entry, else the machine tier for energy and dynamo hatches, else undefined
 * (any tier). Energy and dynamo hatches stop at UXV.
 */
export function hatchTier(
  kind: HatchKind,
  key: string,
  machineTier?: Tier,
  hatchTiers?: Record<string, Tier>,
  follows: (kind: HatchKind) => boolean = followsMachineTier,
): Tier | undefined {
  // Own-property check: keys come from share links.
  const own =
    hatchTiers && Object.prototype.hasOwnProperty.call(hatchTiers, key) ? hatchTiers[key] : undefined;
  const tier = own ?? (follows(kind) ? machineTier : undefined);
  // GT has no MAX energy or dynamo hatch; a MAX machine (a single block) uses the highest one there is.
  return tier && followsMachineTier(kind) && TIERS.indexOf(tier) > TIERS.indexOf(HIGHEST_TIER)
    ? HIGHEST_TIER
    : tier;
}

/**
 * The tier of the glass that limits the hatches of `def` (`glassTierLimits`): the one set on the plan or group,
 * else the lowest tiered glass the def draws at those legend chars. Undefined when the def has no such limit
 * or its glass has no known tier (no limit then).
 */
export function effectiveGlassTier(def: MultiblockDef, glassTier?: Tier): Tier | undefined {
  const limits = def.glassTierLimits;
  if (!limits) return undefined;
  if (glassTier) return glassTier;
  let lowest: Tier | undefined;
  for (const ch of limits.chars) {
    const blockId = def.legend[ch]?.blockId;
    const tier = blockId === undefined ? undefined : glassBlockTier(blockId);
    if (tier && (!lowest || TIERS.indexOf(tier) < TIERS.indexOf(lowest))) lowest = tier;
  }
  return lowest;
}
