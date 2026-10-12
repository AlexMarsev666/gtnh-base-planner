import type { CellKey } from '../geometry';
import type { Dir, Vec3 } from '../core/types';
import type { HatchKind, MultiblockDef } from '../multiblock/types';
import type { HatchPlacement, HatchResult } from '../plan/types';

/** Hatch placement inputs, and the cells and ranks it works with. */

/** A cell where every unit containing it has a casing of the same block (hatch-able in principle). */
export interface Site {
  pos: Vec3;
  key: CellKey;
  /** Unit ids whose structure contains this cell, ascending. */
  unitIds: number[];
  /** Hatch kinds every containing unit allows here. */
  kinds: ReadonlySet<HatchKind>;
  /**
   * Open faces, best first, with the key of the empty cell in front of each. `rank` orders them: faces
   * with open space ahead (see `CLEAR_AHEAD`) before faces into a gap or recess, then `FACE_ORDER`.
   */
  faces: { dir: Dir; front: CellKey; rank: number }[];
  /** Per containing unit, the legend region of this cell (see `LegendEntry.region`). */
  regions: ReadonlyMap<number, string>;
  /** Per containing unit, the hatch zone of this cell (see `withHatchZones`); absent outside any zone. */
  zones: ReadonlyMap<number, string>;
  /** World-frame sides a hatch of a kind must not face here (`LegendEntry.disallowFaces`, any unit). */
  blocked: ReadonlyMap<HatchKind, ReadonlySet<Dir>>;
  /** Per containing unit, the legend char of this cell; only filled for a def with `minCasings`. */
  chars: ReadonlyMap<number, string>;
}

/** A candidate site's rank for the hatch kind being placed. */
export interface Entry {
  /** Index into the position-sorted candidate list. */
  i: number;
  /** Units on the site still below their target. */
  score: number;
  /** Units on the site already served. */
  waste: number;
  /** Kinds placed later that the site could also take (keep it for them when there is a choice). */
  wanted: number;
  /** 1 when the face used would wall in a pipe (see `walledIn`), else 0. */
  walled: number;
  /** 0 when the face used looks into open space, 1 when into a gap or recess. */
  open: number;
  /** Hatches of this kind already placed in line with the face used (see `lineKeys`). */
  aligned: number;
  /** Most units that could put a hatch of this kind on one line with the face used. */
  reach: number;
  /** Hatches of other kinds around the cell the face looks into. */
  crowded: number;
  /** Distance from the cell the face looks into to where this kind's pipes go (`PlaceOptions.toward`). */
  far: number;
  /** Index of the open face used, into the site's `faces`. */
  face: number;
  /** That face's position in `FACE_ORDER` (sides before top before bottom). */
  faceRank: number;
}

export interface PlaceOptions {
  /**
   * Hatches may face down from the lowest layer, and pipes may run in the layer under the build (a trench
   * dug for them). Default false: the build stands on the ground and nothing faces it.
   */
  below?: boolean;
  /**
   * Per kind, a point (in the units' coordinates) its pipes lead to, e.g. far out on the side a template's
   * port or the next machine is. Among otherwise equal cells and faces, the one nearest it wins.
   */
  toward?: Partial<Record<HatchKind, Vec3>>;
  /**
   * An explicit list of hatches to place instead of one (or `requiredHatches.min`) of every enabled kind; the
   * `enabled` argument is then ignored. Omitted = the usual behaviour. See `HatchRequest`.
   */
  requests?: readonly HatchRequest[];
}

/**
 * One hatch every listed unit needs: it is placed once per request, and a shareable kind may serve several of
 * the units with one block. Several requests of one kind give each unit several hatches of it.
 */
export interface HatchRequest {
  kind: HatchKind;
  /** Unit ids that need the hatch; `'each'` = all units placed. Ids that are not placed are ignored. */
  units: readonly number[] | 'each';
  /** Only cells of this zone (`MultiblockDef.zones` key, or a legend `region`) may take it. */
  zone?: string;
  /**
   * Names what the hatch is for (e.g. which fluid): copied to the placement (`KeyedHatch.key`) and to its
   * `unplaced` entry. A fluid hatch (fluidIn, fluidOut, steamIn) serves one key only: it is never put on a
   * cell shared with a unit that did not ask for it, so two keys never end up in one block. (A hatch on a
   * wall shared by two units serves both, as in GT, where it joins every adjacent controller's list.)
   */
  key?: string;
}

/** A hatch placement that remembers the `HatchRequest.key` it was placed for (absent without requests). */
export interface KeyedHatch extends HatchPlacement {
  key?: string;
}

/** A hatch that was asked for and could not be placed. */
export interface UnplacedHatch {
  unitId: number;
  kind: HatchKind;
  /** `HatchRequest.key` of the request (only with `PlaceOptions.requests`). */
  key?: string;
  /**
   * Why (only with `PlaceOptions.requests`): the unit wants more hatches than it has cells (`capacity`, see
   * `CapacityEntry`), it is at the kind's maximum (`max`), or no cell fits the request (`noCell`: no
   * allowed kind, zone, side or free cell); the def has no hatch block for the kind (`unsupported`); the unit
   * id is not placed (`noUnit`); or the requests give a unit fewer hatches than `requiredHatches` asks of
   * it, or none in a required `region` (`required`: nothing was added for it, it is only reported); or cells
   * are left but a hatch on any of them would take a unit below a `minCasings` minimum (`casings`).
   */
  reason?: 'capacity' | 'max' | 'noCell' | 'unsupported' | 'noUnit' | 'required' | 'casings';
  /** The `requiredHatches` region still without a hatch (reason `required`). */
  region?: string;
}

/** Units that want more hatches than have a cell with an open face. One entry per distinct overload. */
export interface CapacityEntry {
  /** Hatches the unit wants. */
  needed: number;
  /** How many of them cells can take (a cell shared with another unit counts for each of them). */
  fits: number;
  /** `needed - fits`: hatches to remove. */
  remove: number;
  /** Units with exactly this overload, ascending. */
  unitIds: number[];
  /** Set when even the mandatory hatches (`requiredHatches` min >= 1) do not all fit. */
  mandatory?: true;
}

/** `placeHatches` result: a `HatchResult` that also carries request keys, reasons and what is overfull. */
export interface PlaceResult extends HatchResult {
  hatches: KeyedHatch[];
  unplaced: UnplacedHatch[];
  /** Present only when some unit wants more hatches than fit. */
  capacity?: CapacityEntry[];
}

/** A def with the hatch zones of a hand-made entry (see `withHatchZones`). */
export interface ZonedDef extends MultiblockDef {
  /** Zone of local cells (`x,y,z`); a legend char can hold cells of several zones, so `region` is left alone. */
  zoneCells?: Record<string, string>;
  /** The `size` `zoneCells` are valid for (a copy resized afterwards carries stale cells). */
  zoneSize?: Vec3;
  /**
   * The structure is a mirror image (`mirroredDef`); the file's cells are in the unmirrored frame. Set by
   * mirroring and carried by `sizedDef`, so the order of the two does not matter.
   */
  zoneMirrored?: true;
}

/** Cells (`x,y,z`) a hatch kind must not take, e.g. to try its hatches elsewhere (see `improveHatches`). */
export type HatchAvoid = ReadonlyMap<HatchKind, ReadonlySet<string>>;
