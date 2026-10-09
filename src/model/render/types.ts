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
  /** Controller front, hatch face or fixed directional block front. */
  facing?: Dir;
  hatchKind?: HatchKind;
  /**
   * Hatches: the casing the hatch takes the place of. In game a hatch built into a multiblock shows that casing
   * with its own overlay on the front, so DETAILED view draws it that way.
   */
  baseBlockId?: string;
  conflict?: boolean;
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
  /** Site view: text above groups and ports (`pos` in world units, not cells; `color` draws a swatch). */
  labels?: { pos: [number, number, number]; text: string; color?: string; small?: boolean }[];
  /** Site view: the ground area, drawn as a grid from (0, 0) to `size` on y = 0. */
  site?: { size: [number, number] };
  /**
   * Grey dimension lines on the ground plane `y` beside the area from `min` to `max` (x, z): along X
   * (`labels[0]`, width) by its south edge and along Z (`labels[1]`, depth) by its east edge.
   */
  dimensions?: { min: [number, number]; max: [number, number]; y: number; labels: [string, string] };
}
