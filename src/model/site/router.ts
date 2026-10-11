import { DIRS, dirBetween, dirVec } from '../geometry';
import type { Dir, Vec3 } from '../core/types';

/**
 * Net router for sites. Unlike `routing.ts` (one network per hatch kind inside one build), every net here
 * has its own explicit terminals (hatches or boundary ports carrying one resource), and there can be many
 * nets. The search stays inside a fixed box (the site).
 *
 * Each net grows a tree from its first terminal: repeatedly the cheapest path from the tree to any
 * unconnected terminal is added, where a step costs 1 and a bend `turnCost` more (A* over cell +
 * arrival direction). Pipes of other nets, structures and "keep free" cells (controller fronts, mufflers,
 * maintenance hatches) are obstacles. The cell in front of each terminal's preferred face is claimed for
 * its net, so every terminal keeps one way in.
 *
 * When a net cannot connect every terminal, a few rip-up rounds follow: the failing net is routed once
 * with other nets' pipes allowed at a high price, the nets it would cross are removed, the failing net is
 * routed for real, and the removed nets are routed again. A round is kept only if it connects more
 * terminals (or as many with fewer pipe blocks). The rounds stop after a share of the first pass's work
 * (counted in states searched, so the result stays deterministic). Pure and deterministic.
 *
 * Underground levels (`trenchBelow`) cost `TRENCH_COST` per block and level, so -1 is preferred and deeper
 * levels are used only where they save pipe. The neat style adds a penalty per surface block (except short
 * stubs at the terminals), dearer bends and a small surcharge for a pipe that runs alone instead of beside
 * another net's pipe, so trunks go underground, straight and in parallel lines.
 */

export interface RouteTerminal {
  /** The block the pipe connects to (hatch, machine or port); it is never a pipe cell itself. */
  cell: Vec3;
  /** Faces a pipe may attach to, preferred first. */
  faces: Dir[];
  role: 'source' | 'sink';
}

export interface RouteNetSpec {
  terminals: RouteTerminal[];
}

export interface RouteResult {
  /** Polylines of pipe cells; each starts on the tree built so far. */
  paths: Vec3[][];
  /** Pipe blocks. */
  length: number;
  connected: number;
  total: number;
  stats: RouteStats;
  /** Per terminal: the face its pipe attaches to, or null when not connected. */
  attach: (Dir | null)[];
  /**
   * Directed steps between neighbouring cells (pipe cells and terminal blocks) along which the resource
   * flows. Steps where the direction is ambiguous (sources and sinks on both sides) are left out.
   */
  flows: [Vec3, Vec3][];
}

export interface RouterInput {
  /** Inclusive min, exclusive max of the routing box. */
  box: { min: Vec3; max: Vec3 };
  /** Structure cells (anything solid). Cells outside the box are ignored. */
  solids: Iterable<Vec3>;
  /** Empty cells no pipe may use. */
  keepFree: Iterable<Vec3>;
  nets: RouteNetSpec[];
  /** Extra cost of a bend, in blocks. Default 2. */
  turnCost?: number;
  /** Rip-up rounds after the first pass. Default 3. */
  rounds?: number;
  /**
   * Cells below this height (a trench under the ground) cost `TRENCH_COST` more per block and level below
   * it, so pipes go underground only where that saves pipe, and deeper only where that saves more.
   */
  trenchBelow?: number;
  /** `neat` prices surface blocks, bends and lone runs (see `NEAT_*`). Default `classic`. */
  style?: 'classic' | 'neat';
}

/** What a routed net is made of. */
export interface RouteStats {
  /** Pipe blocks. */
  length: number;
  /** Direction changes along the paths. */
  bends: number;
  /** Blocks on or above the ground that are not stubs. */
  surfaceTrunk: number;
  /** Blocks on or above the ground right at a terminal, and the run from there down into the ground. */
  surfaceStub: number;
  /** Blocks per underground level: index 0 is level -1. */
  underground: number[];
}

/**
 * Above this many cells nothing is routed (every net reports unconnected). The largest site, 256 × 256,
 * with 18 layers of room is about 1.2M cells; the search keeps 7 states per cell (~12 bytes each), so
 * about 100 MB at the limit.
 */
export const MAX_ROUTER_CELLS = 1_200_000;

const FREE = 0;
const SOLID = 1;
const KEEP = 2;
/** `occ` of a pipe cell of net n. */
const PIPE = 3;
const STATES = 7;
const NO_DIR = 6;
/** Price of crossing another net's pipe in the diagnostic search of a rip-up round. */
const SOFT_PENALTY = 12;
/** History cost added to a contested cell each round. */
const HIST_STEP = 3;
/** Work the rip-up rounds may add, as a share of the first pass (states searched), and at least `MIN_RIPUP_WORK`. */
const RIPUP_WORK_FACTOR = 0.5;
const MIN_RIPUP_WORK = 1_000_000;
/** Extra cost of a pipe block in the trench (see `RouterInput.trenchBelow`). */
export const TRENCH_COST = 1;
/**
 * States one net may search per attempt (a first route, or one rip-up try): past it the net keeps what it
 * has connected so far, so a single hard net cannot run unbounded. Normal sites stay far below it.
 */
export const NET_WORK_CAP = 20_000_000;
/** Neat style: extra cost of a surface block, except stubs at the terminals. */
export const SURFACE_PENALTY = 4;
/** Neat style: added to the bend cost. */
export const NEAT_TURN_EXTRA = 2;
/**
 * Neat style: added to the bend cost (instead of `NEAT_TURN_EXTRA`) where the run turns to or from the
 * vertical. Dropping to the trench and coming back up costs two such turns, so a trunk goes down only where
 * that saves more than it costs, and the stubs of a hatch are not left for a detour.
 */
export const NEAT_VERTICAL_TURN_EXTRA = 8;
/** Neat style: extra cost of a step into a free cell with no other net's pipe beside it on its level. */
export const NEAT_LONE_COST = 0.25;
/**
 * Neat style: weight of the A* estimate. The lone-run surcharge makes a step cost up to 1.125 times its
 * base (2) where no pipe is beside it, and an unweighted bound would let the search flood every equal-length
 * path (over 30 times slower on a big empty site). With this weight the estimate is no longer a strict lower
 * bound where a run goes beside other pipes (it may exceed the true cost by up to about 12%), so the path
 * found is at most that much dearer than the cheapest one. It still under-estimates wherever the surface,
 * history or bend costs apply, which is what keeps the search fast.
 */
export const NEAT_H_WEIGHT = 1.12;

interface Grid {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  occ: Uint16Array;
  /** Net index + 1 that owns the cell in front of a terminal's preferred face; 0 = nobody. */
  claim: Int32Array;
  /** Free cells reachable from the open air (not sealed pockets). */
  open: Uint8Array;
  offsets: Int32Array;
}

function makeGrid(box: RouterInput['box']): Grid | null {
  const ox = box.min[0] - 1;
  const oy = box.min[1] - 1;
  const oz = box.min[2] - 1;
  const dx = box.max[0] - box.min[0] + 2;
  const dy = box.max[1] - box.min[1] + 2;
  const dz = box.max[2] - box.min[2] + 2;
  if (dx < 3 || dy < 3 || dz < 3 || dx * dy * dz > MAX_ROUTER_CELLS) return null;
  const n = dx * dy * dz;
  const occ = new Uint16Array(n);
  for (let z = 0; z < dz; z++)
    for (let y = 0; y < dy; y++)
      for (let x = 0; x < dx; x++)
        if (x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1)
          occ[x + dx * (y + dy * z)] = SOLID;
  // Same order as `DIRS`: north, south, east, west, up, down.
  const offsets = Int32Array.from(
    DIRS.map((d) => {
      const v = dirVec(d);
      return v[0] + dx * (v[1] + dy * v[2]);
    }),
  );
  return { ox, oy, oz, dx, dy, dz, occ, claim: new Int32Array(n), open: new Uint8Array(n), offsets };
}

function inside(g: Grid, p: Vec3): boolean {
  const x = p[0] - g.ox;
  const y = p[1] - g.oy;
  const z = p[2] - g.oz;
  return x > 0 && y > 0 && z > 0 && x < g.dx - 1 && y < g.dy - 1 && z < g.dz - 1;
}

function idx(g: Grid, p: Vec3): number {
  return p[0] - g.ox + g.dx * (p[1] - g.oy + g.dy * (p[2] - g.oz));
}

function pos(g: Grid, i: number): Vec3 {
  const x = i % g.dx;
  const r = (i - x) / g.dx;
  const y = r % g.dy;
  return [x + g.ox, y + g.oy, (r - y) / g.dy + g.oz];
}

/** Flood fill of free cells from every free cell next to the box border (the open air around the site). */
function markOpen(g: Grid): void {
  const { occ, open, offsets, dx, dy, dz } = g;
  const queue = new Int32Array(occ.length);
  let tail = 0;
  const seed = (i: number): void => {
    if (occ[i] === FREE && !open[i]) {
      open[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let z = 1; z < dz - 1; z++)
    for (let y = 1; y < dy - 1; y++)
      for (let x = 1; x < dx - 1; x++)
        if (x === 1 || z === 1 || x === dx - 2 || z === dz - 2 || y === dy - 2) seed(x + dx * (y + dy * z));
  for (let head = 0; head < tail; head++) {
    const c = queue[head];
    for (let d = 0; d < 6; d++) seed(c + offsets[d]);
  }
}

/** Binary min-heap of (cost, state) pairs in typed arrays. */
class Heap {
  private cost = new Float64Array(1024);
  private state = new Int32Array(1024);
  size = 0;

  push(c: number, s: number): void {
    if (this.size === this.cost.length) {
      const nc = new Float64Array(this.size * 2);
      nc.set(this.cost);
      const ns = new Int32Array(this.size * 2);
      ns.set(this.state);
      this.cost = nc;
      this.state = ns;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      // Ties by state keep the search deterministic across engines.
      if (this.cost[p] < c || (this.cost[p] === c && this.state[p] <= s)) break;
      this.cost[i] = this.cost[p];
      this.state[i] = this.state[p];
      i = p;
    }
    this.cost[i] = c;
    this.state[i] = s;
  }

  /** Pops the cheapest entry; its cost is in `lastCost`. */
  pop(): number {
    const top = this.state[0];
    this.lastCost = this.cost[0];
    const n = --this.size;
    const c = this.cost[n];
    const s = this.state[n];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const m =
        r < n &&
        (this.cost[r] < this.cost[l] || (this.cost[r] === this.cost[l] && this.state[r] < this.state[l]))
          ? r
          : l;
      if (c < this.cost[m] || (c === this.cost[m] && s <= this.state[m])) break;
      this.cost[i] = this.cost[m];
      this.state[i] = this.state[m];
      i = m;
    }
    this.cost[i] = c;
    this.state[i] = s;
    return top;
  }

  lastCost = 0;

  clear(): void {
    this.size = 0;
  }
}

interface Search {
  dist: Float32Array;
  parent: Int32Array;
  seen: Uint32Array;
  stamp: number;
  heap: Heap;
  turnCost: number;
  /** Neat style: cost of a turn to or from a vertical run (`turnCost` for horizontal turns). */
  verticalTurnCost: number;
  /** Neat style: runs beside other nets' pipes are cheaper. */
  neat: boolean;
  /** Neat style with an underground: least extra cost of a step into a cell that is not a stub. */
  extra: number;
  /** Per cell, 1 on or above the ground (neat style with an underground). */
  surface: Uint8Array | null;
  /** Cells of the net being routed that are its stubs are marked with `stubId` in `stubMark`. */
  stubMark: Uint32Array;
  stubId: number;
  stubCount: number;
  /** `work` at which the net being routed gives up (`NET_WORK_CAP` past its start). */
  workLimit: number;
  /** Extra cost per cell learned from congestion in earlier rounds (negotiated routing). */
  hist: Float32Array;
  /** States taken off the heap so far: the measure of work for the rip-up budget. */
  work: number;
}

/** A terminal after resolving its faces against the grid. */
interface Term {
  spec: RouteTerminal;
  /** Attach cells per face, in face order (-1 when that side is blocked). */
  cells: Int32Array;
  faces: Dir[];
}

interface NetState {
  terms: Term[];
  /** Pipe cells (insertion order) and paths, as grid indices. */
  cells: number[];
  paths: number[][];
  /** Per terminal: the attach cell it is connected through, or -1. */
  via: Int32Array;
  /** Cells the net's terminals use as stubs: next to a terminal, and the free run down from there. */
  stubs: number[];
}

/** Above this many goals the A* estimate uses their bounding box instead of the nearest one. */
const EXACT_GOALS = 16;

/**
 * A lower bound on the cost from `cell` to the attach cell of any goal (terminal block) in `goals` (grid
 * coordinates, x y z per goal): Manhattan distance to the nearest one, less the step onto its block. With
 * many goals, the distance to their bounding box. Every step costs at least 1, so the bound is consistent.
 *
 * Neat style (`extra` > 0): a step into a cell that is not one of the net's `stubs` cells costs at least
 * 1 + `extra` (underground: 1 + level cost >= 1 + TRENCH_COST; surface: 1 + SURFACE_PENALTY; history,
 * bends and the lone-run surcharge only add). A path of p >= m - 1 steps enters at most `stubs` cells (every
 * stub cell of the net, not just the goal's),
 * so it costs at least p + extra * max(0, p - stubs), which grows with p, so the bound at p = m - 1 is
 * admissible (before `NEAT_H_WEIGHT`, which trades at most 12% optimality for speed). It is not
 * consistent (it can drop by 1 + extra for a cheap stub step); the search re-opens states reached more
 * cheaply, so it still finds the cheapest path.
 */
function estimate(
  g: Grid,
  goals: Int32Array,
  box: Int32Array,
  cell: number,
  extra: number,
  stubs: number,
): number {
  const x = cell % g.dx;
  const r = (cell - x) / g.dx;
  const y = r % g.dy;
  const z = (r - y) / g.dy;
  let best: number;
  if (goals.length > 3 * EXACT_GOALS) {
    best =
      Math.max(0, box[0] - x, x - box[3]) +
      Math.max(0, box[1] - y, y - box[4]) +
      Math.max(0, box[2] - z, z - box[5]);
  } else {
    best = Infinity;
    for (let i = 0; i < goals.length; i += 3) {
      const m = Math.abs(goals[i] - x) + Math.abs(goals[i + 1] - y) + Math.abs(goals[i + 2] - z);
      if (m < best) best = m;
    }
  }
  const p = best > 0 ? best - 1 : 0;
  return extra > 0 && p > stubs ? (p + extra * (p - stubs)) * NEAT_H_WEIGHT : p;
}

/**
 * Cheapest path from the tree (`inTree`) to a cell with `target[cell] > 0` (A*, guided towards `goals`:
 * the blocks of the terminals those cells belong to). With `soft`, other nets' pipes may be crossed at
 * `SOFT_PENALTY` each. Returns the path (tree cell first) or null.
 */
function search(
  g: Grid,
  s: Search,
  net: number,
  tree: readonly number[],
  target: Uint8Array,
  goals: Int32Array,
  soft: boolean,
): number[] | null {
  const { occ, claim, offsets } = g;
  const { dist, parent, seen, heap, turnCost } = s;
  const stamp = ++s.stamp;
  const own = PIPE + net;
  const box = Int32Array.of(g.dx, g.dy, g.dz, 0, 0, 0);
  for (let i = 0; i < goals.length; i += 3)
    for (let a = 0; a < 3; a++) {
      box[a] = Math.min(box[a], goals[i + a]);
      box[a + 3] = Math.max(box[a + 3], goals[i + a]);
    }
  const h = (cell: number) => (goals.length ? estimate(g, goals, box, cell, s.extra, s.stubCount) : 0);
  heap.clear();
  for (const c of tree) {
    const st = c * STATES + NO_DIR;
    seen[st] = stamp;
    dist[st] = 0;
    parent[st] = -1;
    heap.push(h(c), st);
  }
  while (heap.size > 0) {
    const st = heap.pop();
    const cell = (st / STATES) | 0;
    const cost = dist[st];
    // A stale entry: the state was reached more cheaply after it was queued.
    if (heap.lastCost > cost + h(cell)) continue;
    if (++s.work > s.workLimit) return null;
    if (target[cell] > 0 && parent[st] !== -1) {
      const path: number[] = [];
      for (let t = st; t !== -1; t = parent[t]) path.push((t / STATES) | 0);
      return path.reverse();
    }
    const dir = st - cell * STATES;
    for (let d = 0; d < 6; d++) {
      const n = cell + offsets[d];
      const o = occ[n];
      let step = 1;
      if (o !== FREE && o !== own) {
        if (!soft || o < PIPE) continue;
        step += SOFT_PENALTY;
      }
      const c = claim[n];
      if (c !== 0 && c !== net + 1) continue;
      if (s.neat && o === FREE) {
        let beside = false;
        for (let a = 0; a < 4; a++) if (occ[n + offsets[a]] >= PIPE) beside = true;
        if (!beside) step += NEAT_LONE_COST;
      }
      if (s.surface && s.surface[n] && s.stubMark[n] !== s.stubId) step += SURFACE_PENALTY;
      let turn = 0;
      if (dir !== NO_DIR && dir !== d) turn = s.neat && (dir >= 4 || d >= 4) ? s.verticalTurnCost : turnCost;
      const nc = cost + step + s.hist[n] + turn;
      const ns = n * STATES + d;
      if (seen[ns] === stamp && dist[ns] <= nc) continue;
      seen[ns] = stamp;
      dist[ns] = nc;
      parent[ns] = st;
      // Queued with the stored (Float32) cost, so the stale check above compares like with like.
      heap.push(dist[ns] + h(n), ns);
    }
  }
  return null;
}

/**
 * Whether a terminal may attach at cell `c` right now: open to the air, not claimed by another net, and
 * free or already this net's pipe (with `soft`, another net's pipe too).
 */
function usable(g: Grid, net: number, c: number, soft = false): boolean {
  if (c < 0) return false;
  const o = g.occ[c];
  const cl = g.claim[c];
  return (
    g.open[c] === 1 && (o === FREE || o === PIPE + net || (soft && o >= PIPE)) && (cl === 0 || cl === net + 1)
  );
}

/**
 * Route one net from scratch on the current grid. With `soft`, only returns the cells the paths would use
 * (nothing is written to the grid).
 */
function routeNet(g: Grid, s: Search, net: number, st: NetState, soft: boolean): number[] {
  const n = st.terms.length;
  s.workLimit = s.work + NET_WORK_CAP;
  s.stubId++;
  for (const c of st.stubs) s.stubMark[c] = s.stubId;
  s.stubCount = st.stubs.length;
  const via = new Int32Array(n).fill(-1);
  const target = new Uint8Array(g.occ.length);
  const at = new Map<number, number[]>();
  st.terms.forEach((t, ti) => {
    for (const c of t.cells) {
      if (!usable(g, net, c, soft)) continue;
      let list = at.get(c);
      if (!list) at.set(c, (list = []));
      if (!list.includes(ti)) list.push(ti);
    }
  });
  const reach = (cell: number): void => {
    for (const ti of at.get(cell) ?? []) {
      if (via[ti] !== -1) continue;
      via[ti] = cell;
      for (const c of st.terms[ti].cells) if (c >= 0 && target[c] > 0) target[c]--;
    }
  };
  // Seed: the first source with a usable side (else the first terminal with one).
  const order = [...st.terms.keys()].sort(
    (a, b) =>
      (st.terms[a].spec.role === 'source' ? 0 : 1) - (st.terms[b].spec.role === 'source' ? 0 : 1) || a - b,
  );
  let seedCell = -1;
  for (const ti of order) {
    seedCell = [...st.terms[ti].cells].find((c) => usable(g, net, c, soft)) ?? -1;
    if (seedCell >= 0) break;
  }
  const tree: number[] = [];
  const paths: number[][] = [];
  const inTree = new Set<number>();
  if (seedCell >= 0) {
    for (const [cell, list] of at) for (const ti of list) if (via[ti] === -1) target[cell]++;
    tree.push(seedCell);
    inTree.add(seedCell);
    paths.push([seedCell]);
    reach(seedCell);
    for (;;) {
      const goals: number[] = [];
      for (let ti = 0; ti < n; ti++)
        if (via[ti] === -1 && st.terms[ti].cells.some((c) => usable(g, net, c, soft))) {
          const p = st.terms[ti].spec.cell;
          goals.push(p[0] - g.ox, p[1] - g.oy, p[2] - g.oz);
        }
      if (goals.length === 0) break;
      const path = search(g, s, net, tree, target, Int32Array.from(goals), soft);
      if (!path) break;
      for (const c of path) {
        if (!inTree.has(c)) {
          inTree.add(c);
          tree.push(c);
        }
        reach(c);
      }
      paths.push(path);
    }
  }
  if (!soft) {
    st.cells = tree;
    // A seed that later became part of a longer path is not worth a separate single-cell path.
    st.paths = paths.length > 1 ? paths.slice(1) : paths;
    st.via = via;
    for (const c of tree) g.occ[c] = PIPE + net;
  }
  return tree;
}

function ripUp(g: Grid, net: number, st: NetState): void {
  for (const c of st.cells) if (g.occ[c] === PIPE + net) g.occ[c] = FREE;
  st.cells = [];
  st.paths = [];
  st.via = new Int32Array(st.terms.length).fill(-1);
}

function connectedCount(st: NetState): number {
  let n = 0;
  for (const v of st.via) if (v !== -1) n++;
  return n;
}

function score(states: NetState[]): [number, number] {
  let conn = 0;
  let len = 0;
  for (const st of states) {
    conn += connectedCount(st);
    len += st.cells.length;
  }
  return [conn, len];
}

/**
 * Flow direction on each tree edge: out of a part that holds only sources, into a part that holds only
 * sinks. Works on any connected graph by using a BFS spanning tree (extra edges get no direction).
 */
function flowsOf(g: Grid, st: NetState): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    if (a === b) return;
    let la = adj.get(a);
    if (!la) adj.set(a, (la = []));
    if (!la.includes(b)) la.push(b);
    let lb = adj.get(b);
    if (!lb) adj.set(b, (lb = []));
    if (!lb.includes(a)) lb.push(a);
  };
  for (const c of st.cells) if (!adj.has(c)) adj.set(c, []);
  for (const p of st.paths) for (let i = 1; i < p.length; i++) link(p[i - 1], p[i]);
  const src = new Map<number, number>();
  const snk = new Map<number, number>();
  st.terms.forEach((t, ti) => {
    const c = st.via[ti];
    if (c < 0) return;
    const m = t.spec.role === 'source' ? src : snk;
    m.set(c, (m.get(c) ?? 0) + 1);
    const hatch = t.spec.cell;
    const cell = pos(g, c);
    out.push(t.spec.role === 'source' ? [hatch, cell] : [cell, hatch]);
  });
  if (st.cells.length === 0) return out;
  // BFS order from the first cell, then subtree sums in reverse order.
  const root = st.cells[0];
  const parent = new Map<number, number>([[root, -1]]);
  const order = [root];
  for (let h = 0; h < order.length; h++)
    for (const n of adj.get(order[h]) ?? [])
      if (!parent.has(n)) {
        parent.set(n, order[h]);
        order.push(n);
      }
  const S = new Map<number, number>();
  const K = new Map<number, number>();
  for (const c of order) {
    S.set(c, src.get(c) ?? 0);
    K.set(c, snk.get(c) ?? 0);
  }
  for (let i = order.length - 1; i > 0; i--) {
    const c = order[i];
    const p = parent.get(c)!;
    S.set(p, S.get(p)! + S.get(c)!);
    K.set(p, K.get(p)! + K.get(c)!);
  }
  const totalS = S.get(root)!;
  const totalK = K.get(root)!;
  for (let i = 1; i < order.length; i++) {
    const c = order[i];
    const p = parent.get(c)!;
    const s = S.get(c)!;
    const k = K.get(c)!;
    if (s > 0 && k === 0 && totalK - k > 0) out.push([pos(g, c), pos(g, p)]);
    else if (k > 0 && s === 0 && totalS - s > 0) out.push([pos(g, p), pos(g, c)]);
  }
  return out;
}

/** Totals of one routed net: where its blocks are, and how often its paths turn. */
function statsOf(g: Grid, st: NetState, trench: number | undefined, depth: number): RouteStats {
  const ground = trench ?? 0;
  const out: RouteStats = {
    length: st.cells.length,
    bends: 0,
    surfaceTrunk: 0,
    surfaceStub: 0,
    underground: new Array<number>(depth).fill(0),
  };
  const stubs = new Set(st.stubs);
  for (const c of st.cells) {
    const y = pos(g, c)[1];
    if (y >= ground) out[stubs.has(c) ? 'surfaceStub' : 'surfaceTrunk']++;
    else out.underground[ground - y - 1]++;
  }
  for (const p of st.paths)
    for (let i = 2; i < p.length; i++) if (p[i] - p[i - 1] !== p[i - 1] - p[i - 2]) out.bends++;
  return out;
}

export function routeNets(input: RouterInput): RouteResult[] {
  const nets = input.nets;
  const empty = (spec: RouteNetSpec): RouteResult => ({
    paths: [],
    length: 0,
    connected: 0,
    total: spec.terminals.length,
    attach: spec.terminals.map(() => null),
    flows: [],
    stats: { length: 0, bends: 0, surfaceTrunk: 0, surfaceStub: 0, underground: [] },
  });
  const g = makeGrid(input.box);
  if (!g || nets.length === 0) return nets.map(empty);
  if (nets.length > 0xffff - PIPE) return nets.map(empty);

  for (const p of input.solids) if (inside(g, p)) g.occ[idx(g, p)] = SOLID;
  markOpen(g);
  for (const p of input.keepFree) if (inside(g, p) && g.occ[idx(g, p)] === FREE) g.occ[idx(g, p)] = KEEP;

  const states: NetState[] = nets.map((spec) => ({
    terms: spec.terminals.map((t) => ({
      spec: t,
      faces: t.faces,
      cells: Int32Array.from(t.faces, (f) => {
        const v = dirVec(f);
        const c: Vec3 = [t.cell[0] + v[0], t.cell[1] + v[1], t.cell[2] + v[2]];
        return inside(g, c) ? idx(g, c) : -1;
      }),
    })),
    cells: [],
    paths: [],
    via: new Int32Array(spec.terminals.length).fill(-1),
    stubs: [],
  }));
  // Claim one cell in front of each terminal for its net: its preferred free side, or the next one when
  // another terminal took it. Terminals with the fewest free sides choose first, so a hatch with a single
  // way in never loses it to one that had other options.
  const claimers = states.flatMap((st, net) =>
    st.terms.map((t) => ({
      net,
      cells: [...t.cells].filter((c) => c >= 0 && g.open[c] === 1 && g.occ[c] === FREE),
    })),
  );
  claimers
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.cells.length - b.cells.length || a.i - b.i)
    .forEach(({ net, cells: options }) => {
      const c = options.find((cell) => g.claim[cell] === 0 || g.claim[cell] === net + 1);
      if (c !== undefined) g.claim[c] = net + 1;
    });

  const neat = input.style === 'neat';
  const cells = g.occ.length;
  const s: Search = {
    dist: new Float32Array(cells * STATES),
    parent: new Int32Array(cells * STATES),
    seen: new Uint32Array(cells * STATES),
    stamp: 0,
    heap: new Heap(),
    turnCost: Math.max(0, input.turnCost ?? 2) + (neat ? NEAT_TURN_EXTRA : 0),
    verticalTurnCost: Math.max(0, input.turnCost ?? 2) + NEAT_VERTICAL_TURN_EXTRA,
    neat,
    extra: neat && input.trenchBelow !== undefined ? Math.min(TRENCH_COST, SURFACE_PENALTY) : 0,
    surface: neat && input.trenchBelow !== undefined ? new Uint8Array(cells) : null,
    stubMark: new Uint32Array(cells),
    stubId: 0,
    stubCount: 0,
    workLimit: Infinity,
    hist: new Float32Array(cells),
    work: 0,
  };
  const trench = input.trenchBelow;
  if (trench !== undefined) {
    // The trench starts dearer, more so the deeper the level; congestion history adds to it like to any
    // other cell. Neat: surface cells are marked, and pay `SURFACE_PENALTY` unless they are stubs.
    for (let z = 0; z < g.dz; z++)
      for (let y = 0; y < g.dy; y++) {
        const k = trench - (y + g.oy);
        const base = g.dx * (z * g.dy + y);
        if (k > 0) s.hist.fill(TRENCH_COST * k, base, base + g.dx);
        else s.surface?.fill(1, base, base + g.dx);
      }
  }
  // Stubs of each net: the cell at each of its terminals and the free run below it down to the ground.
  for (const st of states) {
    const set = new Set<number>();
    for (const t of st.terms)
      for (const c0 of t.cells) {
        if (c0 < 0 || g.open[c0] !== 1 || g.occ[c0] !== FREE) continue;
        let c = c0;
        set.add(c);
        if (trench === undefined) continue;
        while ((Math.floor(c / g.dx) % g.dy) + g.oy > trench) {
          c += g.offsets[5];
          if (g.occ[c] !== FREE) break;
          set.add(c);
        }
      }
    st.stubs = [...set].sort((a, b) => a - b);
  }

  // Nets with more terminals and wider spans first: they are the hardest to fit in later.
  const span = (spec: RouteNetSpec): number => {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const t of spec.terminals) {
      lo = lo.map((v, i) => Math.min(v, t.cell[i]));
      hi = hi.map((v, i) => Math.max(v, t.cell[i]));
    }
    return spec.terminals.length ? hi[0] - lo[0] + hi[1] - lo[1] + hi[2] - lo[2] : 0;
  };
  const order = [...nets.keys()].sort(
    (a, b) => nets[b].terminals.length - nets[a].terminals.length || span(nets[b]) - span(nets[a]) || a - b,
  );
  for (const net of order) routeNet(g, s, net, states[net], false);

  const snapshot = () => ({
    occ: g.occ.slice(),
    nets: states.map((x) => ({ cells: x.cells, paths: x.paths, via: x.via })),
  });
  const restore = (snap: ReturnType<typeof snapshot>): void => {
    g.occ.set(snap.occ);
    snap.nets.forEach((x, i) => {
      states[i].cells = x.cells;
      states[i].paths = x.paths;
      states[i].via = x.via;
    });
  };
  const beats = (a: [number, number], b: [number, number]) => a[0] > b[0] || (a[0] === b[0] && a[1] < b[1]);
  const failing = () => order.filter((n) => connectedCount(states[n]) < states[n].terms.length);

  // Rip-up rounds stop early when they have used their share of work, or when a whole round gains nothing:
  // on a crowded site they rarely connect much more, and they are far slower than the first pass.
  const firstPass = s.work;
  const budget = Math.max(MIN_RIPUP_WORK, RIPUP_WORK_FACTOR * firstPass);
  const exhausted = () => s.work - firstPass > budget;
  const rounds = Math.max(0, input.rounds ?? 4);
  for (let round = 0; round < rounds && failing().length > 0 && !exhausted(); round++) {
    const roundStart = score(states);
    for (const f of failing()) {
      if (exhausted()) break;
      const st = states[f];
      const before = score(states);
      const snap = snapshot();
      // Earlier steps may have moved what was in the way: first simply try again.
      ripUp(g, f, st);
      routeNet(g, s, f, st, false);
      if (beats(score(states), before)) continue;
      restore(snap);
      // Which nets are in the way? Route softly (with the failing net's own pipe removed). The cells it
      // would share become more expensive for everyone in later searches.
      ripUp(g, f, st);
      const softCells = routeNet(g, s, f, st, true);
      const blockers = new Set<number>();
      for (const c of softCells) {
        const o = g.occ[c];
        if (o >= PIPE && o !== PIPE + f) {
          blockers.add(o - PIPE);
          s.hist[c] += HIST_STEP;
        }
      }
      const redo = order.filter((n) => blockers.has(n));
      for (const b of redo) ripUp(g, b, states[b]);
      routeNet(g, s, f, st, false);
      for (const b of redo) routeNet(g, s, b, states[b], false);
      if (!beats(score(states), before)) restore(snap);
    }
    if (failing().length === 0 || exhausted()) break;
    // Negotiated reroute: everything again, the nets that failed first, with the learned cell costs.
    const before = score(states);
    const snap = snapshot();
    const first = failing();
    for (let n = 0; n < states.length; n++) ripUp(g, n, states[n]);
    for (const n of [...first, ...order.filter((x) => !first.includes(x))])
      routeNet(g, s, n, states[n], false);
    if (!beats(score(states), before)) restore(snap);
    if (!beats(score(states), roundStart)) break;
  }

  const depth = Math.max(0, (trench ?? 0) - g.oy - 1);
  return states.map((st) => ({
    stats: statsOf(g, st, trench, depth),
    paths: st.paths.map((p) => p.map((i) => pos(g, i))),
    length: st.cells.length,
    connected: connectedCount(st),
    total: st.terms.length,
    attach: st.terms.map((t, ti) => (st.via[ti] < 0 ? null : dirBetween(t.spec.cell, pos(g, st.via[ti])))),
    flows: flowsOf(g, st),
  }));
}
