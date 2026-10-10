import type { CellRole, Dir, HorizontalDir, Rotation, Vec3 } from '../core/types';

/** Multiblock definitions, the units placed from them, and the hatch kinds they take. */

/**
 * Kinds of hatches/buses a multiblock can take. Coke Oven uses one hatch block in 3 modes. `steamIn` is the
 * steam input hatch of steam multiblocks, kept apart from `fluidIn` because both can be on one machine.
 */
export type HatchKind =
  'itemIn' | 'itemOut' | 'fluidIn' | 'fluidOut' | 'energy' | 'dynamo' | 'maintenance' | 'muffler' | 'steamIn';

/** One character of a structure drawing. */
export interface LegendEntry {
  /** Block id from `src/data/blocks.ts`. */
  blockId: string;
  /** Hatch kinds that may replace this block. Omitted = no hatches here. */
  hatches?: HatchKind[];
  /**
   * Sides (local frame) a hatch of the given kind must not face here, e.g. GT's `disallowOnly(UP, DOWN)`
   * for Distillation Tower layer outputs.
   */
  disallowFaces?: Partial<Record<HatchKind, Dir[]>>;
  /** Region this cell belongs to, for `HatchRequirement.regions` (e.g. one per Distillation Tower layer). */
  region?: string;
}

export interface HatchRequirement {
  min: number;
  max?: number;
  /**
   * Regions (see `LegendEntry.region`) that each need at least one hatch of this kind per unit, e.g. an
   * output hatch on every Distillation Tower layer, or Oil Cracker inputs on a side and in the middle.
   */
  regions?: string[];
}

/**
 * How a multiblock grows along one local axis (GT `beginVariableStructureBlock`), e.g. Distillation Tower
 * height or Assembly Line length. The JSON holds the smallest form (`size[axis] === min`), with one copy of
 * the repeating slab `[from, to)`; a size of `n` inserts `(n - min) / (to - from)` more copies right after
 * it (see `sizedDef` in `src/model/resize.ts`). A slab cell with a `region` gets a numbered region per copy
 * (`layer` -> `layer1`, `layer2`, ...), and `requiredHatches.*.regions` naming it expand to match.
 */
export interface ResizeRule {
  axis: 'x' | 'y' | 'z';
  /** First local index of the repeating slab. */
  from: number;
  /** One past its last local index. */
  to: number;
  /** Smallest and largest total size along `axis`; `min` is the size in the JSON. */
  min: number;
  max: number;
  /** Size a new plan starts with. */
  default: number;
  /** What the size is called in the UI. */
  label: 'height' | 'length';
}

/**
 * A multiblock definition (one JSON file in `src/data/multiblocks/`).
 *
 * `layers[y][z]` is a string of length `size[0]`; character `x` is the cell at local (x, y, z).
 * Reserved characters: `~` controller, `-` must stay air, ` ` (space) not part of the structure.
 * Every other character must be a key of `legend`.
 */
export interface MultiblockDef {
  id: string;
  name: string;
  /** Voltage tier or short tag shown in the picker, e.g. "LV", "Steam". */
  tier?: string;
  /** Link to the GT5-Unofficial (or other) source file the structure was transcribed from. */
  source?: string;
  /** Set on entries written by tools/gt-source/generate.mjs (converted from the GT sources, not hand-checked). */
  generated?: boolean;
  /** [x, y, z] */
  size: Vec3;
  layers: string[][];
  legend: Record<string, LegendEntry>;
  controller: {
    /** Local position of the `~` cell. */
    pos: Vec3;
    /** Direction the controller's front face looks (outward normal, local frame). */
    facing: HorizontalDir;
    blockId: string;
  };
  /** Block id used when a hatch of that kind is placed. */
  hatchBlocks: Partial<Record<HatchKind, string>>;
  /** Hatch kinds whose single block may serve several controllers at once. */
  shareableHatches: HatchKind[];
  /** Required hatch counts per unit (e.g. EBF muffler min 1 max 1). */
  requiredHatches?: Partial<Record<HatchKind, HatchRequirement>>;
  /** Hatch kinds enabled by default in a new plan. */
  defaultHatches: HatchKind[];
  /**
   * Hatch zones by `LegendEntry.region` (generated entries name them `dot<N>` after the hint dot GT's tooltip
   * uses): the kinds the zone's cells are meant for and the tooltip lines describing it, as the game prints them.
   * Informational; it only constrains a plan where a user assigns a zone to a hatch.
   */
  zones?: Record<string, { kinds: HatchKind[]; text?: string }>;
  /** Whether casings of two units may overlap (shared walls) when the blocks match. */
  wallshare: boolean;
  /** Present when the structure has a variable size (see `ResizeRule`). */
  resize?: ResizeRule;
  notes?: string;
}

/** One placed multiblock. `origin` is the world position of the min corner of its rotated bounding box. */
export interface Unit {
  id: number;
  origin: Vec3;
  rotation: Rotation;
}

/** A structure cell of a unit in world space. */
export interface UnitCell {
  pos: Vec3;
  local: Vec3;
  role: CellRole;
  /** Legend char, `~` or `-`. */
  char: string;
  /** Block id for casing/controller cells; undefined for air. */
  blockId?: string;
  /** Hatch kinds allowed at this cell (casing only). */
  hatches?: HatchKind[];
}

export interface PlanLimits {
  /** Max number of units along X / Y (stacked layers) / Z, or null for unlimited. */
  x: number | null;
  y: number | null;
  z: number | null;
}
