import type { CellKey } from '../geometry';
import type { Dir, Vec3 } from '../core/types';
import type { HatchKind } from '../multiblock/types';

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
  /** World-frame sides a hatch of a kind must not face here (`LegendEntry.disallowFaces`, any unit). */
  blocked: ReadonlyMap<HatchKind, ReadonlySet<Dir>>;
}

/** A candidate site's rank for the hatch kind being placed. */
export interface Entry {
  /** Mandatory physical hatch cells precede optional casing replacements. */
  fixed?: number;
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
}

/** Cells (`x,y,z`) a hatch kind must not take, e.g. to try its hatches elsewhere (see `improveHatches`). */
export type HatchAvoid = ReadonlyMap<HatchKind, ReadonlySet<string>>;
