import type { Rotation } from '../core/types';
import { FLOOR_CLEARANCE } from './arrange';
import type { PlanLimits } from '../multiblock/types';
import type { SiteGroup, SiteLink, SiteState } from './types';

/**
 * Simulated annealing of the groups' places on the site.
 *
 * `arrangeSite` lays a chain out in flow order; this polishes that layout. It moves, swaps and turns groups
 * (and rebuilds a few of them around their link partners, "ruin and recreate") and keeps what shortens the
 * links and tightens the whole. It starts from the layout it is given, never leaves the site or lets two
 * groups come closer than the corridor, and hands back the best layout it saw, so the result is never worse
 * than the start by its own cost. Each group keeps its floor (`elevation`) and its count and limits.
 *
 * Cost = estimated wire length + `compact` * (width + depth of the groups' bounding box).
 * - Wire length is the half-perimeter of each net's terminals (a net: the links of one resource that share
 *   an end), measured between group centres, in X, Z and height. A boundary port without a position is an
 *   X-only terminal on its own edge (west for inputs, east for outputs), since it is placed along that edge
 *   wherever the pipes need it.
 *
 * It is an estimate: the real router decides whether a layout connects. `optimizeSite` routes the best
 * few layouts and keeps the one that does best.
 *
 * Pure and deterministic for a given seed and iteration count; a time budget only ends the run early.
 */

export interface AnnealOptions {
  /** Random seed; different seeds explore differently. Default 1. */
  seed?: number;
  /** Proposals to try. Default grows with the number of groups. */
  iterations?: number;
  /** Safety cutoff; cooling and the ordinary budget use iteration counts. */
  budgetMs?: number;
  /** Shared outer deadline; prevents nested stages from restarting a budget. */
  deadline?: number;
  /** Clock for `budgetMs`. Default `performance.now`. */
  now?: () => number;
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
  /** Keep each group's arranged row and the clear corridor before the next row on its floor. */
  alignRows?: boolean;
}

export interface AnnealResult {
  groups: SiteGroup[];
  /** Cost of the layout that was given and of the one returned. */
  before: number;
  after: number;
  /** False when nothing better was found (or the start was not a valid layout); `groups` is then the start. */
  improved: boolean;
  iterations: number;
}

/**
 * One way to pack a group: the `limits` that give it, and the footprint [x, z] and height that result (before
 * rotation). A group's current shape is the one whose `limits` match its own.
 */
export interface Shape {
  limits: PlanLimits;
  size: [number, number];
  height: number;
}

export const DEFAULT_COMPACT = 0.3;
export const DEFAULT_CENTRE = 0.25;

/** Proposals per group, and the most in one run. */
const ITERATIONS_PER_GROUP = 1500;
const MAX_ITERATIONS = 120000;

export function defaultIterations(groups: number): number {
  return Math.min(MAX_ITERATIONS, 3000 + ITERATIONS_PER_GROUP * groups);
}

interface Net {
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
    const net = nets.get(find(k)) ?? { groups: [], edgeX: [], fixed: [] };
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
  private readonly y0: number[];
  private readonly h: number[];
  private readonly gap: number;
  private readonly lo: [number, number];
  private readonly hi: [number, number];
  private readonly rowEnd: number[];

  constructor(
    readonly site: SiteState,
    sizeOf: (id: string) => [number, number] | undefined,
    heightOf: (id: string) => number,
    readonly compact: number,
    private readonly centre: number = DEFAULT_CENTRE,
    shapes?: ReadonlyMap<string, readonly Shape[]>,
    private readonly alignRows = false,
  ) {
    const gs = site.groups;
    this.n = gs.length;
    const index = new Map(gs.map((g, i) => [g.id, i]));
    this.nets = buildNets(site, index);
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
    this.rowEnd = alignRows
      ? gs.map((g) =>
          Math.min(
            this.hi[1],
            ...gs
              .filter(
                (other) => (other.elevation ?? 0) === (g.elevation ?? 0) && other.origin[1] > g.origin[1],
              )
              .map((other) => other.origin[1] - this.gap),
          ),
        )
      : [];
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

  /** Whether groups `i` and `j` are too close: less than the corridor apart and not on clear floors. */
  clash(i: number, j: number): boolean {
    if (
      this.y0[i] - (this.y0[j] + this.h[j]) >= FLOOR_CLEARANCE ||
      this.y0[j] - (this.y0[i] + this.h[i]) >= FLOOR_CLEARANCE
    )
      return false;
    return !(
      this.x[i] + this.w[i] + this.gap <= this.x[j] ||
      this.x[j] + this.w[j] + this.gap <= this.x[i] ||
      this.z[i] + this.d[i] + this.gap <= this.z[j] ||
      this.z[j] + this.d[j] + this.gap <= this.z[i]
    );
  }

  /** Whether group `i` stands inside the site and clear of every other present group. */
  valid(i: number): boolean {
    if (!this.inside(i) || (this.alignRows && this.z[i] + this.d[i] > this.rowEnd[i])) return false;
    for (let j = 0; j < this.n; j++) {
      if (j === i || !this.present[j]) continue;
      if (this.clash(i, j)) return false;
      if (
        this.alignRows &&
        this.y0[i] === this.y0[j] &&
        this.z[i] === this.z[j] &&
        this.site.groups[i].origin[0] < this.site.groups[j].origin[0] !== this.x[i] < this.x[j]
      )
        return false;
    }
    return true;
  }

  allValid(): boolean {
    for (let i = 0; i < this.n; i++) if (!this.valid(i)) return false;
    return true;
  }

  set(i: number, x: number, z: number, r: Rotation = this.rot[i], s: number = this.shape[i]): void {
    if (this.alignRows) z = this.site.groups[i].origin[1];
    if (x !== this.x[i] || z !== this.z[i] || r !== this.rot[i] || s !== this.shape[i]) {
      for (const k of this.netsOf[i]) this.dirty.add(k);
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
    for (const gi of net.groups) {
      if (!this.present[gi]) continue;
      pts++;
      const gx = this.x[gi];
      const gz = this.z[gi];
      const gy = this.y0[gi];
      const cx = gx + this.w[gi] / 2;
      const cz = gz + this.d[gi] / 2;
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
    return this.wireLength() + this.compact * this.span();
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
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const deadline = Math.min(opts.deadline ?? Infinity, started + (opts.budgetMs ?? Infinity));
  const expired = () => now() >= deadline;
  const m = new Layout(
    site,
    sizeOf,
    opts.heightOf ?? (() => 1),
    opts.compact ?? DEFAULT_COMPACT,
    opts.centre ?? DEFAULT_CENTRE,
    opts.shapes,
    opts.alignRows,
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
  };
  // Only a layout that already respects the site and the corridors can be polished: every move keeps it so.
  if (m.n === 0 || m.nets.length === 0 || !m.allValid() || expired()) return unchanged;

  const rand = rng(opts.seed ?? 1);
  const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const iterations = opts.iterations ?? defaultIterations(m.n);
  const [w, d] = site.size;
  const gap = site.corridor;

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

  /** Where `i` would sit flush against `j` on a side (aligned by centre, nudged a little). */
  const beside = (i: number, j: number): [number, number] => {
    const nudge = randInt(-2, 2);
    switch (randInt(0, 3)) {
      case 0:
        return [m.x[j] + m.w[j] + gap, m.z[j] + Math.round((m.d[j] - m.d[i]) / 2) + nudge];
      case 1:
        return [m.x[j] - m.w[i] - gap, m.z[j] + Math.round((m.d[j] - m.d[i]) / 2) + nudge];
      case 2:
        return [m.x[j] + Math.round((m.w[j] - m.w[i]) / 2) + nudge, m.z[j] + m.d[j] + gap];
      default:
        return [m.x[j] + Math.round((m.w[j] - m.w[i]) / 2) + nudge, m.z[j] - m.d[i] - gap];
    }
  };

  /** Rebuilds a few linked groups: lifts them off, then puts each back where it costs least. */
  const ruinAndRecreate = (): boolean => {
    const seed = randInt(0, m.n - 1);
    const chosen = [seed];
    for (const p of [...m.partners[seed]].sort(() => rand() - 0.5)) if (chosen.length < 3) chosen.push(p);
    if (chosen.length < 2 && m.n > 1) chosen.push((seed + randInt(1, m.n - 1)) % m.n);
    const old = chosen.map((i) => [i, m.x[i], m.z[i], m.rot[i]] as const);
    for (const i of chosen) m.setPresent(i, false);
    chosen.sort(() => rand() - 0.5);
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
        const r: Rotation = rand() < 0.2 ? (((m.rot[i] + (rand() < 0.5 ? 1 : 3)) % 4) as Rotation) : m.rot[i];
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
  const c0 = before;
  let calibrationBest = before;
  let calibrationState = m.snapshot();
  for (let k = 0; k < (opts.evaluate ? 12 : 60) && !expired(); k++) {
    const i = randInt(0, m.n - 1);
    const was = [m.x[i], m.z[i]] as const;
    if (tryPlace(i, m.x[i] + randInt(-4, 4), m.z[i] + randInt(-4, 4))) {
      const value = judge();
      const delta = value - c0;
      if (value < calibrationBest) {
        calibrationBest = value;
        calibrationState = m.snapshot();
      }
      if (delta > 0) uphill.push(delta);
      m.set(i, was[0], was[1]);
    }
  }
  const t0 = uphill.length ? ((opts.heat ?? 0.5) * uphill.reduce((s, v) => s + v, 0)) / uphill.length : 1;
  const t1 = t0 / 200;

  let current = c0;
  let best = calibrationBest;
  let bestState = calibrationState;
  let progress = 0;
  let done = 0;
  for (; done < iterations; done++) {
    if (expired()) break;
    // A step judged by `evaluate` can take tens of milliseconds: read the clock every time then.
    if (done % 64 === 0 || opts.evaluate) {
      progress = done / iterations;
      if (progress >= 1) break;
    }
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
    } else if (pickMove < 0.8 && m.n > 1) {
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
      if (fx !== fz) {
        const r = ((m.rot[i] + (rand() < 0.5 ? 1 : 3)) % 4) as Rotation;
        const [nx, nz] = m.footOf(i, r);
        moved = tryPlace(i, Math.round(m.x[i] + fx / 2 - nx / 2), Math.round(m.z[i] + fz / 2 - nz / 2), r);
      }
    } else {
      moved = ruinAndRecreate();
    }
    if (!moved) continue;
    if (expired()) {
      m.rollback();
      break;
    }
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
  if (best >= before - 1e-9) return { ...unchanged, iterations: done };
  return { groups: toGroups(), before, after: best, improved: true, iterations: done };
}
