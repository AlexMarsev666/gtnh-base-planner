import { getMultiblock } from '../data/catalog';
import { resolveMultiblockId } from '../data/multiblock-aliases';
import { effectiveSize } from '../model/resize';
import { TIERS, type Rotation, type Tier, type Vec3 } from '../model/core/types';
import type { HatchKind, PlanLimits, Unit } from '../model/multiblock/types';
import { WALLSHARE_MODES, type HatchTiers, type PlanState, type WallshareMode } from '../model/plan/types';
import {
  LinkTooLargeError,
  MAX_LINK_CODE_CHARS,
  MAX_PLAN_LINK_JSON,
  PlanFormatError,
  deflateRaw,
  fromBase64Url,
  inflateRaw,
  toBase64Url,
  type CompressOptions,
} from './binary';

export { LinkTooLargeError, MAX_PAYLOAD_BYTES, PlanFormatError } from './binary';

/**
 * UNIT 5 — Share codec.
 *
 * `encodePlan` serialises only `PlanState` (versioned, compact keys), compresses it with deflate-raw
 * (CompressionStream, fflate fallback) and returns base64url. A default plan must encode to < 200 chars.
 * `decodePlan` reverses it and returns a validated plan; throws on anything invalid.
 *
 * Compact wire format (JSON before deflate), version 1 — never change the meaning of a key without
 * bumping `v`:
 *   v  1                        format version (required)
 *   m  multiblock id            (required)
 *   n  count                    omitted when 4
 *   l  [x, y, z] limits         max units per axis (y = layers), 0 = unlimited; omitted when all unlimited
 *   h  enabled hatch bitmask    bit i = HATCH_KINDS[i] (required; never relative to catalog defaults,
 *                               so editing a multiblock's defaultHatches cannot change old links)
 *   c  { "<bit>": "rrggbb" }    colour overrides; omitted when empty
 *   u  [x, y, z, r, ...]        manual units (origin + rotation); omitted in auto mode
 *   i  [id, ...]                manual unit ids; omitted when they are 0, 1, 2, ...
 *   s  size                     height / length of a resizable multiblock; omitted = `resize.default`
 *                               (so a multiblock's `resize.default` must never change)
 *   t  tier index               index into `TIERS` (append only); omitted = default
 *   k  { "<key>": tier index }  hatch tier overrides, keys as in `HatchTiers`; omitted when empty
 *   g  glass tier index         index into `TIERS`; omitted = the multiblock's own glass
 *   f  1                        mirrored; omitted = not mirrored
 *   w  wallshare index          index into `WALLSHARE_MODES`; omitted = auto
 *   a  1                        one maintenance hatch may serve several units; omitted = not shared
 *   e  1                        one energy hatch may serve two units; omitted = not shared
 */

export const PLAN_VERSION = 1;
export const MIN_COUNT = 1;
export const MAX_COUNT = 2000;
/** Limits count units per axis, so they never need to exceed the unit count. */
export const MAX_LIMIT = MAX_COUNT;
export const MAX_COORD = 4096;
export const MAX_UNIT_ID = 1_000_000;
/** Largest `size` accepted from input; the multiblock's own `resize.max` clamps it further. */
export const MAX_SIZE = 64;
const DEFAULT_COUNT = 4;

/** Stable order of hatch kinds; the index is the bit used in share links. Append only. */
export const HATCH_KINDS: readonly HatchKind[] = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'energy',
  'dynamo',
  'maintenance',
  'muffler',
  'steamIn',
  'dataAccess',
];

export const ID_RE = /^[a-z0-9_-]+$/;
export const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_ID_LENGTH = 64;

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function expectObject(value: unknown, what: string): PlainObject {
  if (!isPlainObject(value)) throw new PlanFormatError(`${what} must be an object.`);
  return value;
}

export function expectArray(value: unknown, what: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new PlanFormatError(`${what} must be a list.`);
  }
  if (value.length > maxLength) throw new PlanFormatError(`${what} has too many entries.`);
  return value;
}

/** Reads an own data property; rejects getters and other non-data descriptors. */
export function field(obj: object, key: string): unknown {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return undefined;
  if (!('value' in desc)) throw new PlanFormatError(`"${key}" is not plain data.`);
  return desc.value;
}

export function expectInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new PlanFormatError(`${what} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function expectHatchKind(value: unknown, what: string): HatchKind {
  if (typeof value !== 'string' || !(HATCH_KINDS as readonly string[]).includes(value)) {
    throw new PlanFormatError(`${what} is not a known hatch kind.`);
  }
  return value as HatchKind;
}

export function expectTier(value: unknown, what: string): Tier {
  if (typeof value !== 'string' || !(TIERS as readonly string[]).includes(value)) {
    throw new PlanFormatError(`${what} is not a known tier.`);
  }
  return value as Tier;
}

export function expectWallshare(value: unknown, what: string): WallshareMode {
  if (typeof value !== 'string' || !(WALLSHARE_MODES as readonly string[]).includes(value)) {
    throw new PlanFormatError(`${what} is not a known wall sharing mode.`);
  }
  return value as WallshareMode;
}

/** `true` stays, `false` and absent mean "off" and are not stored. */
export function expectFlag(value: unknown, what: string): true | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  if (value !== true) throw new PlanFormatError(`${what} must be true or false.`);
  return true;
}

const MAX_HATCH_TIERS = 512;
const PLAN_HATCH_TIER_KEY_RE = new RegExp(`^(${HATCH_KINDS.join('|')}):\\d{1,4}$`);

/**
 * Hatch tier overrides: an object of `key -> tier`. `keyOk` decides which keys are valid (plans and site
 * groups use different key shapes). Returns keys in sorted order, or `undefined` when there are none.
 */
export function validateHatchTiers(
  value: unknown,
  what: string,
  keyOk: (key: string) => boolean = (k) => PLAN_HATCH_TIER_KEY_RE.test(k),
): HatchTiers | undefined {
  if (value === undefined || value === null) return undefined;
  const obj = expectObject(value, what);
  const keys = Object.keys(obj);
  if (keys.length > MAX_HATCH_TIERS) throw new PlanFormatError(`${what} has too many entries.`);
  const out: HatchTiers = {};
  for (const key of keys.sort()) {
    if (!keyOk(key)) throw new PlanFormatError(`${what} has an invalid hatch key "${key.slice(0, 40)}".`);
    out[key] = expectTier(field(obj, key), `${what} tier for "${key.slice(0, 40)}"`);
  }
  return keys.length > 0 ? out : undefined;
}

function expectMultiblockId(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH || !ID_RE.test(value)) {
    throw new PlanFormatError('Multiblock id is invalid.');
  }
  const id = resolveMultiblockId(value);
  if (!getMultiblock(id)) throw new PlanFormatError(`Unknown multiblock "${value}".`);
  return id;
}

function expectLimit(value: unknown, axis: string): number | null {
  if (value === null || value === undefined) return null;
  return expectInt(value, `Limit ${axis}`, 1, MAX_LIMIT);
}

function validateUnit(value: unknown, index: number): Unit {
  const what = `Unit ${index + 1}`;
  const obj = expectObject(value, what);
  const origin = expectArray(field(obj, 'origin'), `${what} origin`, 3);
  if (origin.length !== 3) throw new PlanFormatError(`${what} origin must have 3 coordinates.`);
  const pos = origin.map((c, i) =>
    expectInt(c, `${what} ${'xyz'[i]}`, -MAX_COORD, MAX_COORD),
  ) as unknown as Vec3;
  return {
    id: expectInt(field(obj, 'id'), `${what} id`, 0, MAX_UNIT_ID),
    origin: [pos[0], pos[1], pos[2]],
    rotation: expectInt(field(obj, 'rotation'), `${what} rotation`, 0, 3) as Rotation,
  };
}

/**
 * Strict validation of untrusted input (JSON files, links, localStorage):
 * known multiblock id, count 1..MAX_COUNT, integer limits (units per axis) 1..MAX_LIMIT or null, known hatch kinds, `#rrggbb` colours,
 * manual units with integer coordinates within ±512 and rotation 0..3, an integer size 1..64. Throws with a
 * readable message.
 *
 * Returns a fresh, normalised copy: hatch kinds in `HATCH_KINDS` order, lower-case colours,
 * an empty `manualUnits` list becomes `undefined`, unknown top-level keys are dropped, and `size` is
 * snapped to one the multiblock can take (dropped when it cannot be resized).
 */
export function validatePlanState(input: unknown): PlanState {
  const obj = expectObject(input, 'Plan');
  const v = field(obj, 'v');
  if (v !== PLAN_VERSION) {
    throw new PlanFormatError(`Unsupported plan version ${JSON.stringify(v) ?? 'undefined'}.`);
  }
  const multiblockId = expectMultiblockId(field(obj, 'multiblockId'));
  const count = expectInt(field(obj, 'count'), 'Count', MIN_COUNT, MAX_COUNT);

  const limitsObj = expectObject(field(obj, 'limits'), 'Limits');
  const limits: PlanLimits = {
    x: expectLimit(field(limitsObj, 'x'), 'X'),
    y: expectLimit(field(limitsObj, 'y'), 'Y'),
    z: expectLimit(field(limitsObj, 'z'), 'Z'),
  };

  const hatchList = expectArray(field(obj, 'enabledHatches'), 'Enabled hatches', HATCH_KINDS.length);
  const enabled = new Set<HatchKind>();
  hatchList.forEach((h, i) => {
    const kind = expectHatchKind(h, `Enabled hatch ${i + 1}`);
    if (enabled.has(kind)) throw new PlanFormatError(`Hatch "${kind}" is listed twice.`);
    enabled.add(kind);
  });
  const enabledHatches = HATCH_KINDS.filter((k) => enabled.has(k));

  const colorsRaw = field(obj, 'colors');
  const colors: Partial<Record<HatchKind, string>> = {};
  if (colorsRaw !== undefined) {
    const colorsObj = expectObject(colorsRaw, 'Colours');
    const keys = Object.keys(colorsObj);
    if (keys.length > HATCH_KINDS.length) throw new PlanFormatError('Too many colours.');
    const byKind = new Map<HatchKind, string>();
    for (const key of keys) {
      const kind = expectHatchKind(key, 'Colour key');
      const value = field(colorsObj, key);
      if (typeof value !== 'string' || !COLOR_RE.test(value)) {
        throw new PlanFormatError(`Colour for "${kind}" must look like #rrggbb.`);
      }
      byKind.set(kind, value.toLowerCase());
    }
    for (const kind of HATCH_KINDS) {
      const value = byKind.get(kind);
      if (value !== undefined) colors[kind] = value;
    }
  }

  const plan: PlanState = { v: 1, multiblockId, count, limits, enabledHatches, colors };

  const unitsRaw = field(obj, 'manualUnits');
  if (unitsRaw !== undefined && unitsRaw !== null) {
    const units = expectArray(unitsRaw, 'Manual units', MAX_COUNT).map(validateUnit);
    const ids = new Set<number>();
    for (const u of units) {
      if (ids.has(u.id)) throw new PlanFormatError(`Unit id ${u.id} is used twice.`);
      ids.add(u.id);
    }
    if (units.length > 0) plan.manualUnits = units;
  }

  const sizeRaw = field(obj, 'size');
  if (sizeRaw !== undefined && sizeRaw !== null) {
    const size = effectiveSize(getMultiblock(multiblockId)!, expectInt(sizeRaw, 'Size', 1, MAX_SIZE));
    if (size !== undefined) plan.size = size;
  }

  const tier = field(obj, 'tier');
  if (tier !== undefined && tier !== null) plan.tier = expectTier(tier, 'Tier');
  const hatchTiers = validateHatchTiers(field(obj, 'hatchTiers'), 'Hatch tiers');
  if (hatchTiers) plan.hatchTiers = hatchTiers;
  const glassTier = field(obj, 'glassTier');
  if (glassTier !== undefined && glassTier !== null) plan.glassTier = expectTier(glassTier, 'Glass tier');
  if (expectFlag(field(obj, 'mirror'), 'Mirror')) plan.mirror = true;
  const wallshareRaw = field(obj, 'wallshare');
  if (wallshareRaw !== undefined && wallshareRaw !== null) {
    const wallshare = expectWallshare(wallshareRaw, 'Wall sharing');
    if (wallshare !== 'auto') plan.wallshare = wallshare;
  }
  if (expectFlag(field(obj, 'shareMaintenance'), 'Share maintenance')) plan.shareMaintenance = true;
  if (expectFlag(field(obj, 'shareEnergy'), 'Share energy')) plan.shareEnergy = true;
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Compact form
// ---------------------------------------------------------------------------------------------

interface CompactPlan {
  v: number;
  m: string;
  n?: number;
  l?: number[];
  h: number;
  c?: Record<string, string>;
  u?: number[];
  i?: number[];
  s?: number;
  t?: number;
  k?: Record<string, number>;
  g?: number;
  f?: 1;
  w?: number;
  a?: 1;
  e?: 1;
}

const COMPACT_KEYS = new Set([
  'v',
  'm',
  'n',
  'l',
  'h',
  'c',
  'u',
  'i',
  's',
  't',
  'k',
  'g',
  'f',
  'w',
  'a',
  'e',
]);

function hatchMask(kinds: readonly HatchKind[]): number {
  let mask = 0;
  for (const k of kinds) {
    const bit = HATCH_KINDS.indexOf(k);
    if (bit >= 0) mask |= 1 << bit;
  }
  return mask;
}

/** Compact form of an already validated plan. Deterministic: equal plans give equal output. */
function toCompact(plan: PlanState): CompactPlan {
  const out: CompactPlan = { v: plan.v, m: plan.multiblockId, h: hatchMask(plan.enabledHatches) };
  if (plan.count !== DEFAULT_COUNT) out.n = plan.count;
  const { x, y, z } = plan.limits;
  if (x !== null || y !== null || z !== null) out.l = [x ?? 0, y ?? 0, z ?? 0];
  const colors: Record<string, string> = {};
  let hasColors = false;
  HATCH_KINDS.forEach((kind, bit) => {
    const color = plan.colors[kind];
    if (color) {
      colors[String(bit)] = color.slice(1);
      hasColors = true;
    }
  });
  if (hasColors) out.c = colors;
  if (plan.manualUnits && plan.manualUnits.length > 0) {
    out.u = plan.manualUnits.flatMap((u) => [u.origin[0], u.origin[1], u.origin[2], u.rotation]);
    if (plan.manualUnits.some((u, i) => u.id !== i)) out.i = plan.manualUnits.map((u) => u.id);
  }
  if (plan.size !== undefined) out.s = plan.size;
  if (plan.tier !== undefined) out.t = TIERS.indexOf(plan.tier);
  if (plan.hatchTiers) {
    out.k = {};
    for (const key of Object.keys(plan.hatchTiers).sort()) out.k[key] = TIERS.indexOf(plan.hatchTiers[key]);
  }
  if (plan.glassTier !== undefined) out.g = TIERS.indexOf(plan.glassTier);
  if (plan.mirror) out.f = 1;
  if (plan.wallshare !== undefined && plan.wallshare !== 'auto')
    out.w = WALLSHARE_MODES.indexOf(plan.wallshare);
  if (plan.shareMaintenance) out.a = 1;
  if (plan.shareEnergy) out.e = 1;
  return out;
}

function fromCompact(input: unknown): PlanState {
  const obj = expectObject(input, 'Plan');
  for (const key of Object.keys(obj)) {
    if (!COMPACT_KEYS.has(key)) throw new PlanFormatError(`Unexpected field "${key}" in plan link.`);
  }
  const v = field(obj, 'v');
  if (v !== PLAN_VERSION) {
    throw new PlanFormatError(`Unsupported plan version ${JSON.stringify(v) ?? 'undefined'}.`);
  }
  const multiblockId = expectMultiblockId(field(obj, 'm'));

  const n = field(obj, 'n');
  const count = n === undefined ? DEFAULT_COUNT : n;

  const l = field(obj, 'l');
  let limits: PlanLimits = { x: null, y: null, z: null };
  if (l !== undefined) {
    const arr = expectArray(l, 'Limits', 3);
    if (arr.length !== 3) throw new PlanFormatError('Limits must have 3 values.');
    const [lx, ly, lz] = arr.map((a, i) => (a === 0 ? null : expectLimit(a, 'XYZ'[i] ?? '')));
    limits = { x: lx ?? null, y: ly ?? null, z: lz ?? null };
  }

  const mask = expectInt(field(obj, 'h'), 'Hatch mask', 0, 2 ** HATCH_KINDS.length - 1);
  const enabledHatches = HATCH_KINDS.filter((_, bit) => (mask >> bit) & 1);

  const colors: Partial<Record<HatchKind, string>> = {};
  const c = field(obj, 'c');
  if (c !== undefined) {
    const cObj = expectObject(c, 'Colours');
    for (const key of Object.keys(cObj)) {
      const kind = /^(?:[0-9]|[1-9][0-9])$/.test(key) ? HATCH_KINDS[Number(key)] : undefined;
      if (!kind) throw new PlanFormatError('Colour key is not a known hatch kind.');
      const value = field(cObj, key);
      if (typeof value !== 'string' || !/^[0-9a-f]{6}$/i.test(value)) {
        throw new PlanFormatError(`Colour for "${kind}" must look like rrggbb.`);
      }
      colors[kind] = `#${value}`;
    }
  }

  const plan: Record<string, unknown> = {
    v,
    multiblockId,
    count,
    limits,
    enabledHatches,
    colors,
  };

  const u = field(obj, 'u');
  const ids = field(obj, 'i');
  if (u !== undefined) {
    const flat = expectArray(u, 'Manual units', MAX_COUNT * 4);
    if (flat.length % 4 !== 0) throw new PlanFormatError('Manual units are damaged.');
    const unitCount = flat.length / 4;
    const idList = ids === undefined ? null : expectArray(ids, 'Unit ids', MAX_COUNT);
    if (idList && idList.length !== unitCount) throw new PlanFormatError('Unit ids are damaged.');
    plan.manualUnits = Array.from({ length: unitCount }, (_, k) => ({
      id: idList ? idList[k] : k,
      origin: [flat[4 * k], flat[4 * k + 1], flat[4 * k + 2]],
      rotation: flat[4 * k + 3],
    }));
  } else if (ids !== undefined) {
    throw new PlanFormatError('Unit ids without units.');
  }
  const size = field(obj, 's');
  if (size !== undefined) plan.size = size;
  const t = field(obj, 't');
  if (t !== undefined) plan.tier = TIERS[expectInt(t, 'Tier', 0, TIERS.length - 1)];
  const k = field(obj, 'k');
  if (k !== undefined) {
    const kObj = expectObject(k, 'Hatch tiers');
    const tiers: Record<string, Tier> = {};
    for (const key of Object.keys(kObj)) {
      // defineProperty, so a key such as "__proto__" stays an own key and is refused by validation.
      Object.defineProperty(tiers, key, {
        value: TIERS[expectInt(field(kObj, key), 'Hatch tier', 0, TIERS.length - 1)],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    plan.hatchTiers = tiers;
  }
  const g = field(obj, 'g');
  if (g !== undefined) plan.glassTier = TIERS[expectInt(g, 'Glass tier', 0, TIERS.length - 1)];
  const f = field(obj, 'f');
  if (f !== undefined) {
    if (f !== 1) throw new PlanFormatError('Mirror flag is damaged.');
    plan.mirror = true;
  }
  const w = field(obj, 'w');
  if (w !== undefined)
    plan.wallshare = WALLSHARE_MODES[expectInt(w, 'Wall sharing', 0, WALLSHARE_MODES.length - 1)];
  const a = field(obj, 'a');
  if (a !== undefined) {
    if (a !== 1) throw new PlanFormatError('Share maintenance flag is damaged.');
    plan.shareMaintenance = true;
  }
  const e = field(obj, 'e');
  if (e !== undefined) {
    if (e !== 1) throw new PlanFormatError('Share energy flag is damaged.');
    plan.shareEnergy = true;
  }
  return validatePlanState(plan);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/**
 * True when two plans describe the same build (hatch order and colour case do not matter,
 * an empty manual list equals auto mode). Invalid plans are compared structurally.
 */
export function plansEqual(a: PlanState, b: PlanState): boolean {
  let ka: string;
  let kb: string;
  try {
    ka = JSON.stringify(toCompact(validatePlanState(a)));
    kb = JSON.stringify(toCompact(validatePlanState(b)));
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return ka === kb;
}

export async function encodePlan(state: PlanState, opts: CompressOptions = {}): Promise<string> {
  const json = JSON.stringify(toCompact(validatePlanState(state)));
  const bytes = new TextEncoder().encode(json);
  if (bytes.length > MAX_PLAN_LINK_JSON) throw new LinkTooLargeError();
  const code = toBase64Url(await deflateRaw(bytes, opts));
  if (code.length > MAX_LINK_CODE_CHARS) throw new LinkTooLargeError();
  return code;
}

export async function decodePlan(encoded: string, opts: CompressOptions = {}): Promise<PlanState> {
  if (typeof encoded !== 'string') throw new PlanFormatError('Plan link is missing.');
  if (encoded.length === 0) throw new PlanFormatError('Plan link is empty.');
  const compressed = fromBase64Url(encoded);
  const bytes = await inflateRaw(compressed, { ...opts, limit: MAX_PLAN_LINK_JSON });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PlanFormatError('Plan link is damaged (not text).');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFormatError('Plan link is damaged (not JSON).');
  }
  return fromCompact(data);
}
