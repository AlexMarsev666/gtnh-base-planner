import { getSiteDef, isSingleBlock } from '../../data/generic';
import type { PlanLimits } from '../multiblock/types';
import type { Shape } from './anneal';
import type { SiteBuild, SiteBuilder } from './buildTypes';
import type { SiteGroup, SiteState } from './types';

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
  /** Absolute deadline shared with the other optimisation stages. */
  deadline?: number;
  /** Already evaluated original packing; avoids repeating its mandatory initial assessment. */
  baseline?: SiteBuild;
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
  const deadline = Math.min(opts.deadline ?? Infinity, began + (opts.budgetMs ?? Infinity));
  const expired = () => now() >= deadline;
  const out = new Map<string, Shape[]>();
  const order = site.groups
    .filter((g) => {
      const def = getSiteDef(g.multiblockId);
      return def && !isSingleBlock(def) && g.count >= 2 && !g.limitsLocked;
    })
    .sort((a, b) => a.count - b.count);
  let baseline = opts.baseline;
  for (const g of order) {
    if (expired()) break;
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
    baseline ??= builder(site, { pipes: false, cables: false, below, keepCache: true });
    const list = measure(site, g, variants, builder, below, baseline, expired);
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
  baseline: SiteBuild,
  expired: () => boolean,
): Shape[] | null {
  const current = baseline.groups.find((pg) => pg.group.id === g.id)?.build;
  if (!current) return null;
  const sameFoot = (a: Shape, b: Shape) =>
    a.size[0] === b.size[0] && a.size[1] === b.size[1] && a.height === b.height;
  const now: Shape = { limits: g.limits, size: [current.size[0], current.size[2]], height: current.size[1] };
  const list: Shape[] = [now];
  for (const limits of variants) {
    if (list.length > MAX_SHAPES || expired()) break;
    // One assessment at a time: a batch of all packings could start before the deadline and consume
    // many evaluations after it. The original IDs and links also keep logical hatch assignments stable.
    const trial = {
      ...site,
      groups: site.groups.map((group) => (group.id === g.id ? { ...group, limits } : group)),
    };
    const b = builder(trial, { pipes: false, cables: false, below, keepCache: true }).groups.find(
      (pg) => pg.group.id === g.id,
    )?.build;
    if (!b || b.pack.placed < b.pack.requested) continue;
    const shape: Shape = { limits, size: [b.size[0], b.size[2]], height: b.size[1] };
    if (b.unplaced.length > current.unplaced.length || b.missing.length > current.missing.length) continue;
    if (shape.height > MAX_HEIGHT || list.some((x) => sameFoot(x, shape))) continue;
    list.push(shape);
  }
  return list.length > 1 ? list : null;
}

function limitsKey(l: PlanLimits): string {
  return `${l.x}/${l.y}/${l.z}`;
}
