import type { Dir, Tier, Vec3 } from '../core/types';
import type { HatchKind, PlanLimits, Unit } from '../multiblock/types';

/** A machine plan and what building it produces: packed units, placed hatches, shared walls. */

/**
 * How units may share walls. `auto` (the default, stored as absent) tries everything the multiblock allows;
 * the others restrict the contact to one side or turn sharing off. Append only: share links store the index.
 */
export const WALLSHARE_MODES = ['auto', 'side', 'stack', 'back', 'separate'] as const;
export type WallshareMode = (typeof WALLSHARE_MODES)[number];

/**
 * Hatch tier overrides, keyed by an identity that never depends on positions: `"<kind>:<ordinal>"` in the
 * machine view (ordinal among hatches of that kind, from 0); in a template group
 * `"<kind>:<resource>:<unit index>"` or `"<kind>:<resource>:shared"`.
 */
export type HatchTiers = Record<string, Tier>;

/** Everything that defines a plan. Derived data is never stored. */
export interface PlanState {
  v: 1;
  multiblockId: string;
  count: number;
  limits: PlanLimits;
  enabledHatches: HatchKind[];
  /** Colour overrides, `#rrggbb`. */
  colors: Partial<Record<HatchKind, string>>;
  /** When set, units are placed exactly here instead of auto-packing. */
  manualUnits?: Unit[];
  /**
   * Size along the multiblock's `resize` axis (height / length). Only for resizable multiblocks; absent
   * means `resize.default`.
   */
  size?: number;
  /** Machine tier = tier of its energy hatches; absent = the planner's default. */
  tier?: Tier;
  /** Tier of single hatches that differ from `tier` (see `HatchTiers`). */
  hatchTiers?: HatchTiers;
  /** Every unit is built mirrored in X. Absent = not mirrored. */
  mirror?: boolean;
  /** Wall sharing mode; absent = `auto`. */
  wallshare?: WallshareMode;
}

export interface PackResult {
  units: Unit[];
  requested: number;
  placed: number;
  /** Why fewer than requested were placed. */
  reason?: 'limits' | 'geometry';
}

export interface HatchPlacement {
  kind: HatchKind;
  /** World cell occupied by the hatch block. */
  cell: Vec3;
  /** Outward face the hatch exposes (pipes attach here). */
  face: Dir;
  /** Units served by this hatch (length > 1 = shared). */
  unitIds: number[];
  /** Site view: id of the net (`RouteNet.id`) this hatch belongs to. */
  net?: number;
}

export interface HatchResult {
  hatches: HatchPlacement[];
  /** Requested hatches that could not be placed. */
  unplaced: { unitId: number; kind: HatchKind }[];
}

export interface WallStats {
  /** Unique blocks in the build, hatches and controllers included. */
  totalBlocks: number;
  /** Unique block counts by block id (hatch blocks under their hatch block id). */
  byBlock: Record<string, number>;
  controllers: number;
  hatches: number;
  /** Unit id pairs that share a full face contact with compatible blocks. */
  sharedWalls: [number, number][];
  /** Unit id pairs whose overlap is invalid (different blocks, controller/air overlap). */
  conflicts: [number, number][];
  /** World cells that are part of a conflict (for highlighting). */
  conflictCells: Vec3[];
  /** Blocks saved versus building every unit separately. */
  savedBlocks: number;
}
