import { orientationIndex, rotatedSize } from '../geometry';
import type { MultiblockDef, Unit, UnitLayoutSettings, WallsharingVariant } from '../multiblock/types';
import { isOilCracker } from '../multiblock/structureAdapters';
import type { Candidate } from './types';
import { sourceOf } from './cache';

/** Preferences reorder the same bounded search; they never override geometry or packing limits. */
export function preferredCandidate(c: Candidate, variant: WallsharingVariant): boolean {
  if (variant === 'auto') return true;
  if (variant === 'none')
    return c.used.every(
      (n, axis) =>
        n === 1 || Math.min(c.mode.spacing[axis].inner, c.mode.spacing[axis].outer) >= c.mode.size[axis],
    );
  const axis = variant === 'stack' ? 1 : variant === 'side' ? (c.mode.parity ? 2 : 0) : c.mode.parity ? 0 : 2;
  return c.used[axis] > 1 && c.mode.spacing[axis].inner === c.mode.size[axis] - 1;
}

/** Oil Cracker's physical form is symmetric in X; only its two accepted side roles exchange places. */
export function* mirrorVariants(
  def: MultiblockDef,
  units: Unit[],
  settings?: UnitLayoutSettings,
): Generator<Unit[]> {
  if (!isOilCracker(def)) {
    yield units;
    return;
  }
  const seen = new Set<string>();
  const axes = [0, 2].map((axis) => [...new Set(units.map((u) => u.origin[axis]))].sort((a, b) => a - b));
  const lateral = units.some((u) => axes[u.rotation % 2 ? 1 : 0].length > 1);
  // A uniform reflection of a pure stack/back row creates no compatible side wall. Avoid repeating
  // its expensive capacity search; explicit per-machine overrides are still applied below.
  for (const phase of lateral ? [0, 1, -1] : [-1]) {
    const variant = units.map((u) => {
      const axis = u.rotation % 2 ? 2 : 0;
      const auto =
        phase >= 0 &&
        !!((axes[axis === 0 ? 0 : 1].indexOf(u.origin[axis]) + phase + Math.floor(u.rotation / 2)) % 2);
      const mirrored = settings?.unitMirrors?.[String(u.id)] ?? auto;
      const out = { ...u };
      if (mirrored) out.mirrored = true;
      else delete out.mirrored;
      return out;
    });
    const key = variant.map(orientationIndex).join();
    if (seen.has(key)) continue;
    seen.add(key);
    const source = sourceOf.get(units);
    if (source) sourceOf.set(variant, source);
    yield variant;
  }
}

/** Actual contacts, independently of the candidate that produced a normalised group. */
export function matchesWallsharing(
  def: MultiblockDef,
  units: readonly Unit[],
  variant: WallsharingVariant = 'auto',
): boolean {
  if (variant === 'auto' || units.length < 2) return true;
  let contact = false;
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    const sa = rotatedSize(def, a.rotation);
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      const sb = rotatedSize(def, b.rotation);
      const overlap = sa.map(
        (n, axis) =>
          Math.min(a.origin[axis] + n, b.origin[axis] + sb[axis]) - Math.max(a.origin[axis], b.origin[axis]),
      );
      if (overlap.some((n) => n <= 0)) continue;
      if (variant === 'none') return false;
      const axis =
        variant === 'stack' ? 1 : variant === 'side' ? (a.rotation % 2 ? 2 : 0) : a.rotation % 2 ? 0 : 2;
      if (overlap[axis] === 1) contact = true;
    }
  }
  return variant === 'none' || contact;
}
