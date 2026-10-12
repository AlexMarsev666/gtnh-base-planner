import { key } from '../geometry';
import type { Vec3 } from '../core/types';
import type { MultiblockDef, PlanLimits } from '../multiblock/types';
import { coord, modeCaps } from './modes';
import type { WallshareMode } from '../plan/types';
import type { Candidate, Mode, Order, Spacing } from './types';

/** Enumerating and ranking lattice layouts, scored analytically before any cell is checked. */

/** Axis indices [fast, slow] of the horizontal fill for an order. */
function orderAxes(order: Order): [0 | 2, 0 | 2] {
  return order === 'xzy' ? [0, 2] : [2, 0];
}

/** Lattice coordinates of the `idx`-th unit in fill order. */
export function decode(idx: number, counts: Vec3, order: Order): Vec3 {
  const [f, s] = orderAxes(order);
  const cf = counts[f];
  const cs = counts[s];
  const out = [0, 0, 0];
  out[f] = idx % cf;
  out[s] = Math.floor(idx / cf) % cs;
  out[1] = Math.floor(idx / (cf * cs));
  return [out[0], out[1], out[2]];
}

/** Fill-order index of a lattice cell (monotone in every coordinate). */
export function ordinal(p: Vec3, counts: Vec3, order: Order): number {
  const [f, s] = orderAxes(order);
  return (p[1] * counts[s] + p[s]) * counts[f] + p[f];
}

/**
 * For the first `n` lattice cells in fill order, per axis: units with index >= 1 (= neighbour pairs along
 * that axis, each unit pairing with its predecessor), units with an odd index (= pairs whose first unit is
 * even), and the used extent. O(1).
 */
function fillStats(n: number, counts: Vec3, order: Order): { pairs: Vec3; odd: Vec3; used: Vec3 } {
  const [f, s] = orderAxes(order);
  const cf = counts[f];
  const cs = counts[s];
  const layer = cf * cs;
  const full = Math.floor(n / layer);
  const rem = n % layer;
  const rows = Math.floor(rem / cf);
  const r = rem % cf;
  const pairs = [0, 0, 0];
  const odd = [0, 0, 0];
  const used = [0, 0, 0];
  pairs[f] = (full * cs + rows) * (cf - 1) + Math.max(r - 1, 0);
  odd[f] = (full * cs + rows) * Math.floor(cf / 2) + Math.floor(r / 2);
  pairs[s] = full * cf * (cs - 1) + Math.max(rows - 1, 0) * cf + (rows >= 1 ? r : 0);
  odd[s] = full * cf * Math.floor(cs / 2) + Math.floor(rows / 2) * cf + (rows % 2 === 1 ? r : 0);
  pairs[1] = Math.max(full - 1, 0) * layer + (full >= 1 ? rem : 0);
  odd[1] = Math.floor(full / 2) * layer + (full % 2 === 1 ? rem : 0);
  used[f] = Math.min(n, cf);
  used[s] = full >= 1 ? cs : rows + (r > 0 ? 1 : 0);
  used[1] = full + (rem > 0 ? 1 : 0);
  return {
    pairs: [pairs[0], pairs[1], pairs[2]],
    odd: [odd[0], odd[1], odd[2]],
    used: [used[0], used[1], used[2]],
  };
}

/** Lattice shapes (counts per axis) that hold `n` units with no surplus row/layer, within caps. */
function latticeCounts(n: number, caps: Vec3): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  const push = (c: Vec3) => {
    const k = key(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };
  // Derive the third count from the other two, once with Z derived and once with X derived.
  for (const derived of [2, 0] as const) {
    const other = derived === 2 ? 0 : 2;
    for (let a = 1; a <= caps[other]; a++) {
      for (let y = 1; y <= caps[1]; y++) {
        const c = Math.ceil(n / (a * y));
        if (c <= caps[derived]) {
          const counts = [0, y, 0];
          counts[other] = a;
          counts[derived] = c;
          push([counts[0], counts[1], counts[2]]);
        }
        if (a * y >= n) break;
      }
      if (a >= n) break;
    }
  }
  return out;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.faces - a.faces ||
    a.height - b.height ||
    a.area - b.area ||
    a.squareness - b.squareness ||
    a.seq - b.seq
  );
}

/** A spacing with a gap wider than "touching" between every pair of units. */
function isGap(sp: Spacing, size: number): boolean {
  return sp.inner > size;
}

/**
 * Which wallshare preference a layout satisfies, from the axes along which units share a wall.
 * The "back" axis is the world axis the controllers face (it depends on the mode's parity), the "side" axis
 * is the other horizontal one:
 * - 'side': units share walls only along the side axis (rows next to each other), nowhere else.
 * - 'back': units share walls only along the facing axis (back to back, walkway on the front side).
 * - 'stack': units share walls only vertically (layers).
 * The labels side/back/stack look at shared axes only: horizontal touching without sharing is allowed in them.
 * - 'separate': no shared walls and no horizontal contact: a gap of at least one block on X and Z wherever
 *   two units are neighbours (stacked layers may still touch).
 * - 'auto': anything else (several sharing axes, or touching without sharing).
 */
export function classifyWallshare(
  def: MultiblockDef,
  mode: Mode,
  shared: Vec3,
  touching: Vec3,
): WallshareMode {
  const east = def.controller.facing === 'east' || def.controller.facing === 'west';
  const back = (east ? mode.parity === 0 : mode.parity === 1) ? 0 : 2;
  const side = back === 0 ? 2 : 0;
  const axes = [0, 1, 2].filter((a) => shared[a] > 0);
  if (axes.length === 0) return touching[0] === 0 && touching[2] === 0 ? 'separate' : 'auto';
  if (axes.length > 1) return 'auto';
  return axes[0] === 1 ? 'stack' : axes[0] === side ? 'side' : axes[0] === back ? 'back' : 'auto';
}

/**
 * Ranked candidate layouts. The compact family (used by `packUnits`) has no gaps and uses walkways only
 * along axes with a limit; `spaced` adds gap and walkway layouts everywhere (see `layoutCandidates`). Layouts
 * whose bounding volume is `below` or more are left out.
 */
export function candidates(
  def: MultiblockDef,
  modes: Mode[],
  n: number,
  limits: PlanLimits,
  spaced: boolean | 'wide' = false,
  wallshare?: WallshareMode,
  below = Infinity,
): Candidate[] {
  const out: Candidate[] = [];
  const countsByCaps = new Map<string, Vec3[]>();
  let seq = 0;
  for (const mode of modes) {
    const { size, spacing } = mode;
    // Walkways only pay off when a limit stops the layout from growing along another axis instead.
    if (mode.wide && spaced !== 'wide') continue;
    if (
      !spaced &&
      ((spacing[0].inner !== spacing[0].outer && limits.x === null) ||
        (spacing[2].inner !== spacing[2].outer && limits.z === null) ||
        isGap(spacing[0], size[0]) ||
        isGap(spacing[2], size[2]))
    )
      continue;
    const caps = modeCaps(mode, limits, n);
    if (caps[0] === 0 || caps[1] === 0 || caps[2] === 0) continue;
    const capsKey = key(caps);
    let lattices = countsByCaps.get(capsKey);
    if (!lattices) {
      lattices = latticeCounts(n, caps);
      countsByCaps.set(capsKey, lattices);
    }
    for (const counts of lattices) {
      for (const order of ['xzy', 'zxy'] as const) {
        // With a single row either way both orders produce the same layout.
        if (order === 'zxy' && (counts[0] === 1 || counts[2] === 1)) continue;
        const { pairs, odd, used } = fillStats(n, counts, order);
        const ext = [0, 1, 2].map((a) => coord(spacing[a], used[a] - 1) + size[a]);
        if (ext[0] * ext[1] * ext[2] >= below) continue;
        let faces = 0;
        const shared = [0, 0, 0];
        const touching = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          // Units overlap where the spacing is below their size: by one block (a shared wall) or deeper.
          if (spacing[a].inner < size[a]) shared[a] += odd[a];
          if (spacing[a].outer < size[a]) shared[a] += pairs[a] - odd[a];
          faces += shared[a];
          if (spacing[a].inner === size[a]) touching[a] += odd[a];
          if (spacing[a].outer === size[a]) touching[a] += pairs[a] - odd[a];
        }
        const sharedV: Vec3 = [shared[0], shared[1], shared[2]];
        const touchingV: Vec3 = [touching[0], touching[1], touching[2]];
        const kind = classifyWallshare(def, mode, sharedV, touchingV);
        if (wallshare && wallshare !== 'auto' && kind !== wallshare) continue;
        out.push({
          mode,
          counts,
          used,
          order,
          faces,
          height: ext[1],
          area: ext[0] * ext[2],
          squareness: Math.abs(ext[0] - ext[2]),
          seq: seq++,
          shared: sharedV,
          touching: touchingV,
          kind,
        });
      }
    }
  }
  return out.sort(compareCandidates);
}
