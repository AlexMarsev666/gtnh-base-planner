import type { Rotation } from '../core/types';
import { FLOOR_CLEARANCE } from './arrange';
import type { PlanLimits } from '../multiblock/types';
import {
  faceBlocks,
  flushContact,
  FLUSH_NONE,
  FLUSH_X_HIGH,
  FLUSH_X_LOW,
  FLUSH_Z_LOW,
  sharedAcross,
  type LazyFaces,
} from './groupFaces';
import { throwIfAborted } from './progress';
import { coversFootprint, turnedReach, type Reach, type Terminals } from './terminals';
import type { SiteGroup, SiteLink, SiteState } from './types';

/**
 * Simulated annealing of the groups' places on the site.
 *
 * `arrangeSite` lays a chain out in flow order; this polishes that layout. It moves, swaps and turns groups
 * (and rebuilds a few of them around their link partners, "ruin and recreate") and keeps what shortens the
 * links and tightens the whole. It starts from the layout it is given, never leaves the site or lets two
 * groups come closer than the corridor (except that two groups with the same casing on their facing walls may
 * stand flush, sharing that wall: see `Shape.faces`), and hands back the best layout it saw, so the result is never worse
 * than the start by its own cost. Each group keeps its floor (`elevation`) and its count and limits.
 *
 * Cost = estimated wire length + `compact` * (width + depth of the groups' bounding box) - `share` * the
 * cells two groups share.
 * - Wire length is the half-perimeter of each net's terminals (a net: the links of one resource that share
 *   an end), measured between group centres, in X, Z and height. Where the hatches for the net's resource
 *   may only go on part of a group (`Terminals`), its terminal is the point of that part, turned with the group,
 *   nearest the net's other terminals instead of its centre: a group facing its partners away pays for it, so
 *   turning is worth something even for a square group. A boundary port without a position is an
 *   X-only terminal on its own edge (west for inputs, east for outputs), since it is placed along that edge
 *   wherever the pipes need it.
 *
 * It is an estimate: the real router decides whether a layout connects. `optimizeSite` routes the best
 * few layouts and keeps the one that does best.
 *
 * Pure and deterministic for a given seed and iteration count; the time limit is only a safety net that
 * ends the run early (`truncated`). The cooling follows the iterations, never the clock.
 */

export interface AnnealOptions {
  /** Random seed; different seeds explore differently. Default 1. */
  seed?: number;
  /** Proposals to try. Default grows with the number of groups. */
  iterations?: number;
  /** Safety limit: stop after this many milliseconds, whatever the iterations (the result is `truncated`). */
  budgetMs?: number;
  /** Clock for `budgetMs`. Default `performance.now`. */
  now?: () => number;
  /** Called with (iterations done, iterations planned) every few iterations; the caller throttles. */
  onProgress?: (done: number, total: number) => void;
  /** Aborting throws `AbortedError`. */
  signal?: AbortSignal;
  /** Weight of the bounding box's width + depth against the wire length. Default `DEFAULT_COMPACT`. */
  compact?: number;
  /** Height in blocks of each group, to tell whether two floors clear each other. Default 1. */
  heightOf?: (id: string) => number;
  /**
   * Share of the wire estimate measured between group centres; the rest is measured between the groups'
   * facing sides (the free gap a pipe has to cross). Default `DEFAULT_CENTRE`.
   */
  centre?: number;
  /**
   * Replaces the estimate as the cost of a layout (the router's numbers, say). Called with the groups as
   * they stand; expensive calls make `iterations` or `budgetMs` the limit that matters.
   */
  evaluate?: (groups: SiteGroup[]) => number;
  /** Start temperature as a share of the typical uphill step of a random move. Default 0.5. */
  heat?: number;
  /**
   * Other shapes a group may take (by group id; the group's own `limits` name its current one). A group with more than one gets a
   * move that repacks it in place; the result carries the chosen `limits`. Groups without an entry keep theirs.
   */
  shapes?: ReadonlyMap<string, readonly Shape[]>;
  /**
   * Where each group's links attach in its current shape (by group id), for groups whose shapes carry no
   * `ends` of their own. A group without any terminals counts from its centre.
   */
  ends?: ReadonlyMap<string, Terminals>;
  /** The side faces of each group's current shape (by group id), for groups whose shapes carry no `faces` of their own. */
  faces?: ReadonlyMap<string, LazyFaces>;
  /** Cost of a cell two groups share, in blocks of pipe. Default `DEFAULT_SHARE`. */
  share?: number;
}

export interface AnnealResult {
  groups: SiteGroup[];
  /** Cost of the layout that was given and of the one returned. */
  before: number;
  after: number;
  /** False when nothing better was found (or the start was not a valid layout); `groups` is then the start. */
  improved: boolean;
  iterations: number;
  /** Whether the time limit ended the run before its iterations were done. */
  truncated: boolean;
}

/**
 * One way to pack a group: the `limits` that give it, and the footprint [x, z] and height that result (before
 * rotation). A group's current shape is the one whose `limits` match its own.
 */
export interface Shape {
  limits: PlanLimits;
  size: [number, number];
  height: number;
  /** Where its links attach (see `Terminals`), when known. */
  ends?: Terminals;
  /**
   * The side faces of the packing per rotation (see `groupFaces`), when known. Two groups with faces may stand
   * flush (one block of overlap) where their walls are compatible.
   */
  faces?: LazyFaces;
}

export const DEFAULT_COMPACT = 0.3;
export const DEFAULT_SHARE = 0.5;
export const DEFAULT_CENTRE = 0.25;

/** Proposals per group, and the most in one run. */
const ITERATIONS_PER_GROUP = 1500;
const MAX_ITERATIONS = 120000;

export function defaultIterations(groups: number): number {
  return Math.min(MAX_ITERATIONS, 3000 + ITERATIONS_PER_GROUP * groups);
}

interface Net {
  resource: string;
  /** Index of `resource` among the site's net resources (set by `Layout`). */
  res: number;
  groups: number[];
  /** X of the boundary ports without a position (the edges). */
  edgeX: number[];
  /** Ports with a fixed cell. */
  fixed: [number, number][];
}

/** The nets of a site: per resource, the links that share an end, as a set of groups and ports. */
function buildNets(site: SiteState, index: Map<string, number>): Net[] {
  const [w] = site.size;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let c = k; c !== r;) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const node = (resource: string, e: SiteLink['from']) => {
    const k = `${resource}|${'group' in e ? `g:${e.group}` : `p:${e.port}`}`;
    if (!parent.has(k)) parent.set(k, k);
    return k;
  };
  for (const l of site.links) {
    const a = find(node(l.resource, l.from));
    const b = find(node(l.resource, l.to));
    if (a !== b) parent.set(a, b);
  }
  const ports = new Map(site.ports.map((p) => [p.id, p]));
  const nets = new Map<string, Net>();
  for (const k of parent.keys()) {
    const at = k.indexOf('|');
    const end = k.slice(at + 1);
    const net = nets.get(find(k)) ?? { resource: k.slice(0, at), res: -1, groups: [], edgeX: [], fixed: [] };
    nets.set(find(k), net);
    if (end.startsWith('g:')) {
      const gi = index.get(end.slice(2));
      if (gi !== undefined) net.groups.push(gi);
    } else {
      const p = ports.get(end.slice(2));
      if (!p) continue;
      if (p.pos) net.fixed.push(p.pos);
      else net.edgeX.push(p.dir === 'in' ? 0 : w - 1);
    }
  }
  return [...nets.values()].filter((n) => n.groups.length + n.edgeX.length + n.fixed.length >= 2);
}

/** The state being annealed, with the cost function over it. */
class Layout {
  readonly n: number;
  readonly nets: Net[];
  readonly x: number[];
  readonly z: number[];
  readonly rot: Rotation[];
  readonly w: number[];
  readonly d: number[];
  readonly present: boolean[];
  /** Nets each group is in, the wire length last computed for each net, and the nets changed since. */
  private readonly netsOf: number[][];
  private readonly wires: Float64Array;
  private readonly dirty: Set<number>;
  /** Groups changed since `begin`, with what they were then (for `rollback`). */
  private readonly journal = new Map<number, [number, number, Rotation, number]>();
  /** Groups a group is linked to. */
  readonly partners: number[][];
  /** Every shape of each group; `shape[i]` is the one it has. */
  readonly shapes: (readonly Shape[])[];
  readonly shape: number[];
  /** The shape each group started with. */
  readonly home: number[];
  /** Middle of each group's hatches per (shape, rotation, resource), measured once (null: none known). */
  private readonly turned: (Reach | null | undefined)[][];
  /** Whether any shape knows where its links may attach. */
  private readonly anyReach: boolean;
  private readonly resources: string[];
  private readonly y0: number[];
  private readonly h: number[];
  private readonly gap: number;
  /** Groups that never share a wall (`wallshare: 'separate'`), and whether any shape has faces to share. */
  private readonly apart: boolean[];
  private readonly sharing: boolean;
  /** Cells two groups share, by (shape, turn, shape, turn, side, offset) of the pair; and which pairs may ever. */
  private readonly pairMemo = new Map<string, number>();
  private readonly mayShare = new Map<number, boolean>();
  private readonly blocksOf: (Set<string> | undefined)[][];
  private readonly lo: [number, number];
  private readonly hi: [number, number];

  constructor(
    readonly site: SiteState,
    sizeOf: (id: string) => [number, number] | undefined,
    heightOf: (id: string) => number,
    readonly compact: number,
    private readonly centre: number = DEFAULT_CENTRE,
    shapes?: ReadonlyMap<string, readonly Shape[]>,
    ends?: ReadonlyMap<string, Terminals>,
    faces?: ReadonlyMap<string, LazyFaces>,
    private readonly share: number = DEFAULT_SHARE,
  ) {
    const gs = site.groups;
    this.n = gs.length;
    const index = new Map(gs.map((g, i) => [g.id, i]));
    this.nets = buildNets(site, index);
    this.resources = [...new Set(this.nets.map((n) => n.resource))];
    for (const n of this.nets) n.res = this.resources.indexOf(n.resource);
    this.netsOf = gs.map(() => []);
    this.nets.forEach((net, k) => new Set(net.groups).forEach((gi) => this.netsOf[gi].push(k)));
    this.wires = new Float64Array(this.nets.length);
    this.dirty = new Set(this.nets.keys());
    this.shapes = gs.map((g) => {
      const given = shapes?.get(g.id);
      return given && given.length > 0
        ? given
        : [{ limits: g.limits, size: sizeOf(g.id) ?? [3, 3], height: Math.max(1, heightOf(g.id)) }];
    });
    // The shape a group has now: the one its limits name, else the first.
    this.shape = gs.map((g, i) =>
      Math.max(
        0,
        this.shapes[i].findIndex((sh) => sameLimits(sh.limits, g.limits)),
      ),
    );
    this.home = [...this.shape];
    this.shapes.forEach((list, i) => {
      const own = ends?.get(gs[i].id);
      if (own && !list[this.shape[i]].ends) {
        const copy = [...list];
        copy[this.shape[i]] = { ...list[this.shape[i]], ends: own };
        this.shapes[i] = copy;
      }
    });
    this.shapes.forEach((list, i) => {
      const own = faces?.get(gs[i].id);
      if (own && !list[this.shape[i]].faces) {
        const copy = [...list];
        copy[this.shape[i]] = { ...list[this.shape[i]], faces: own };
        this.shapes[i] = copy;
      }
    });
    this.apart = gs.map((g) => g.wallshare === 'separate');
    this.sharing =
      this.apart.some((a) => !a) && this.shapes.some((list) => list.some((sh) => sh.faces !== undefined));
    this.blocksOf = gs.map(() => []);
    this.turned = gs.map(() => []);
    this.anyReach = this.shapes.some((list) => list.some((sh) => sh.ends && Object.keys(sh.ends).length > 0));
    this.x = gs.map((g) => g.origin[0]);
    this.z = gs.map((g) => g.origin[1]);
    this.rot = gs.map((g) => g.rotation);
    this.w = gs.map((_, i) => this.footOf(i, this.rot[i])[0]);
    this.d = gs.map((_, i) => this.footOf(i, this.rot[i])[1]);
    this.present = gs.map(() => true);
    this.y0 = gs.map((g) => g.elevation ?? 0);
    this.h = this.shapes.map((list, i) => Math.max(1, list[this.shape[i]].height));
    this.gap = site.corridor;
    // The same margins `arrangeSite` keeps: one more block on the west and east for the ports.
    const edge = 1 + Math.max(1, this.gap);
    const side = Math.max(1, this.gap);
    this.lo = [edge, side];
    this.hi = [site.size[0] - edge, site.size[1] - side];
    const partners = gs.map(() => new Set<number>());
    for (const l of site.links) {
      const a = 'group' in l.from ? index.get(l.from.group) : undefined;
      const b = 'group' in l.to ? index.get(l.to.group) : undefined;
      if (a !== undefined && b !== undefined && a !== b) {
        partners[a].add(b);
        partners[b].add(a);
      }
    }
    this.partners = partners.map((s) => [...s]);
  }

  footOf(i: number, r: Rotation, s: number = this.shape[i]): [number, number] {
    const [fx, fz] = this.shapes[i][s].size;
    return r % 2 === 0 ? [fx, fz] : [fz, fx];
  }

  /**
   * Bounds from the min corner of group `i` of where its links of resource number `res` may attach in the turn
   * `r` of shape `s`, or null when that is unknown or anywhere on the group (turning it then changes nothing).
   */
  reach(i: number, r: Rotation, s: number, res: number): Reach | null {
    const memo = this.turned[i];
    const k = (s * 4 + r) * this.resources.length + res;
    let at = memo[k];
    if (at === undefined) {
      const { ends, size } = this.shapes[i][s];
      const box = ends?.[this.resources[res]];
      at = box && !coversFootprint(box, size) ? turnedReach(box, size, r) : null;
      memo[k] = at;
    }
    return at;
  }

  /** Whether group `i` is inside the site's margins. */
  inside(i: number): boolean {
    return (
      this.x[i] >= this.lo[0] &&
      this.z[i] >= this.lo[1] &&
      this.x[i] + this.w[i] <= this.hi[0] &&
      this.z[i] + this.d[i] <= this.hi[1]
    );
  }

  /** Smallest and largest x (z) group `i` may have. */
  range(i: number): [number, number, number, number] {
    return [this.lo[0], this.hi[0] - this.w[i], this.lo[1], this.hi[1] - this.d[i]];
  }

  /**
   * Whether groups `i` and `j` are too close: less than the corridor apart and not on clear floors, unless they
   * stand flush with a wall in common (`shared`).
   */
  clash(i: number, j: number): boolean {
    if (
      this.y0[i] - (this.y0[j] + this.h[j]) >= FLOOR_CLEARANCE ||
      this.y0[j] - (this.y0[i] + this.h[i]) >= FLOOR_CLEARANCE
    )
      return false;
    const close = !(
      this.x[i] + this.w[i] + this.gap <= this.x[j] ||
      this.x[j] + this.w[j] + this.gap <= this.x[i] ||
      this.z[i] + this.d[i] + this.gap <= this.z[j] ||
      this.z[j] + this.d[j] + this.gap <= this.z[i]
    );
    return close && !(this.sharing && this.canShare(i, j) && this.shared(i, j) > 0);
  }

  /** Whether some packing and turn of `i` may share a wall with one of `j`: they have a casing block in common. */
  canShare(i: number, j: number): boolean {
    if (!this.sharing || this.apart[i] || this.apart[j]) return false;
    const k = Math.min(i, j) * this.n + Math.max(i, j);
    let may = this.mayShare.get(k);
    if (may === undefined) {
      may = false;
      for (let a = 0; a < this.shapes[i].length && !may; a++)
        for (let b = 0; b < this.shapes[j].length && !may; b++) {
          const bj = this.blocks(j, b);
          for (const m of this.blocks(i, a)) if (bj.has(m)) may = true;
        }
      this.mayShare.set(k, may);
    }
    return may;
  }

  private blocks(i: number, s: number): Set<string> {
    const row = this.blocksOf[i];
    const faces = this.shapes[i][s].faces;
    return (row[s] ??= faces ? faceBlocks(faces) : new Set());
  }

  /**
   * The cells groups `i` and `j` have in common when they overlap by exactly one block on one axis (and by more
   * on the other) and every cell of the two facing walls is compatible; 0 when they may not stand like that or
   * share nothing. Memoised per pair of packings, turns and offsets.
   */
  shared(i: number, j: number): number {
    if (i > j) [i, j] = [j, i];
    const c = flushContact(
      this.x[i],
      this.z[i],
      this.w[i],
      this.d[i],
      this.x[j],
      this.z[j],
      this.w[j],
      this.d[j],
    );
    if (c === FLUSH_NONE || this.apart[i] || this.apart[j]) return 0;
    const fi = this.shapes[i][this.shape[i]].faces;
    const fj = this.shapes[j][this.shape[j]].faces;
    if (!fi || !fj) return 0;
    if (this.y0[i] + this.h[i] <= this.y0[j] || this.y0[j] + this.h[j] <= this.y0[i]) return 0;
    const alongX = c === FLUSH_X_LOW || c === FLUSH_X_HIGH;
    const low = c === FLUSH_X_LOW || c === FLUSH_Z_LOW;
    const along = alongX ? this.z[j] - this.z[i] : this.x[j] - this.x[i];
    const dy = this.y0[j] - this.y0[i];
    const k = `${i},${this.shape[i]},${this.rot[i]},${j},${this.shape[j]},${this.rot[j]},${c},${along},${dy}`;
    let n = this.pairMemo.get(k);
    if (n === undefined) {
      const a = fi(this.rot[i]);
      const b = fj(this.rot[j]);
      const [fa, fb] = alongX
        ? low
          ? [a.maxX, b.minX]
          : [a.minX, b.maxX]
        : low
          ? [a.maxZ, b.minZ]
          : [a.minZ, b.maxZ];
      n = Math.max(0, sharedAcross(fa, 0, 0, fb, along, dy));
      this.pairMemo.set(k, n);
    }
    return n;
  }

  /**
   * Pairs of groups that may share a wall at all (see `canShare`, found once), the cells each shared when last
   * measured, the pairs of each group, and the pairs changed since (as with the nets' wire length).
   */
  private sharePairs: [number, number][] | undefined;
  private pairCells = new Int32Array(0);
  private pairsOf: number[][] = [];
  private readonly dirtyPairs = new Set<number>();

  /** Cells shared by all pairs of present groups; only the pairs of groups that moved since the last call are measured again. */
  sharedCells(): number {
    if (!this.sharePairs) {
      const pairs: [number, number][] = [];
      for (let i = 0; i < this.n; i++)
        for (let j = i + 1; j < this.n; j++) if (this.canShare(i, j)) pairs.push([i, j]);
      this.sharePairs = pairs;
      this.pairCells = new Int32Array(pairs.length);
      this.pairsOf = this.shapes.map(() => []);
      pairs.forEach(([i, j], p) => {
        this.pairsOf[i].push(p);
        this.pairsOf[j].push(p);
        this.dirtyPairs.add(p);
      });
    }
    for (const p of this.dirtyPairs) {
      const [i, j] = this.sharePairs[p];
      this.pairCells[p] = this.present[i] && this.present[j] ? this.shared(i, j) : 0;
    }
    this.dirtyPairs.clear();
    let s = 0;
    for (let p = 0; p < this.pairCells.length; p++) s += this.pairCells[p];
    return s;
  }

  /** Whether group `i` stands inside the site and clear of every other present group. */
  valid(i: number): boolean {
    if (!this.inside(i)) return false;
    for (let j = 0; j < this.n; j++) if (j !== i && this.present[j] && this.clash(i, j)) return false;
    return true;
  }

  allValid(): boolean {
    for (let i = 0; i < this.n; i++) if (!this.valid(i)) return false;
    return true;
  }

  set(i: number, x: number, z: number, r: Rotation = this.rot[i], s: number = this.shape[i]): void {
    if (x !== this.x[i] || z !== this.z[i] || r !== this.rot[i] || s !== this.shape[i]) {
      for (const k of this.netsOf[i]) this.dirty.add(k);
      for (const p of this.pairsOf[i] ?? []) this.dirtyPairs.add(p);
      if (!this.journal.has(i)) this.journal.set(i, [this.x[i], this.z[i], this.rot[i], this.shape[i]]);
    }
    this.x[i] = x;
    this.z[i] = z;
    if (r !== this.rot[i] || s !== this.shape[i]) {
      this.rot[i] = r;
      this.shape[i] = s;
      [this.w[i], this.d[i]] = this.footOf(i, r, s);
      this.h[i] = Math.max(1, this.shapes[i][s].height);
    }
  }

  /**
   * The estimated wire length of one net, in X, Z and height: `centre` times the half-perimeter of its
   * terminals' centres, plus the rest times the free gap the net has to cross (from the largest near edge to
   * the smallest far edge: zero where the groups overlap along that axis).
   */
  private wire(net: Net): number {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    // Gap: highest low edge and lowest high edge on each axis.
    let xl = -Infinity;
    let xh = Infinity;
    let zl = -Infinity;
    let zh = Infinity;
    let yl = -Infinity;
    let yh = Infinity;
    let pts = net.edgeX.length + net.fixed.length;
    // Sums of the terminals' centres, to lean a group's terminal to the others': the reference point.
    let sx = 0;
    let sz = 0;
    let nx = 0;
    let nz = 0;
    if (this.anyReach) {
      for (const gi of net.groups)
        if (this.present[gi]) {
          sx += this.x[gi] + this.w[gi] / 2;
          sz += this.z[gi] + this.d[gi] / 2;
          nx++;
          nz++;
        }
      for (const px of net.edgeX) ((sx += px), nx++);
      for (const [px, pz] of net.fixed) ((sx += px), (sz += pz), nx++, nz++);
    }
    for (const gi of net.groups) {
      if (!this.present[gi]) continue;
      pts++;
      const gx = this.x[gi];
      const gz = this.z[gi];
      const gy = this.y0[gi];
      let cx = gx + this.w[gi] / 2;
      let cz = gz + this.d[gi] / 2;
      // Where the links may attach: as near the others as that box lets it be.
      const box = this.anyReach ? this.reach(gi, this.rot[gi], this.shape[gi], net.res) : null;
      if (box) {
        const rx = nx > 1 ? (sx - cx) / (nx - 1) : cx;
        const rz = nz > 1 ? (sz - cz) / (nz - 1) : cz;
        // A hatch is in a block: its terminal is a block's centre.
        cx = Math.min(gx + box[1] - 0.5, Math.max(gx + box[0] + 0.5, rx));
        cz = Math.min(gz + box[3] - 0.5, Math.max(gz + box[2] + 0.5, rz));
      }
      const cy = gy + this.h[gi] / 2;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cz < z0) z0 = cz;
      if (cz > z1) z1 = cz;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      if (gx > xl) xl = gx;
      if (gx + this.w[gi] < xh) xh = gx + this.w[gi];
      if (gz > zl) zl = gz;
      if (gz + this.d[gi] < zh) zh = gz + this.d[gi];
      if (gy > yl) yl = gy;
      if (gy + this.h[gi] < yh) yh = gy + this.h[gi];
    }
    if (pts < 2) return 0;
    for (const px of net.edgeX) {
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (px > xl) xl = px;
      if (px < xh) xh = px;
    }
    for (const [px, pz] of net.fixed) {
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (pz < z0) z0 = pz;
      if (pz > z1) z1 = pz;
      if (px > xl) xl = px;
      if (px < xh) xh = px;
      if (pz > zl) zl = pz;
      if (pz < zh) zh = pz;
    }
    if (net.edgeX.length + net.fixed.length > 0) {
      // Ports stand on the ground.
      if (0 < y0) y0 = 0;
      if (0 > y1) y1 = 0;
      if (0 > yl) yl = 0;
      if (0 < yh) yh = 0;
    }
    const centre = Math.max(0, x1 - x0) + Math.max(0, z1 - z0) + Math.max(0, y1 - y0);
    if (this.centre >= 1) return centre;
    const gap = Math.max(0, xl - xh) + Math.max(0, zl - zh) + Math.max(0, yl - yh);
    return this.centre * centre + (1 - this.centre) * gap;
  }

  /** Takes a group out of the layout (`false`) or puts it back: its nets change. */
  setPresent(i: number, present: boolean): void {
    if (this.present[i] === present) return;
    this.present[i] = present;
    for (const k of this.netsOf[i]) this.dirty.add(k);
    for (const p of this.pairsOf[i] ?? []) this.dirtyPairs.add(p);
  }

  /** Total wire length; only the nets of groups that moved since the last call are measured again. */
  wireLength(): number {
    for (const k of this.dirty) this.wires[k] = this.wire(this.nets[k]);
    this.dirty.clear();
    let s = 0;
    for (let k = 0; k < this.wires.length; k++) s += this.wires[k];
    return s;
  }

  /** Width + depth of the bounding box of the present groups. */
  span(): number {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (!this.present[i]) continue;
      x0 = Math.min(x0, this.x[i]);
      x1 = Math.max(x1, this.x[i] + this.w[i]);
      z0 = Math.min(z0, this.z[i]);
      z1 = Math.max(z1, this.z[i] + this.d[i]);
    }
    return x1 > x0 ? x1 - x0 + (z1 - z0) : 0;
  }

  cost(): number {
    return (
      this.wireLength() + this.compact * this.span() - (this.sharing ? this.share * this.sharedCells() : 0)
    );
  }

  /** Starts a move: what changes from here can be undone with `rollback`. */
  begin(): void {
    this.journal.clear();
  }

  /** Puts back every group the move since `begin` changed. */
  rollback(): void {
    const changed = [...this.journal];
    this.journal.clear();
    for (const [i, [x, z, r, s]] of changed) this.set(i, x, z, r, s);
    this.journal.clear();
  }

  snapshot(): { x: number[]; z: number[]; rot: Rotation[]; shape: number[] } {
    return { x: [...this.x], z: [...this.z], rot: [...this.rot], shape: [...this.shape] };
  }

  restore(s: { x: number[]; z: number[]; rot: Rotation[]; shape: number[] }): void {
    for (let i = 0; i < this.n; i++) this.set(i, s.x[i], s.z[i], s.rot[i], s.shape[i]);
  }
}

function sameLimits(a: PlanLimits, b: PlanLimits): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Small deterministic generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The cost `annealGroups` minimises, for the groups as they stand in `site`. */
export function layoutCost(
  site: SiteState,
  sizeOf: (id: string) => [number, number] | undefined,
  opts: Pick<AnnealOptions, 'compact' | 'heightOf'> = {},
): { wire: number; span: number; cost: number } {
  const m = new Layout(site, sizeOf, opts.heightOf ?? (() => 1), opts.compact ?? DEFAULT_COMPACT);
  const wire = m.wireLength();
  const span = m.span();
  return { wire, span, cost: wire + m.compact * span };
}

export function annealGroups(
  site: SiteState,
  sizeOf: (id: string) => [number, number] | undefined,
  opts: AnnealOptions = {},
): AnnealResult {
  const m = new Layout(
    site,
    sizeOf,
    opts.heightOf ?? (() => 1),
    opts.compact ?? DEFAULT_COMPACT,
    opts.centre ?? DEFAULT_CENTRE,
    opts.shapes,
    opts.ends,
    opts.faces,
    opts.share,
  );
  const toGroups = () =>
    site.groups.map((g, i) => ({
      ...g,
      ...(m.shape[i] === m.home[i] ? {} : { limits: { ...m.shapes[i][m.shape[i]].limits } }),
      origin: [m.x[i], m.z[i]] as [number, number],
      rotation: m.rot[i],
    }));
  /** The cost a layout is judged by: the estimate, or `evaluate` when one is given. */
  const judge = () => (opts.evaluate ? opts.evaluate(toGroups()) : m.cost());
  const before = judge();
  const unchanged: AnnealResult = {
    groups: site.groups.map((g) => ({ ...g })),
    before,
    after: before,
    improved: false,
    iterations: 0,
    truncated: false,
  };
  // Only a layout that already respects the site and the corridors can be polished: every move keeps it so.
  if (m.n < 2 || m.nets.length === 0 || !m.allValid()) return unchanged;

  const rand = rng(opts.seed ?? 1);
  const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  /** Fisher-Yates on a copy: a fixed number of draws, unlike a `sort` with a random comparator. */
  const shuffled = <T>(list: Iterable<T>): T[] => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const now = opts.now ?? (() => performance.now());
  const iterations = opts.iterations ?? defaultIterations(m.n);
  const [w, d] = site.size;
  const gap = site.corridor;
  /** A rotation other than `r`: a quarter turn either way or a half turn, each as likely. */
  const turnedBy = (r: Rotation): Rotation => ((r + randInt(1, 3)) % 4) as Rotation;

  /** Puts `i` at `x`,`z` (rotated to `r`, packed as shape `s`) if that is a valid place; otherwise leaves it. */
  const tryPlace = (
    i: number,
    x: number,
    z: number,
    r: Rotation = m.rot[i],
    s: number = m.shape[i],
  ): boolean => {
    const was = [m.x[i], m.z[i], m.rot[i], m.shape[i]] as const;
    m.set(i, x, z, r, s);
    if (m.valid(i)) return true;
    m.set(i, was[0], was[1], was[2], was[3]);
    return false;
  };

  /** Groups that can be packed more than one way. */
  const reshapable = m.shapes.flatMap((list, i) => (list.length > 1 ? [i] : []));

  /** Packs a group another way, in place: around its centre, else from its min corner. */
  const reshape = (): boolean => {
    const i = pick(reshapable);
    const s = (m.shape[i] + randInt(1, m.shapes[i].length - 1)) % m.shapes[i].length;
    const [nw, nd] = m.footOf(i, m.rot[i], s);
    const cx = m.x[i] + m.w[i] / 2;
    const cz = m.z[i] + m.d[i] / 2;
    return (
      tryPlace(i, Math.round(cx - nw / 2), Math.round(cz - nd / 2), m.rot[i], s) ||
      tryPlace(i, m.x[i], m.z[i], m.rot[i], s)
    );
  };

  /**
   * Where `i` would sit next to `j` on a side (aligned by centre, nudged a little): a corridor apart, or, about
   * half the time when the two may share a wall, flush with one block of overlap.
   */
  const beside = (i: number, j: number): [number, number] => {
    const nudge = randInt(-2, 2);
    const side = randInt(0, 3);
    // Drawn only when the pair can share, so layouts without compatible walls anneal exactly as they did.
    const away = m.canShare(i, j) && rand() < 0.5 ? -1 : gap;
    switch (side) {
      case 0:
        return [m.x[j] + m.w[j] + away, m.z[j] + Math.round((m.d[j] - m.d[i]) / 2) + nudge];
      case 1:
        return [m.x[j] - m.w[i] - away, m.z[j] + Math.round((m.d[j] - m.d[i]) / 2) + nudge];
      case 2:
        return [m.x[j] + Math.round((m.w[j] - m.w[i]) / 2) + nudge, m.z[j] + m.d[j] + away];
      default:
        return [m.x[j] + Math.round((m.w[j] - m.w[i]) / 2) + nudge, m.z[j] - m.d[i] - away];
    }
  };

  /** Rebuilds a few linked groups: lifts them off, then puts each back where it costs least. */
  const ruinAndRecreate = (): boolean => {
    const seed = randInt(0, m.n - 1);
    const chosen = [seed];
    for (const p of shuffled(m.partners[seed])) if (chosen.length < 3) chosen.push(p);
    if (chosen.length < 2 && m.n > 1) chosen.push((seed + randInt(1, m.n - 1)) % m.n);
    const old = chosen.map((i) => [i, m.x[i], m.z[i], m.rot[i]] as const);
    for (const i of chosen) m.setPresent(i, false);
    chosen.splice(0, chosen.length, ...shuffled(chosen));
    let ok = true;
    for (const i of chosen) {
      m.setPresent(i, true);
      const here = [m.x[i], m.z[i], m.rot[i]] as const;
      const spot: { at: [number, number, Rotation] | null; cost: number } = { at: null, cost: Infinity };
      const consider = (x: number, z: number, r: Rotation) => {
        m.set(i, x, z, r);
        if (!m.valid(i)) return;
        const c = m.cost();
        if (c < spot.cost) {
          spot.cost = c;
          spot.at = [x, z, r];
        }
      };
      for (let k = 0; k < 14; k++) {
        const r: Rotation = rand() < 0.2 ? turnedBy(m.rot[i]) : m.rot[i];
        m.set(i, m.x[i], m.z[i], r);
        const linked = m.partners[i].filter((j) => m.present[j] && j !== i);
        if (k % 2 === 0 && linked.length > 0) {
          const [x, z] = beside(i, pick(linked));
          consider(x, z, r);
        } else {
          const [xa, xb, za, zb] = m.range(i);
          if (xb >= xa && zb >= za) consider(randInt(xa, xb), randInt(za, zb), r);
        }
      }
      consider(here[0], here[1], here[2]);
      if (!spot.at) {
        ok = false;
        break;
      }
      m.set(i, spot.at[0], spot.at[1], spot.at[2]);
    }
    if (!ok) {
      for (const [i, x, z, r] of old) {
        m.setPresent(i, true);
        m.set(i, x, z, r);
      }
    }
    return ok;
  };

  // Start temperature: half the typical uphill step of a random shift, so the start layout is reworked a
  // little at first and then held.
  const uphill: number[] = [];
  const c0 = judge();
  for (let k = 0; k < (opts.evaluate ? 12 : 60); k++) {
    const i = randInt(0, m.n - 1);
    const was = [m.x[i], m.z[i]] as const;
    if (tryPlace(i, m.x[i] + randInt(-4, 4), m.z[i] + randInt(-4, 4))) {
      const delta = judge() - c0;
      if (delta > 0) uphill.push(delta);
      m.set(i, was[0], was[1]);
    }
  }
  const t0 = uphill.length ? ((opts.heat ?? 0.5) * uphill.reduce((s, v) => s + v, 0)) / uphill.length : 1;
  const t1 = t0 / 200;

  let current = c0;
  let best = current;
  let bestState = m.snapshot();
  const started = now();
  let truncated = false;
  let done = 0;
  for (; done < iterations; done++) {
    // A step judged by `evaluate` can take tens of milliseconds: read the clock every time then.
    if (done % 64 === 0 || opts.evaluate) {
      throwIfAborted(opts.signal);
      opts.onProgress?.(done, iterations);
      if (opts.budgetMs !== undefined && now() - started >= opts.budgetMs) {
        truncated = true;
        break;
      }
    }
    const progress = done / iterations;
    const temp = t0 * Math.pow(t1 / t0, progress);
    m.begin();
    const pickMove = rand();
    let moved = false;
    if (reshapable.length > 0 && rand() < 0.15) {
      moved = reshape();
    } else if (pickMove < 0.4) {
      const i = randInt(0, m.n - 1);
      const reach = 1 + Math.floor((1 - progress) * (1 - progress) * 0.4 * Math.max(w, d));
      moved = tryPlace(i, m.x[i] + randInt(-reach, reach), m.z[i] + randInt(-reach, reach));
    } else if (pickMove < 0.65) {
      const i = randInt(0, m.n - 1);
      if (m.partners[i].length > 0) {
        const [x, z] = beside(i, pick(m.partners[i]));
        moved = tryPlace(i, x, z);
      }
    } else if (pickMove < 0.8) {
      const i = randInt(0, m.n - 1);
      const j = (i + randInt(1, m.n - 1)) % m.n;
      const ci = [m.x[i] + m.w[i] / 2, m.z[i] + m.d[i] / 2];
      const cj = [m.x[j] + m.w[j] / 2, m.z[j] + m.d[j] / 2];
      const pi = [m.x[i], m.z[i]] as const;
      const pj = [m.x[j], m.z[j]] as const;
      m.set(i, Math.round(cj[0] - m.w[i] / 2), Math.round(cj[1] - m.d[i] / 2));
      m.set(j, Math.round(ci[0] - m.w[j] / 2), Math.round(ci[1] - m.d[j] / 2));
      if (m.valid(i) && m.valid(j)) moved = true;
      else {
        m.set(i, pi[0], pi[1]);
        m.set(j, pj[0], pj[1]);
      }
    } else if (pickMove < 0.9) {
      const i = randInt(0, m.n - 1);
      const [fx, fz] = m.footOf(i, m.rot[i]);
      const r = turnedBy(m.rot[i]);
      const [nx, nz] = m.footOf(i, r);
      moved = tryPlace(i, Math.round(m.x[i] + fx / 2 - nx / 2), Math.round(m.z[i] + fz / 2 - nz / 2), r);
    } else {
      moved = ruinAndRecreate();
    }
    if (!moved) continue;
    const next = judge();
    const delta = next - current;
    if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
      current = next;
      if (current < best - 1e-9) {
        best = current;
        bestState = m.snapshot();
      }
    } else {
      m.rollback();
    }
  }

  m.restore(bestState);
  if (!truncated) opts.onProgress?.(done, iterations);
  if (best >= before - 1e-9) return { ...unchanged, iterations: done, truncated };
  return { groups: toGroups(), before, after: best, improved: true, iterations: done, truncated };
}
