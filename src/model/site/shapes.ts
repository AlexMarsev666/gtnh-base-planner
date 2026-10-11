import { getSiteDef, isSingleBlock } from '../../data/generic';
import type { PlanLimits } from '../multiblock/types';
import type { Shape } from './anneal';
import type { SiteBuilder } from './buildTypes';
import { throwIfAborted } from './progress';
import type { SiteGroup, SiteLink, SiteState } from './types';

/**
 * The ways each group of a site can be packed: the same machines and count with other `limits` (units along X,
 * layers, units along Z), measured by building them. The annealer moves between them.
 *
 * Candidates per group, in this order (the list is cut at `MAX_SHAPES`): one layer with rows along X or Z and
 * a few in-between grids, then two layers, then three. Groups with locked limits get none. A candidate only counts when it places every unit,
 * leaves no more hatches or resources unplaced than the group's current packing does, stays under
 * `MAX_HEIGHT` and has a footprint or height the others do not.
 */

/** Layers tried, other shapes kept per group besides the current one, and the tallest a stack may be. */
const MAX_LAYERS = 3;
const MAX_SHAPES = 6;
const MAX_HEIGHT = 24;

/** Limits worth trying for `count` units of a multiblock `size` = [x, y, z] blocks. */
function candidateLimits(count: number, size: readonly number[]): PlanLimits[] {
  const out: PlanLimits[] = [];
  const ratio = size[2] / Math.max(1, size[0]);
  for (let y = 1; y <= Math.min(MAX_LAYERS, count); y++) {
    const perLayer = Math.ceil(count / y);
    const rows = new Set<number>([1, perLayer]);
    for (const r of [Math.sqrt(perLayer), Math.sqrt(perLayer * ratio), Math.sqrt(perLayer / ratio)])
      for (const x of [Math.floor(r), Math.ceil(r)]) rows.add(Math.min(perLayer, Math.max(1, x)));
    for (const x of [...rows].sort((a, b) => a - b)) {
      const z = Math.ceil(perLayer / x);
      // With fewer layers every unit would fit, so the packer would stay lower: the same as a smaller `y`.
      if (x * z * (y - 1) >= count) continue;
      out.push({ x, y, z });
    }
  }
  return out;
}

export interface ShapeOptions {
  /** Milliseconds to spend measuring; groups left over get no shapes. Default: no limit. */
  budgetMs?: number;
  /** Clock for `budgetMs`. Default `performance.now`. */
  now?: () => number;
  /** Aborting throws `AbortedError`, checked before each group is measured. */
  signal?: AbortSignal;
}

/**
 * Shapes per group id (only groups with alternatives appear). Groups are measured smallest first, each in a
 * trial build of its own, and the cost of packing a unit seen so far decides whether the next group still
 * fits the budget: a group of a hundred units takes seconds to pack six ways.
 */
export function groupShapes(
  site: SiteState,
  builder: SiteBuilder,
  below: boolean,
  opts: ShapeOptions = {},
): Map<string, Shape[]> {
  const now = opts.now ?? (() => performance.now());
  const began = now();
  const out = new Map<string, Shape[]>();
  const order = site.groups
    .filter((g) => {
      const def = getSiteDef(g.multiblockId);
      return def && !isSingleBlock(def) && g.count >= 2 && !g.limitsLocked;
    })
    .sort((a, b) => a.count - b.count);
  /** Milliseconds per unit built, over the variants measured so far. */
  let unitsBuilt = 0;
  let spent = 0;
  for (const g of order) {
    throwIfAborted(opts.signal);
    const def = getSiteDef(g.multiblockId)!;
    const seen = new Set([limitsKey(g.limits)]);
    const variants: PlanLimits[] = [];
    for (const limits of candidateLimits(g.count, def.size)) {
      const k = limitsKey(limits);
      if (seen.has(k)) continue;
      seen.add(k);
      variants.push(limits);
    }
    if (variants.length === 0) continue;
    if (opts.budgetMs !== undefined) {
      const left = opts.budgetMs - (now() - began);
      const predicted = unitsBuilt > 0 ? (spent / unitsBuilt) * g.count * variants.length : 0;
      if (left <= 0 || predicted > left) continue;
    }
    const t = now();
    const list = measure(site, g, variants, builder, below);
    spent += now() - t;
    unitsBuilt += g.count * variants.length;
    if (list) out.set(g.id, list);
  }
  return out;
}

/** The shapes of one group: its own first, then the variants that build as well as it does. */
function measure(
  site: SiteState,
  g: SiteGroup,
  variants: PlanLimits[],
  builder: SiteBuilder,
  below: boolean,
): Shape[] | null {
  // Variants get ids of their own and a copy of every link end of their group, so they need the same hatches.
  const vid = (i: number) => `~s${i}`;
  const extra: SiteLink[] = [];
  for (const l of site.links)
    variants.forEach((_, i) => {
      for (const side of ['from', 'to'] as const) {
        const e = l[side];
        if ('group' in e && e.group === g.id)
          extra.push({ ...l, id: `${l.id}~${side}${i}`, [side]: { group: vid(i) } });
      }
    });
  const trial: SiteState = {
    ...site,
    groups: [...site.groups, ...variants.map((limits, i) => ({ ...g, id: vid(i), limits }))],
    links: [...site.links, ...extra],
  };
  const built = new Map(
    builder(trial, { pipes: false, cables: false, below, keepCache: true }).groups.map((pg) => [
      pg.group.id,
      pg.build,
    ]),
  );
  const shapeOf = (id: string, limits: PlanLimits): Shape | null => {
    const b = built.get(id);
    return b ? { limits, size: [b.size[0], b.size[2]], height: b.size[1] } : null;
  };
  const sameFoot = (a: Shape, b: Shape) =>
    a.size[0] === b.size[0] && a.size[1] === b.size[1] && a.height === b.height;
  const now = shapeOf(g.id, g.limits);
  const current = built.get(g.id);
  if (!now || !current) return null;
  const list: Shape[] = [now];
  variants.forEach((limits, i) => {
    if (list.length > MAX_SHAPES) return;
    const b = built.get(vid(i));
    const shape = shapeOf(vid(i), limits);
    if (!b || !shape) return;
    if (b.pack.placed < b.pack.requested) return;
    if (b.unplaced.length > current.unplaced.length || b.missing.length > current.missing.length) return;
    if (shape.height > MAX_HEIGHT || list.some((x) => sameFoot(x, shape))) return;
    list.push(shape);
  });
  return list.length > 1 ? list : null;
}

function limitsKey(l: PlanLimits): string {
  return `${l.x}/${l.y}/${l.z}`;
}
