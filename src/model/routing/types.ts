import type { Vec3 } from '../core/types';
import type { CellHeap } from './heap';
import type { RoutedKind } from './kinds';

/** Inputs and scratch state of multiblock routing. */

/** A dense voxel grid over the search box plus a 1-cell solid border, so the search needs no bounds checks. */
export interface Grid {
  /** World coords of index 0. */
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  occ: Uint8Array;
  /** Bitmask of routed kinds (bit = index in ROUTED_KINDS) whose terminal sits in this cell. */
  termMask: Uint16Array;
  /** 1 where a free cell touches the build or the ground (not the grid border): a pipe there hugs a wall. */
  wall: Uint8Array;
  /** Lowest y index above the ground (and the solid border). */
  floor: number;
  /** Neighbour index offsets: -z, +z, +x, -x, +y, -y. */
  offsets: Int32Array;
}

/** One hatch to connect: the free cells beside it where a pipe may attach, its placed face's cell first. */
export interface Terminal {
  hatch: Vec3;
  cells: number[];
}

/** One kind's network. */
export interface Tree {
  /** Pipe cells in insertion order. */
  net: number[];
  /** Paths as grid indices, each from an existing pipe (or the seed) to a newly connected terminal. */
  paths: number[][];
  connected: number;
}

/** Shared state of one routing run. */
export interface Router {
  g: Grid;
  turnCost: number;
  /** Per cell: bitmask of kinds whose current network uses it. */
  used: Uint16Array;
  /** Per cell: bitmask of kinds that may enter it (free, and not another kind's reserved cell). */
  pass: Uint16Array;
  /** Per cell: price of a pipe block there before congestion: 1, plus beside-hatch and history costs. */
  price: Float32Array;
  /** Per cell: 1 on the previous network of the kind being repaired (free to keep, see `routePipes`). */
  keep: Uint8Array;
  /** Per cell: number of unconnected terminals of the kind being routed that may attach here. */
  target: Uint16Array;
  dist: Float64Array;
  parent: Int32Array;
  arrive: Uint8Array;
  /** Visit stamp per cell; `dist` is valid when `seen[i] === stamp`. */
  seen: Uint32Array;
  stamp: number;
  /** Network stamp per cell; the cell is in the current network when `inNet[i] === netStamp`. */
  inNet: Uint32Array;
  netStamp: number;
  heap: CellHeap;
}

/** One routed kind during a routing run: its terminals, where they attach, and its current network. */
export interface KindState {
  kind: RoutedKind;
  /** Index of the kind in `ROUTED_KINDS`: its bit in the per-cell masks. */
  k: number;
  terms: Terminal[];
  /** Grid cell -> terminals that may attach there. */
  at: Map<number, number[]>;
  /** Per terminal, the cell it attached through, or -1. */
  via: Int32Array;
  tree: Tree | null;
}

/** Options of `routePipes`. */
export interface RouteOptions {
  /** Extra cost of a bend, in pipe blocks (0 = plain shortest paths). Default `DEFAULT_TURN_COST`. */
  turnCost?: number;
  /** Kinds to connect. Default `PIPE_KINDS`; add `CABLE_KINDS` to route energy and dynamo cables too. */
  kinds?: readonly RoutedKind[];
  /** Extra cost of a pipe block off the walls (see `DEFAULT_WALL_COST`). */
  wallCost?: number;
  /** Rework each finished network branch by branch (see `refineTree`). Default true. */
  refine?: boolean;
  /** Negotiation rounds before falling back to routing kinds one by one. Default `MAX_ROUNDS`. */
  rounds?: number;
  /** Pipes may run in the layer under the build and reach hatches from below (see `PlaceOptions`). */
  below?: boolean;
}
