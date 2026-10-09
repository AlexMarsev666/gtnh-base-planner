import { key } from '../geometry';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { defCache, sourceOf } from './cache';
import { coord, modesFor } from './modes';
import { realize } from './realize';
import type { Candidate, Spacing } from './types';

/** Looser versions of a packed layout: room between units for hatches, pipes and cables. */

/** Bounding volume of a candidate layout, in blocks. */
function volumeOf(c: Candidate): number {
  const { spacing, size } = c.mode;
  let v = 1;
  for (let a = 0; a < 3; a++) v *= coord(spacing[a], c.used[a] - 1) + size[a];
  return v;
}

/** Spacing families of one axis from tightest to loosest: shared, touching, walkway, gap, wide walkway, wide gap. */
function looseness(sp: Spacing, size: number): number {
  return sp.inner + sp.outer + (sp.inner === sp.outer ? 0.5 : 0) - 2 * size;
}

/**
 * The same arrangement as `units` (a layout from `packUnits` or `layoutCandidates`: same units per axis,
 * same fill order, same layers) with looser spacing along X and Z: walkways and gaps of one or two blocks
 * instead of shared walls, smallest bounding volume first, so the last one has two-block gaps all round
 * wherever the rotations allow. Yields nothing for other layouts (e.g. manual ones). Lazy and
 * deterministic; each yielded layout is valid and differs from `units` and from the ones before it.
 */
export function* loosenings(def: MultiblockDef, units: readonly Unit[]): Generator<Unit[]> {
  const base = sourceOf.get(units);
  if (!base) return;
  const n = units.length;
  const cache = defCache(def);
  const { parity, spacing, size } = base.mode;
  const list: { c: Candidate; volume: number }[] = [];
  for (const mode of modesFor(def, cache)) {
    const sp = mode.spacing;
    if (mode.parity !== parity || sp[1].inner !== spacing[1].inner || sp[1].outer !== spacing[1].outer)
      continue;
    if ([0, 2].some((a) => looseness(sp[a], size[a]) < looseness(spacing[a], size[a]))) continue;
    if ([0, 2].every((a) => sp[a].inner === spacing[a].inner && sp[a].outer === spacing[a].outer)) continue;
    if ([0, 1, 2].some((a) => base.used[a] > mode.pairCaps[a])) continue;
    const c: Candidate = { ...base, mode };
    list.push({ c, volume: volumeOf(c) });
  }
  list.sort((a, b) => a.volume - b.volume || a.c.mode.seq - b.c.mode.seq);
  const layoutKey = (us: readonly Unit[]) =>
    us.map((u) => `${key(u.origin)}/${u.rotation}/${!!u.mirrored}`).join(';');
  const seen = new Set([layoutKey(units)]);
  for (const { c } of list) {
    const realized = realize(def, cache, n, c);
    if (!realized) continue;
    const out = realized.map((u, i) => ({
      ...u,
      ...(units[i].mirrored === undefined ? {} : { mirrored: units[i].mirrored }),
    }));
    sourceOf.set(out, c);
    const k = layoutKey(out);
    if (seen.has(k)) continue;
    seen.add(k);
    yield out;
  }
}
