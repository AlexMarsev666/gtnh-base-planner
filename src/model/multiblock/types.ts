import type { CellRole, Dir, HorizontalDir, Rotation, Vec3 } from '../core/types';

/** Multiblock definitions, the units placed from them, and the hatch kinds they take. */

/**
 * Kinds of hatches/buses a multiblock can take. Coke Oven uses one hatch block in 3 modes. `steamIn` is the
 * steam input hatch of steam multiblocks, kept apart from `fluidIn` because both can be on one machine.
 * `dataAccess` is the Data Access Hatch of the Assembly Lines.
 */
export type HatchKind =
  | 'itemIn'
  | 'itemOut'
  | 'fluidIn'
  | 'fluidOut'
  | 'energy'
  | 'dynamo'
  | 'maintenance'
  | 'muffler'
  | 'steamIn'
  | 'dataAccess';

/** One character of a structure drawing. */
export interface LegendEntry {
  /** Block id from `src/data/blocks.ts`. */
  blockId: string;
  /** Hatch kinds that may replace this block. Omitted = no hatches here. */
  hatches?: HatchKind[];
  /**
   * Sides (local frame) GT's auto-placement never turns a hatch of the given kind to here, e.g.
   * `disallowOnly(UP, DOWN)` for Distillation Tower layer outputs. A hint of the survival hologram: the structure
   * check does not enforce it (a hatch facing any side still forms the machine); the planner uses it as the sides
   * a hatch may be given.
   */
  disallowFaces?: Partial<Record<HatchKind, Dir[]>>;
  /**
   * The only sides (local frame) GT's auto-placement turns a hatch of the given kind to here, e.g.
   * `allowOnly(DOWN)` for the Assembly Line's input hatches or `allowOnly(NORTH)` for its data access hatch (north =
   * the controller's front in a def whose controller faces north). Like `disallowFaces` it is a hint of the survival
   * hologram, not a structure-check rule; the planner uses it as the preferred/allowed sides. A kind that is not
   * listed has no such limit; a side is open when it is in `allowFaces` (if the kind is listed) and not in
   * `disallowFaces`. Never empty. Read from the structure
   * definitions by tools/gt-source/hatch-faces.mjs; where `disallowFaces` already says the same it is not repeated.
   */
  allowFaces?: Partial<Record<HatchKind, Dir[]>>;
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
 * A casing minimum (GT `checkCasingMin(errors, counter, min)`): the unit must contain at least `min` cells of
 * `chars` (legend keys, together), so a hatch standing in such a casing cell does not count. This is how
 * many casing cells hatches may replace. For a resizable def (see `ResizeRule`) `min` is the minimum of the
 * stored smallest form and `perSlab` what each repeating slab added by `sizedDef` raises it by, so the minimum at
 * size `n` is `min + perSlab * (n - resize.min) / (resize.to - resize.from)`; `sizedDef` states it that way (its
 * result has no `perSlab`).
 */
export interface CasingMinimum {
  /**
   * Legend keys of this def whose cells GT counts (the cells of the structure elements that bump the counter, so a
   * plain casing of the same block that GT does not count is not listed).
   */
  chars: string[];
  /** Minimum number of those cells in the smallest form (at least 1). */
  min: number;
  /** Added to `min` for each repeating slab of a resizable def (a positive whole number). */
  perSlab?: number;
}

/**
 * The tiered glass limits the hatches of a unit (GT `chainAllGlasses` with the check `glassTier <
 * hatch.getTierForStructure()`): the energy (or dynamo) hatches may not be of a higher voltage tier than the glass
 * of the build. The glass tier is the one of the block the player puts in `chars`.
 */
export interface GlassTierLimit {
  /** Legend keys of the tiered glass. */
  chars: string[];
  /** Hatch kinds whose tier must not exceed the glass tier. */
  kinds: HatchKind[];
}

/**
 * A group of hatch kinds of which a unit needs `min` in total (GT `checkHasAnyInput` / `checkHasAnyOutput`:
 * any input bus or hatch, any output bus or hatch), whichever the player picks. `kinds` are the kinds some cell of
 * the def can take. Not stated when `requiredHatches` already demands one of them.
 */
export interface HatchGroupRequirement {
  kinds: HatchKind[];
  min: number;
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
  /**
   * Hatch groups of which at least `min` hatches in total are needed, e.g. an input bus or an input hatch
   * (GT `checkHasAnyInput`), where `requiredHatches` cannot name the kind.
   */
  requiredAny?: HatchGroupRequirement[];
  /** Casing minimums the game's structure check demands (see `CasingMinimum`), one per counted casing. */
  minCasings?: CasingMinimum[];
  /** Hatch kinds the tier of the tiered glass limits (see `GlassTierLimit`). */
  glassTierLimits?: GlassTierLimit;
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
