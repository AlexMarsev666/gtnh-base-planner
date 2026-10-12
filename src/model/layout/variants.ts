import { key } from '../geometry';
import type { MultiblockDef, Unit } from '../multiblock/types';
import { defCache, plainOf, sourceOf } from './cache';
import { coord, modesFor } from './modes';
import { realize } from './realize';
import type { Candidate, Mode, Spacing } from './types';

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
  // A deep or turned layout packs tighter than the plain one but leaves less room for pipes: if it does not
  // route, the plain layout and its loosenings (the sequence of old, whose loosest layout the caller keeps for
  // last) stand in for its own.
  const plain = plainOf.get(units);
  const seen = new Set<string>();
  const layoutKey = (us: readonly Unit[]) =>
    us.map((u) => `${key(u.origin)}/${u.rotation}/${u.variant ?? 0}`).join(';');
  seen.add(layoutKey(units));
  if (plain) {
    for (const us of [plain, ...loosenings(def, plain)]) {
      const k = layoutKey(us);
      if (seen.has(k)) continue;
      seen.add(k);
      yield us;
    }
    return;
  }
  const cache = defCache(def);
  const { parity, spacing, size, variants } = base.mode;
  const list: { c: Candidate; volume: number }[] = [];
  const plainModes = modesFor(def, cache);
  // A layout with deep overlaps or turned units keeps its spacing along Y and its variants: looser spacing
  // along X and Z needs no turn to be valid, so the plain modes lend theirs, and `realize` checks the rest.
  const plainBase = plainModes.includes(base.mode);
  const done = new Set<string>();
  for (const plain of plainModes) {
    const sp = plain.spacing;
    if (plain.parity !== parity) continue;
    if (plainBase && (sp[1].inner !== spacing[1].inner || sp[1].outer !== spacing[1].outer)) continue;
    if ([0, 2].some((a) => looseness(sp[a], size[a]) < looseness(spacing[a], size[a]))) continue;
    if ([0, 2].every((a) => sp[a].inner === spacing[a].inner && sp[a].outer === spacing[a].outer)) continue;
    if (plainBase && [0, 1, 2].some((a) => base.used[a] > plain.pairCaps[a])) continue;
    const id = `${sp[0].inner}/${sp[0].outer},${sp[2].inner}/${sp[2].outer}`;
    if (done.has(id)) continue;
    done.add(id);
    const mode: Mode = plainBase
      ? plain
      : { ...plain, spacing: [sp[0], spacing[1], sp[2]], variants, pairCaps: base.mode.pairCaps };
    const c: Candidate = { ...base, mode };
    list.push({ c, volume: volumeOf(c) });
  }
  list.sort((a, b) => a.volume - b.volume || a.c.mode.seq - b.c.mode.seq);
  for (const { c } of list) {
    const out = realize(def, cache, n, c);
    if (!out) continue;
    const k = layoutKey(out);
    if (seen.has(k)) continue;
    seen.add(k);
    yield out;
  }
}
