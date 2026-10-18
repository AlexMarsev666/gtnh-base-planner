import { coilById } from '../data/coils';
import { getMultiblock } from '../data/catalog';
import { effectiveSize } from '../model/resize';
import type { HatchKind, PlanLimits } from '../model/multiblock/types';
import type { Tier } from '../model/core/types';
import type { PlanState, WallshareMode } from '../model/plan/types';
import { get } from 'svelte/store';
import { t } from '../i18n/en';
import { defaultPlan, plan, selectedUnits } from '../state/store';
import { clampCount } from './fields';
import { notify } from './notices';

/* Pure plan transforms (tested) + thin store wrappers used by the components. */

function withoutManual(p: PlanState): PlanState {
  const next = { ...p };
  delete next.manualUnits;
  return next;
}

/**
 * Hatch tiers are keyed by the hatch's number among its kind, in placement order, so anything that reshapes
 * the build would move them to other hatches. Those changes drop them (the setters say so).
 */
function withoutHatchTiers(p: PlanState): PlanState {
  if (!p.hatchTiers) return p;
  const next = { ...p };
  delete next.hatchTiers;
  return next;
}

/** New count (clamped). A manual layout is dropped so the new count is auto-packed. */
export function withCount(p: PlanState, n: number): PlanState {
  const count = clampCount(n);
  if (count === p.count && !p.manualUnits) return p;
  return { ...withoutHatchTiers(withoutManual(p)), count };
}

/** New limit for one axis. Like the count, it re-packs, so a manual layout is dropped. */
export function withLimit(p: PlanState, axis: keyof PlanLimits, value: number | null): PlanState {
  if (p.limits[axis] === value) return p;
  return { ...withoutHatchTiers(withoutManual(p)), limits: { ...p.limits, [axis]: value } };
}

/**
 * New height / length for a resizable multiblock, snapped to a size it can take. Units change shape, so a
 * manual layout is dropped. Plans of fixed-size multiblocks are returned unchanged.
 */
export function withSize(p: PlanState, n: number): PlanState {
  const def = getMultiblock(p.multiblockId);
  const size = def ? effectiveSize(def, n) : undefined;
  if (size === undefined || (size === (p.size ?? def?.resize?.default) && !p.manualUnits)) return p;
  return { ...withoutHatchTiers(withoutManual(p)), size };
}

/**
 * Switch multiblock: keep count, limits and colours; take the new default hatches and size; drop manual
 * units.
 */
export function withMultiblock(p: PlanState, id: string): PlanState {
  if (p.multiblockId === id) return p;
  const def = getMultiblock(id);
  if (!def) return p;
  const next: PlanState = {
    ...withoutHatchTiers(withoutManual(p)),
    multiblockId: id,
    enabledHatches: [...def.defaultHatches],
  };
  delete next.size;
  // The glass tier is a choice for that machine's glass.
  delete next.glassTier;
  // The heating coil is a choice for that machine's coils.
  delete next.coil;
  // The sharing options are hidden on a machine that cannot share walls, so they could not be cleared there.
  if (!def.wallshare) {
    delete next.shareMaintenance;
    delete next.shareEnergy;
  }
  return next;
}

export function withHatchToggled(p: PlanState, kind: HatchKind): PlanState {
  const on = p.enabledHatches.includes(kind);
  return {
    ...withoutHatchTiers(p),
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

/** Machine tier; undefined clears it ("Any"). */
export function withTier(p: PlanState, tier: Tier | undefined): PlanState {
  if (p.tier === tier) return p;
  const next = { ...p };
  if (tier) next.tier = tier;
  else delete next.tier;
  return next;
}

/** Tier of the glass that limits the hatches; undefined clears it (the multiblock's own glass). */
export function withGlassTier(p: PlanState, tier: Tier | undefined): PlanState {
  if (p.glassTier === tier) return p;
  const next = { ...p };
  if (tier) next.glassTier = tier;
  else delete next.glassTier;
  return next;
}

/** Heating coil (an id of `src/data/coils.ts`); undefined clears it (the multiblock's own coil). */
export function withPlanCoil(p: PlanState, coil: string | undefined): PlanState {
  if (p.coil === coil || (coil !== undefined && !coilById(coil))) return p;
  const next = { ...p };
  if (coil) next.coil = coil;
  else delete next.coil;
  return next;
}

/** Tier of one hatch (`planHatchKeys` key); undefined clears it ("Default"). */
export function withHatchTier(p: PlanState, key: string, tier: Tier | undefined): PlanState {
  if (p.hatchTiers?.[key] === tier) return p;
  const tiers = { ...p.hatchTiers };
  if (tier) tiers[key] = tier;
  else delete tiers[key];
  const next = { ...p };
  if (Object.keys(tiers).length) next.hatchTiers = tiers;
  else delete next.hatchTiers;
  return next;
}

export const withDefaultHatchTiers = withoutHatchTiers;

/** Mirror every unit. Units change shape, so a manual layout is dropped like for a new size. */
export function withMirror(p: PlanState, on: boolean): PlanState {
  if (!!p.mirror === on) return p;
  const next = withoutHatchTiers(withoutManual(p));
  if (on) next.mirror = true;
  else delete next.mirror;
  return next;
}

/** Wall sharing preference (`auto` clears it); it re-packs, so a manual layout is dropped. */
export function withWallshare(p: PlanState, mode: WallshareMode): PlanState {
  if ((p.wallshare ?? 'auto') === mode) return p;
  const next = withoutHatchTiers(withoutManual(p));
  if (mode === 'auto') delete next.wallshare;
  else next.wallshare = mode;
  return next;
}

/** One maintenance hatch may serve several units. Hatches change (tier keys with them), the layout stays. */
export function withShareMaintenance(p: PlanState, on: boolean): PlanState {
  if (!!p.shareMaintenance === on) return p;
  const next = { ...withoutHatchTiers(p) };
  if (on) next.shareMaintenance = true;
  else delete next.shareMaintenance;
  return next;
}

/** One energy hatch may serve two units. Hatches change (tier keys with them), the layout stays. */
export function withShareEnergy(p: PlanState, on: boolean): PlanState {
  if (!!p.shareEnergy === on) return p;
  const next = { ...withoutHatchTiers(p) };
  if (on) next.shareEnergy = true;
  else delete next.shareEnergy;
  return next;
}

// Store wrappers

/** Applies a transform that may drop the hatch tiers, and says so when it did. */
function reshape(fn: (p: PlanState) => PlanState): void {
  const before = get(plan);
  const after = fn(before);
  if (after === before) return;
  plan.set(after);
  if (before.hatchTiers && !after.hatchTiers) notify(t.hatchTiersReset, 5000, 'hatch-tiers');
}

export const setCount = (n: number) => reshape((p) => withCount(p, n));
export const setSize = (n: number) => reshape((p) => withSize(p, n));
export const setLimit = (axis: keyof PlanLimits, v: number | null) => reshape((p) => withLimit(p, axis, v));
export const toggleHatch = (k: HatchKind) => reshape((p) => withHatchToggled(p, k));
export const setHatchColor = (k: HatchKind, c: string) => plan.update((p) => withHatchColor(p, k, c));
export const setTier = (tier: Tier | undefined) => plan.update((p) => withTier(p, tier));
export const setGlassTier = (tier: Tier | undefined) => plan.update((p) => withGlassTier(p, tier));
export const setCoil = (coil: string | undefined) => plan.update((p) => withPlanCoil(p, coil));
export const setHatchTier = (key: string, tier: Tier | undefined) =>
  plan.update((p) => withHatchTier(p, key, tier));
export const resetHatchTiers = () => plan.update(withDefaultHatchTiers);
export const setMirror = (on: boolean) => reshape((p) => withMirror(p, on));
export const setShareMaintenance = (on: boolean) => reshape((p) => withShareMaintenance(p, on));
export const setShareEnergy = (on: boolean) => reshape((p) => withShareEnergy(p, on));
export const setWallshare = (mode: WallshareMode) => reshape((p) => withWallshare(p, mode));
export const resetColors = () => plan.update(withDefaultColors);

export function selectMultiblock(id: string): void {
  selectedUnits.set([]);
  reshape((p) => withMultiblock(p, id));
}

/** Reset to the default plan of the current multiblock. */
export function resetPlan(): void {
  selectedUnits.set([]);
  plan.update((p) => defaultPlan(getMultiblock(p.multiblockId) ? p.multiblockId : undefined));
}
