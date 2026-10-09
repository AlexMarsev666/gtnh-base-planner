import type { CellRole, Dir, HorizontalDir, Rotation, Vec3 } from '../core/types';
import type { VoltageTier } from '../tiers';

/** Multiblock definitions, the units placed from them, and the hatch kinds they take. */

/**
 * Kinds of hatches/buses a multiblock can take. Coke Oven uses one hatch block in 3 modes. `steamIn` is the
 * steam input hatch of steam multiblocks, kept apart from `fluidIn` because both can be on one machine.
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
  | 'cryotheumIn'
  | 'pyrotheumIn'
  | 'dataAccess'
  | 'assemblyDataIn'
  | 'assemblyDataOut'
  | 'wirelessAssemblyDataIn'
  | 'wirelessAssemblyDataOut'
  | 'electrodeIn'
  | 'electrodeBus'
  | 'electrodeDetector'
  | 'computationIn'
  | 'computationOut'
  | 'wirelessComputationIn'
  | 'wirelessComputationOut'
  | 'uncertainty'
  | 'computerRack';

/** One character of a structure drawing. */
export interface LegendEntry {
  /** Block id from `src/data/blocks.ts`. */
  blockId: string;
  /** Direction of a fixed block's front, in the structure's local frame. */
  facing?: Dir;
  /** Hatch kinds that may replace this block. Omitted = no hatches here. */
  hatches?: HatchKind[];
  /** Source adder has no casing fallback: exactly one of `hatches` must occupy this cell. */
  requiredHatch?: boolean;
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
 * it (see `sizedDef` in `src/model/resize.ts`). With `section`, the smallest form has no slab; the source
 * section is inserted at `from`, keeping the end piece distinct. A slab cell with a `region` gets a numbered region per copy
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
  /** Optional source-defined slab absent from the smallest form; insert copies at `from`. */
  section?: { size: Vec3; layers: string[][] };
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
  /** Direction already applied to a derived Circuit Assembly Line form; survives definition copies. */
  assemblyGrowth?: 'left' | 'right';
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
  /** Recipe fluid output slots, in source dispatch order; differs from mandatory hatch regions. */
  fluidOutputRegions?: string[];
  /** Dedicated resource adders, separate from the controller's ordinary input/output lists. */
  resourceHatchRegions?: Partial<Record<HatchKind, Record<string, string>>>;
  /** Machine-specific fluid interfaces, identified by their exact registered fluid name. */
  lockedFluidInputs?: Partial<Record<HatchKind, string>>;
  /** Dedicated item interfaces accept exact registry/meta IDs. Unknown items need a manual binding. */
  lockedItemInputs?: Partial<Record<HatchKind, string[]>>;
  /** First-match adders assign different roles to identical physical hatches in source scan order. */
  orderedHatchKinds?: { first: HatchKind; later: HatchKind; order: Vec3[] }[];
  /** Source processing produces only these registered fluids; unknown IDs require an explicit role. */
  fixedFluidOutputs?: Partial<Record<HatchKind, string>>;
  /** Repeated sections contain several output slots, dispatched section by section. */
  interleaveFluidOutputRegions?: boolean;
  minimumVoltageTier?: VoltageTier;
  /** RC2 driller checkMachine applies GTUtility.getTier to the sum of standard input voltages. */
  minimumInputVoltageTier?: VoltageTier;
  hatchTierLimits?: Partial<Record<HatchKind, { min?: VoltageTier; max?: VoltageTier; reason?: string }>>;
  /** All hatches of each listed kind must have the same tier within one controller. */
  uniformHatchTiers?: HatchKind[];
  /** Source-reviewed tiered glass cells may be selected independently of the energy tier. */
  selectableGlass?: boolean;
  /** Only controllers whose standard energy adder/checkMachine imposes this comparison. */
  glassLimitsEnergy?: boolean;
  /** Minimum glass in checkMachine; TFFT skips it when every storage field has zero running cost. */
  minimumStructureGlassTier?: VoltageTier;
  /** Hatch kinds enabled by default in a new plan. */
  defaultHatches: HatchKind[];
  /** Whether casings of two units may overlap (shared walls) when the blocks match. */
  wallshare: boolean;
  /** Present when the structure has a variable size (see `ResizeRule`). */
  resize?: ResizeRule;
  /** Exact alternative topologies indexed by resize size, instead of repeating a slab. */
  structureVariants?: Record<
    number,
    Pick<MultiblockDef, 'size' | 'layers' | 'legend' | 'controller'> &
      Partial<Pick<MultiblockDef, 'requiredHatches'>>
  >;
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
  /** Fixed block front in world space. */
  facing?: Dir;
  /** Hatch kinds allowed at this cell (casing only). */
  hatches?: HatchKind[];
}

export interface PlanLimits {
  /** Max number of units along X / Y (stacked layers) / Z, or null for unlimited. */
  x: number | null;
  y: number | null;
  z: number | null;
}
