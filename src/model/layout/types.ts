import type { Vec3 } from '../core/types';
import type { PackResult, WallshareMode } from '../plan/types';

/** Internal types of the layout packer (see `packer.ts`). */

export interface Shape {
  size: Vec3;
  grid: Int32Array;
  /** Cell right in front of the controller (relative to the unit origin), which must stay free. */
  front: Vec3 | null;
}

/**
 * Spacing along one axis: unit i sits at floor(i / 2) * (inner + outer) + (i % 2) * inner.
 * Uniform spacing has inner === outer.
 */
export interface Spacing {
  inner: number;
  outer: number;
}

/** A rotation parity plus a spacing per axis, with what the axis-aligned neighbour checks allow. */
export interface Mode {
  parity: 0 | 1;
  size: Vec3;
  spacing: [Spacing, Spacing, Spacing];
  /** Most units per axis under the best rotation pattern (Infinity = unbounded). */
  pairCaps: Vec3;
  /** Uses a two-block gap or walkway somewhere: only for routed layouts (see `loosenings`). */
  wide: boolean;
  seq: number;
}

export interface DefCache {
  shapes: Shape[];
  pairs: Map<string, boolean>;
  modes: Mode[] | null;
  results: Map<string, LayoutResult>;
}

/** Fill orders: which horizontal axis fills fastest (height is always filled last, bottom-up). */
export type Order = 'xzy' | 'zxy';

export interface Candidate {
  mode: Mode;
  counts: Vec3;
  /** Lattice cells actually used along each axis. */
  used: Vec3;
  order: Order;
  faces: number;
  height: number;
  area: number;
  squareness: number;
  seq: number;
  /** Neighbour pairs per axis that share a wall (spacing size - 1). */
  shared: Vec3;
  /** Neighbour pairs per axis that touch without sharing (spacing === size). */
  touching: Vec3;
  /** Which wallshare preference this layout satisfies (see `classifyWallshare`). */
  kind: WallshareMode;
}

/**
 * Reported when a wallshare preference could not be honoured: the layout of the automatic ranking was used
 * instead. `used` classifies that layout truthfully ('auto' = mixed or no clear pattern). It also applies when fewer units fit than asked: that shortfall path ignores the preference.
 * - 'no-wallshare': the multiblock cannot share walls (`def.wallshare` false) and the mode needs sharing.
 * - 'limits': the unit limits forbid it (it would work without them).
 * - 'geometry': no valid layout of that kind exists for this multiblock and count.
 */
export interface WallshareFallback {
  wanted: WallshareMode;
  used: WallshareMode;
  reason: 'no-wallshare' | 'limits' | 'geometry';
}

/** `PackResult` plus the fallback report of a wallshare preference (absent when honoured or not asked for). */
export interface LayoutResult extends PackResult {
  fallback?: WallshareFallback;
}
