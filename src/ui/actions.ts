import { getMultiblock } from '../data/catalog';
import { minimumGlassTier } from '../model/multiblock/glass';
import { effectiveSize } from '../model/resize';
import type { HatchKind, PlanLimits } from '../model/multiblock/types';
import type { PlanState } from '../model/plan/types';
import { defaultPlan, plan, selectedUnits } from '../state/store';
import { clampCount } from './fields';
import { isVoltageTier } from '../model/tiers';

export function withVoltageTier(p: PlanState, tier: string): PlanState {
  if (tier === '') {
    const next = { ...p };
    delete next.voltageTier;
    return next;
  }
  return isVoltageTier(tier) && p.voltageTier !== tier ? { ...p, voltageTier: tier } : p;
}

export function withManualTransformerMode(p: PlanState, mode: string): PlanState {
  return (mode === 'up' || mode === 'down') && mode !== p.manualTransformerMode
    ? { ...p, manualTransformerMode: mode }
    : p;
}

export function withStructureGlassTier(p: PlanState, tier: string): PlanState {
  if (tier === '') {
    const next = { ...p };
    delete next.structureGlassTier;
    return next;
  }
  return isVoltageTier(tier) && p.structureGlassTier !== tier ? { ...p, structureGlassTier: tier } : p;
}

/** A physical shared hatch edits all logical assignments together. */
export function withIndividualHatchTier(
  p: PlanState,
  assignments: readonly string[],
  value: string,
): PlanState {
  if (value !== '' && !isVoltageTier(value)) return p;
  const hatchTiers = { ...p.hatchTiers };
  for (const key of assignments) {
    if (isVoltageTier(value)) hatchTiers[key] = value;
    else delete hatchTiers[key];
  }
  return { ...p, hatchTiers };
}

/* Pure plan transforms (tested) + thin store wrappers used by the components. */

function withoutManual(p: PlanState): PlanState {
  const next = { ...p };
  delete next.manualUnits;
  return next;
}

/** New count (clamped). A manual layout is dropped so the new count is auto-packed. */
export function withCount(p: PlanState, n: number): PlanState {
  const count = clampCount(n);
  if (count === p.count && !p.manualUnits) return p;
  return { ...withoutManual(p), count };
}

/** New limit for one axis. Like the count, it re-packs, so a manual layout is dropped. */
export function withLimit(p: PlanState, axis: keyof PlanLimits, value: number | null): PlanState {
  if (p.limits[axis] === value) return p;
  return { ...withoutManual(p), limits: { ...p.limits, [axis]: value } };
}

/**
 * New height / length for a resizable multiblock, snapped to a size it can take. Units change shape, so a
 * manual layout is dropped. Plans of fixed-size multiblocks are returned unchanged.
 */
export function withSize(p: PlanState, n: number): PlanState {
  const def = getMultiblock(p.multiblockId);
  const size = def ? effectiveSize(def, n) : undefined;
  if (size === undefined || (size === (p.size ?? def?.resize?.default) && !p.manualUnits)) return p;
  return { ...withoutManual(p), size };
}

/**
 * Switch multiblock: keep count, limits and colours; take the new default hatches and size; drop manual
 * units.
 */
export function withMultiblock(p: PlanState, id: string): PlanState {
  if (p.multiblockId === id) return p;
  const def = getMultiblock(id);
  if (!def) return p;
  const next: PlanState = { ...withoutManual(p), multiblockId: id, enabledHatches: [...def.defaultHatches] };
  delete next.size;
  delete next.hatchTiers;
  delete next.manualTransformerMode;
  delete next.dataBankWireless;
  delete next.assemblyGrowth;
  delete next.steamFrameTier;
  delete next.structureGlassTier;
  if (minimumGlassTier(def)) next.structureGlassTier = minimumGlassTier(def);
  return next;
}

export function withHatchToggled(p: PlanState, kind: HatchKind): PlanState {
  const on = p.enabledHatches.includes(kind);
  return {
    ...p,
    enabledHatches: on ? p.enabledHatches.filter((k) => k !== kind) : [...p.enabledHatches, kind],
  };
}

export function withHatchColor(p: PlanState, kind: HatchKind, color: string): PlanState {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return p;
  return { ...p, colors: { ...p.colors, [kind]: color.toLowerCase() } };
}

export function withDefaultColors(p: PlanState): PlanState {
  return Object.keys(p.colors).length ? { ...p, colors: {} } : p;
}

// Store wrappers

export const setCount = (n: number) => plan.update((p) => withCount(p, n));
export const setSize = (n: number) => plan.update((p) => withSize(p, n));
export const setLimit = (axis: keyof PlanLimits, v: number | null) =>
  plan.update((p) => withLimit(p, axis, v));
export const toggleHatch = (k: HatchKind) => plan.update((p) => withHatchToggled(p, k));
export const setHatchColor = (k: HatchKind, c: string) => plan.update((p) => withHatchColor(p, k, c));
export const resetColors = () => plan.update(withDefaultColors);
export const setVoltageTier = (tier: string) => plan.update((p) => withVoltageTier(p, tier));
export const setManualTransformerMode = (mode: string) =>
  plan.update((p) => withManualTransformerMode(p, mode));
export const setDataBankWireless = (on: boolean) =>
  plan.update((p) => (p.multiblockId === 'data-bank' ? { ...p, dataBankWireless: on } : p));
export function setSteamFrameTier(frame: 'bronze' | 'steel') {
  plan.update((p) => (p.multiblockId === 'water-pump' ? { ...p, steamFrameTier: frame } : p));
}

export const setAssemblyGrowth = (growth: 'left' | 'right') =>
  plan.update((p) => (p.multiblockId === 'circuit-assembly-line' ? { ...p, assemblyGrowth: growth } : p));
export const setStructureGlassTier = (tier: string) => plan.update((p) => withStructureGlassTier(p, tier));
export const setIndividualHatchTier = (assignments: readonly string[], tier: string) =>
  plan.update((p) => withIndividualHatchTier(p, assignments, tier));

export function selectMultiblock(id: string): void {
  selectedUnits.set([]);
  plan.update((p) => withMultiblock(p, id));
}

/** Reset to the default plan of the current multiblock. */
export function resetPlan(): void {
  selectedUnits.set([]);
  plan.update((p) => defaultPlan(getMultiblock(p.multiblockId) ? p.multiblockId : undefined));
}
