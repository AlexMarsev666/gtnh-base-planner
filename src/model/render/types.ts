import type { Dir, Vec3 } from '../core/types';
import type { HatchKind } from '../multiblock/types';
import type { HatchPlacement } from '../plan/types';
import type { RouteNet } from '../routing/routeNet';

/** What the renderer draws. */

export type VoxelKind = 'casing' | 'controller' | 'hatch';

export interface Voxel {
  pos: Vec3;
  blockId: string;
  kind: VoxelKind;
  unitIds: number[];
  /** Controller front / hatch face. */
  facing?: Dir;
  hatchKind?: HatchKind;
  /**
   * Hatches: the casing the hatch takes the place of. In game a hatch built into a multiblock shows that casing
   * with its own overlay on the front, so DETAILED view draws it that way.
   */
  baseBlockId?: string;
  conflict?: boolean;
}

/** Where the pipes of several nets merge in front of the hatch they all feed. */
export interface PipeJunction {
  /** The pipe cell in front of the hatch. */
  cell: Vec3;
  kind: HatchKind;
  /** The meeting nets (`RouteNet.id`) and their colours, in net order. */
  nets: number[];
  colors: string[];
  /** The hatch it feeds and the face the pipe takes. */
  hatch: Vec3;
  face: Dir;
  /** Faded: every net meeting here is. */
  dim?: boolean;
}

/** Everything the renderer needs, derived purely from a plan. */
export interface SceneModel {
  voxels: Voxel[];
  hatches: HatchPlacement[];
  pipes: RouteNet[] | null;
  bounds: { min: Vec3; max: Vec3 };
  /** Hatch colours to use in both view modes. */
  colors: Record<HatchKind, string>;
  /** Site view: discs on hatch and port faces; replaces the discs derived from hatch voxels. */
  markers?: { pos: Vec3; face: Dir; color: string }[];
  /**
   * Site view: the shared cell in front of a hatch several nets end at (a bus holding several items takes
   * them through its front only), drawn as one pipe block where the nets merge.
   */
  junctions?: PipeJunction[];
  /** Site view: text above groups and ports (`pos` in world units, not cells; `color` draws a swatch). */
  labels?: { pos: [number, number, number]; text: string; color?: string; small?: boolean }[];
  /** Site view: the ground area, drawn as a grid from (0, 0) to `size` on y = 0. */
  site?: { size: [number, number] };
  /**
   * Site view: a floor of one block layer at height `y` (the layer below the ground), `size` blocks from (0, 0),
   * made of `blockId`, with no block at the `holes` ([x, z] cells where a pipe or cable passes through).
   */
  floor?: { y: number; blockId: string; size: [number, number]; holes: [number, number][] };
  /**
   * Grey dimension lines on the ground plane `y` beside the area from `min` to `max` (x, z): along X
   * (`labels[0]`, width) by its south edge and along Z (`labels[1]`, depth) by its east edge.
   */
  dimensions?: { min: [number, number]; max: [number, number]; y: number; labels: [string, string] };
}
