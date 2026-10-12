import { rotatedSize } from '../geometry';
import { composeVariants } from '../mirror';
import type { Rotation, Vec3 } from '../core/types';
import type { MultiblockDef, PlanLimits } from '../multiblock/types';
import { axisVec, pairOk, sameShapes } from './shapes';
import type { DefCache, Mode, Spacing, Variant, VariantPattern } from './types';

/** Rotation patterns and per-axis spacings a multiblock can be packed with, and the limits they obey. */

/** Rotation patterns tried per lattice: base 180° flip × which horizontal axis alternates (none/Z/X). */
export const PATTERNS: readonly { flip: 0 | 1; alt: -1 | 0 | 2 }[] = [
  { flip: 0, alt: -1 },
  { flip: 1, alt: -1 },
  { flip: 0, alt: 2 },
  { flip: 1, alt: 2 },
  { flip: 0, alt: 0 },
  { flip: 1, alt: 0 },
];

export function rotationAt(parity: number, flip: number, alt: number, p: Vec3): Rotation {
  return ((parity + 2 * flip + (alt < 0 ? 0 : 2 * (p[alt] % 2))) % 4) as Rotation;
}

/** Rotation patterns that differ for the neighbours along axis `a` (the pair only sees flip and whether `a` alternates). */
function axisPatterns(a: number): readonly { flip: 0 | 1; alt: -1 | 0 | 2 }[] {
  return PATTERNS.filter(
    (p, i) => PATTERNS.findIndex((q) => q.flip === p.flip && (q.alt === a) === (p.alt === a)) === i,
  );
}

/** The variant of the unit at lattice index `p` under a variant pattern. */
export function variantAt(v: VariantPattern, p: Vec3): Variant {
  let out = v.base;
  for (let a = 0; a < 3; a++) if (p[a] % 2 === 1 && v.alt[a] !== 0) out = composeVariants(out, v.alt[a]);
  return out;
}

/** Position of the i-th unit along an axis. */
export function coord(sp: Spacing, i: number): number {
  return Math.floor(i / 2) * (sp.inner + sp.outer) + (i % 2) * sp.inner;
}

/**
 * Does the pair along axis `a` hold under one rotation pattern: unit 0 -> 1 at `dist` (`outer` false) or
 * unit 1 -> 2 (`outer` true)? The second unit's variant is `base` turned by `turn`.
 */
function stepOk(
  def: MultiblockDef,
  cache: DefCache,
  parity: number,
  dist: number,
  outer: boolean,
  a: number,
  flip: number,
  alt: number,
  base: Variant,
  turn: Variant,
): boolean {
  const r0 = rotationAt(parity, flip, alt, [0, 0, 0]);
  const r1 = rotationAt(parity, flip, alt, axisVec(a, 1));
  const v1 = turn === 0 ? base : composeVariants(base, turn);
  return outer
    ? pairOk(def, cache, r1, r0, axisVec(a, dist), v1, base)
    : pairOk(def, cache, r0, r1, axisVec(a, dist), base, v1);
}

/**
 * Most units axis `a` can hold under one rotation pattern, judging only the neighbours of the first unit
 * along it: pair (0 -> 1) at `inner` and pair (1 -> 2) at `outer`. Every later pair along the axis repeats
 * one of these two. Because the fill is a prefix of an order that is monotone in each coordinate, those two
 * pairs exist whenever an axis holds 2 (or 3) units, so this is a necessary condition for validity.
 * `base` is the variant of the first unit and `turn` what the next one is turned by (see `VariantPattern`).
 */
export function neighbourCap(
  def: MultiblockDef,
  cache: DefCache,
  parity: number,
  sp: Spacing,
  a: number,
  flip: number,
  alt: number,
  base: Variant = 0,
  turn: Variant = 0,
): number {
  if (!stepOk(def, cache, parity, sp.inner, false, a, flip, alt, base, turn)) return 1;
  if (!stepOk(def, cache, parity, sp.outer, true, a, flip, alt, base, turn)) return 2;
  return Infinity;
}

interface AxisOption {
  sp: Spacing;
  /** What the second unit along the axis is turned by. */
  turn: Variant;
  cap: number;
  wide: boolean;
}

/** Most deep spacings (see `deepOptions`) and most turned shared ones kept per axis. */
const DEEP_KEPT = 2;
const TURNED_KEPT = 1;

/** Deep spacings kept per turn of the second unit. */
const DEEP_PER_TURN = 2;

/**
 * Spacings that overlap neighbouring units deeper than the shared wall (down to the same position) and still
 * pass the first neighbour pairs under some rotation pattern. Two units must add up to at least one unit
 * length (`inner + outer >= s`): that keeps units three lattice steps apart out of each other's way. Deepest
 * first, `DEEP_PER_TURN` per turn.
 */
function deepOptions(
  def: MultiblockDef,
  cache: DefCache,
  parity: number,
  a: number,
  s: number,
  tight: number,
  base: Variant,
  turns: readonly Variant[],
): AxisOption[] {
  const found: { opt: AxisOption; sum: number }[] = [];
  const outerMax = a === 1 ? s : s + 2;
  const patterns = axisPatterns(a);
  for (const turn of turns) {
    const innerOk = new Map<number, boolean>();
    const fits = (inner: number) => {
      let ok = innerOk.get(inner);
      if (ok === undefined) {
        ok = patterns.some((p) => stepOk(def, cache, parity, inner, false, a, p.flip, p.alt, base, turn));
        innerOk.set(inner, ok);
      }
      return ok;
    };
    // Deepest first, so the search stops at the first few that work.
    let kept = 0;
    for (let sum = s; sum < 2 * tight && kept < DEEP_PER_TURN; sum++)
      for (let inner = Math.max(0, sum - outerMax); inner <= Math.min(s - 1, sum >> 1); inner++) {
        const sp = { inner, outer: sum - inner };
        if (sp.outer < 1 || kept === DEEP_PER_TURN || !fits(inner)) continue;
        const cap = Math.max(
          ...patterns.map((p) => neighbourCap(def, cache, parity, sp, a, p.flip, p.alt, base, turn)),
        );
        if (cap < 2) continue;
        // Two units on the axis never use the outer spacing: such a pair counts as a uniform spacing.
        if (
          cap === 2 &&
          found.some((o) => o.opt.turn === turn && o.opt.sp.inner === inner && o.opt.cap === 2)
        )
          continue;
        const opt = {
          sp: cap === 2 ? { inner, outer: inner } : sp,
          turn,
          cap,
          wide: cap > 2 && sp.outer > s + 1,
        };
        found.push({ opt, sum });
        kept++;
      }
  }
  return found
    .sort((x, y) => x.sum - y.sum || x.opt.sp.inner - y.opt.sp.inner || x.opt.turn - y.opt.turn)
    .map((o) => o.opt);
}

/** Are all unit variants a pattern produces on axes holding at least two units allowed for the def? */
function patternAllowed(cache: DefCache, v: VariantPattern, caps: Vec3): boolean {
  for (let bits = 0; bits < 8; bits++) {
    const p: Vec3 = [bits & 1, (bits >> 1) & 1, (bits >> 2) & 1];
    if ([0, 1, 2].every((a) => p[a] === 0 || caps[a] >= 2) && !cache.allowed.includes(variantAt(v, p)))
      return false;
  }
  return true;
}

/** The spacings of one axis and parity, and what caps units along it when the second one is turned. */
function axisSpacings(def: MultiblockDef, cache: DefCache, parity: 0 | 1, a: number) {
  const s = rotatedSize(def, parity)[a];
  const tight = def.wallshare && s >= 2 ? s - 1 : s;
  const patterns = axisPatterns(a);
  const base = 0;
  const capOf = (sp: Spacing, turn: Variant) =>
    Math.max(...patterns.map((p) => neighbourCap(def, cache, parity, sp, a, p.flip, p.alt, base, turn)));
  const uniform = (turn: Variant): AxisOption[] =>
    (tight === s
      ? [{ inner: s, outer: s }]
      : [
          { inner: tight, outer: tight },
          { inner: s, outer: s },
        ]
    ).map((sp) => ({ sp, turn, cap: capOf(sp, turn), wide: false }));
  const standard = (): AxisOption[] => {
    const axis = uniform(0);
    if (a !== 1 && axis[0].cap !== Infinity) {
      const paired: Spacing = { inner: tight, outer: s + 1 };
      axis.push({ sp: paired, turn: 0, cap: capOf(paired, 0), wide: false });
    }
    if (a !== 1) {
      // A one-block gap between all units: every side stays open for hatches that cannot be shared.
      const gap: Spacing = { inner: s + 1, outer: s + 1 };
      axis.push({ sp: gap, turn: 0, cap: capOf(gap, 0), wide: false });
      // Two-block walkways and gaps leave room for several pipes side by side (routed layouts only).
      const paired2: Spacing = { inner: tight, outer: s + 2 };
      axis.push({ sp: paired2, turn: 0, cap: capOf(paired2, 0), wide: true });
      const gap2: Spacing = { inner: s + 2, outer: s + 2 };
      axis.push({ sp: gap2, turn: 0, cap: capOf(gap2, 0), wide: true });
    }
    return axis;
  };
  return { s, tight, capOf, uniform, standard };
}

function modeOf(
  def: MultiblockDef,
  cache: DefCache,
  parity: 0 | 1,
  o: [AxisOption, AxisOption, AxisOption],
  seq: number,
  extra = false,
): Mode | null {
  const variants: VariantPattern = { base: 0, alt: [o[0].turn, o[1].turn, o[2].turn] };
  const pairCaps: Vec3 = [o[0].cap, o[1].cap, o[2].cap];
  // A plain mode keeps the plan's orientation whatever the machine allows (a forbidden one is a validity error).
  if (variants.alt.some((v) => v !== 0) && !patternAllowed(cache, variants, pairCaps)) return null;
  return {
    parity,
    size: rotatedSize(def, parity),
    spacing: [o[0].sp, o[1].sp, o[2].sp],
    variants,
    pairCaps,
    wide: o[0].wide || o[2].wide,
    seq,
    ...(extra ? { extra: true as const } : {}),
  };
}

const PARITIES = [0, 1] as const;

function plainModes(def: MultiblockDef, cache: DefCache): Mode[] {
  const modes: Mode[] = [];
  for (const parity of PARITIES) {
    const [px, py, pz] = [0, 1, 2].map((a) => axisSpacings(def, cache, parity, a).standard());
    for (const ox of px)
      for (const oy of py)
        for (const oz of pz) {
          const mode = modeOf(def, cache, parity, [ox, oy, oz], modes.length);
          if (mode) modes.push(mode);
        }
  }
  return modes;
}

/**
 * Modes that overlap units deeper than the shared wall, with alternate units turned where that helps (see
 * `VariantPattern`), for two or more units. Per axis: the deepest spacings that pass, and shared or touching ones that hold more units once
 * the second unit is turned. Alongside them only the plain spacings that leave no gap (wider ones come from
 * `loosenings`).
 */
function extraModes(def: MultiblockDef, cache: DefCache, first: number): Mode[] {
  const modes: Mode[] = [];
  // The plan's orientation (relative 0) is the base; a machine that forbids it gets no turned or deeper layouts.
  if (!cache.allowed.includes(0)) return modes;
  const base = 0;
  const turns = ([1, 2, 3] as const).filter(
    (v) => cache.allowed.includes(v) && !sameShapes(def, cache, base, v),
  );
  for (const parity of PARITIES) {
    const size = rotatedSize(def, parity);
    const axes = [0, 1, 2].map((a) => {
      const { s, tight, capOf, uniform, standard } = axisSpacings(def, cache, parity, a);
      const turned = turns.flatMap((turn) => uniform(turn).filter((o) => o.cap > capOf(o.sp, 0)));
      const deep = deepOptions(def, cache, parity, a, s, tight, base, [0, ...turns]).slice(0, DEEP_KEPT);
      const compact = standard().filter((o) => !o.wide && o.sp.inner === o.sp.outer && o.sp.inner <= size[a]);
      return { deep, all: [...compact, ...deep, ...turned.slice(0, TURNED_KEPT)] };
    });
    for (const ox of axes[0].all)
      for (const oy of axes[1].all)
        for (const oz of axes[2].all) {
          // Turning units alone (a flipped unit on a shared wall) is left out: it only comes with a deeper overlap.
          if (!axes[0].deep.includes(ox) && !axes[1].deep.includes(oy) && !axes[2].deep.includes(oz))
            continue;
          const mode = modeOf(def, cache, parity, [ox, oy, oz], first + modes.length, true);
          if (mode) modes.push(mode);
        }
  }
  return modes;
}

/**
 * The parities and spacings worth trying for a def, independent of count and limits (cached per def).
 * Horizontal axes may use a paired spacing with a walkway, but only where uniform wall sharing along that
 * axis is capped (typically the axis controllers face).
 */
export function modesFor(def: MultiblockDef, cache: DefCache): Mode[] {
  return (cache.modes ??= plainModes(def, cache));
}

/** The deep and turned modes (`extraModes`), for two or more units; they follow the plain ones in `seq`. */
export function extraModesFor(def: MultiblockDef, cache: DefCache): Mode[] {
  return (cache.extraModes ??= extraModes(def, cache, modesFor(def, cache).length));
}

function sanitizeLimit(v: number | null): number | null {
  return v === null || !Number.isFinite(v) ? null : Math.max(0, Math.floor(v));
}

const LIMIT_KEYS = ['x', 'y', 'z'] as const;

/** Per-axis unit caps of a mode under limits (neighbour rules and unit-count limits), each at most `n`. */
export function modeCaps(mode: Mode, limits: PlanLimits, n: number): Vec3 {
  const caps = [0, 1, 2].map((a) => Math.min(mode.pairCaps[a], limits[LIMIT_KEYS[a]] ?? n, n));
  return [caps[0], caps[1], caps[2]];
}

export function sanitizeLimits(limits: PlanLimits): PlanLimits {
  return { x: sanitizeLimit(limits.x), y: sanitizeLimit(limits.y), z: sanitizeLimit(limits.z) };
}
