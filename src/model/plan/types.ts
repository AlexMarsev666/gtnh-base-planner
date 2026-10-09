import type { Dir, Vec3 } from '../core/types';
import type { HatchKind, PlanLimits, Unit } from '../multiblock/types';
import type { VoltageTier } from '../tiers';

/** A machine plan and what building it produces: packed units, placed hatches, shared walls. */

/** Everything that defines a plan. Derived data is never stored. */
export interface PlanState {
  v: 1;
  /** Source game rules are distinct from the document version; absent in historical files. */
  rulesVersion?: string;
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
  voltageTier?: VoltageTier;
  manualTransformerMode?: 'up' | 'down';
  /** Data Bank screwdriver setting; absent in old documents means wireless transmission off. */
  dataBankWireless?: boolean;
  assemblyGrowth?: 'left' | 'right';
  /** Uniform Water Pump frame material, independent of hatch voltage. */
  steamFrameTier?: 'bronze' | 'steel';
  structureGlassTier?: VoltageTier;
  hatchTiers?: Record<string, VoltageTier>;
}

export interface PackResult {
  units: Unit[];
  requested: number;
  placed: number;
  /** Why fewer than requested were placed. */
  reason?: 'limits' | 'geometry';
}

export interface HatchPlacement {
  tier?: VoltageTier;
  assignments?: string[];
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
  /** Numeric per-controller demand/capacity explanations for an incomplete placement. */
  capacityProblems?: string[];
  /** Missing essential interfaces, then other structural prerequisites, before optional resources. */
  unplacedMandatory?: [number, number];
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
