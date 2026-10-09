import type { Rotation, Vec3 } from '../model/core/types';
import type { HatchKind, PlanLimits, Unit } from '../model/multiblock/types';
import type { PlanState } from '../model/plan/types';
import { isVoltageTier, type VoltageTier } from '../model/tiers';
import {
  MAX_PAYLOAD_BYTES,
  PlanFormatError,
  deflateRaw,
  fromBase64Url,
  inflateRaw,
  toBase64Url,
  type CompressOptions,
} from './binary';

export { MAX_PAYLOAD_BYTES, PlanFormatError } from './binary';

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
 */

export const PLAN_VERSION = 2;
export const MIN_COUNT = 1;
export const MAX_COUNT = 2000;
/** Limits count units per axis, so they never need to exceed the unit count. */
export const MAX_LIMIT = MAX_COUNT;
export const MAX_COORD = 4096;
export const MAX_UNIT_ID = 1_000_000;
/** Document bound, independent of current game rules or catalog availability. Older plans used 64. */
export const MAX_SIZE = 256;
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
  'cryotheumIn',
  'pyrotheumIn',
  'dataAccess',
  'assemblyDataIn',
  'assemblyDataOut',
  'wirelessAssemblyDataIn',
  'wirelessAssemblyDataOut',
  'electrodeIn',
  'electrodeBus',
  'electrodeDetector',
  'computationIn',
  'computationOut',
  'wirelessComputationIn',
  'wirelessComputationOut',
  'uncertainty',
  'computerRack',
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

function expectMultiblockId(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH || !ID_RE.test(value)) {
    throw new PlanFormatError('Multiblock id is invalid.');
  }
  return value;
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
  const mirrored = field(obj, 'mirrored');
  if (mirrored !== undefined && typeof mirrored !== 'boolean')
    throw new PlanFormatError(`${what} mirror must be boolean.`);
  return {
    id: expectInt(field(obj, 'id'), `${what} id`, 0, MAX_UNIT_ID),
    origin: [pos[0], pos[1], pos[2]],
    rotation: expectInt(field(obj, 'rotation'), `${what} rotation`, 0, 3) as Rotation,
    ...(mirrored === undefined ? {} : { mirrored }),
  };
}

/**
 * Strict validation of untrusted input (JSON files, links, localStorage):
 * known multiblock id, count 1..MAX_COUNT, integer limits (units per axis) 1..MAX_LIMIT or null, known hatch kinds, `#rrggbb` colours,
 * manual units with bounded integer coordinates and rotation 0..3, a bounded integer size. Throws with a
 * readable message.
 *
 * Returns a fresh, normalised copy: hatch kinds in `HATCH_KINDS` order, lower-case colours,
 * an empty `manualUnits` list becomes `undefined`, unknown top-level keys are dropped, and `size` is
 * retained even when it violates current game rules.
 */
export function validatePlanState(input: unknown): PlanState {
  const obj = expectObject(input, 'Plan');
  const v = field(obj, 'v');
  if (v !== 1 && v !== PLAN_VERSION) {
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
  const tier = field(obj, 'voltageTier');
  if (tier !== undefined && tier !== null) {
    if (!isVoltageTier(tier)) throw new PlanFormatError('Invalid voltage tier.');
    plan.voltageTier = tier;
  }
  const hatchTiers = field(obj, 'hatchTiers');
  const glassTier = field(obj, 'structureGlassTier');
  if (glassTier !== undefined) {
    if (!isVoltageTier(glassTier)) throw new PlanFormatError('Invalid structure glass tier.');
    plan.structureGlassTier = glassTier;
  }
  const manualMode = field(obj, 'manualTransformerMode');
  if (manualMode !== undefined) {
    if (manualMode !== 'up' && manualMode !== 'down')
      throw new PlanFormatError('Invalid Manual Transformer mode.');
    plan.manualTransformerMode = manualMode;
  }
  const wireless = field(obj, 'dataBankWireless');
  if (wireless !== undefined) {
    if (typeof wireless !== 'boolean') throw new PlanFormatError('Invalid Data Bank wireless setting.');
    plan.dataBankWireless = wireless;
  }
  const frame = field(obj, 'steamFrameTier');
  if (frame !== undefined) {
    if (frame !== 'bronze' && frame !== 'steel')
      throw new PlanFormatError('Invalid Water Pump frame material.');
    plan.steamFrameTier = frame;
  }
  const growth = field(obj, 'assemblyGrowth');
  if (growth !== undefined) {
    if (growth !== 'left' && growth !== 'right')
      throw new PlanFormatError('Invalid assembly growth direction.');
    plan.assemblyGrowth = growth;
  }
  if (hatchTiers !== undefined) {
    const tiers = expectObject(hatchTiers, 'Hatch tiers');
    if (Object.keys(tiers).length > MAX_COUNT * 32) throw new PlanFormatError('Too many hatch assignments.');
    plan.hatchTiers = {};
    for (const key of Object.keys(tiers).sort()) {
      if (
        !key.length ||
        key.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !isVoltageTier(field(tiers, key))
      )
        throw new PlanFormatError('Invalid hatch tier.');
      plan.hatchTiers[key] = field(tiers, key) as VoltageTier;
    }
  }
  const rulesVersion = field(obj, 'rulesVersion');
  if (rulesVersion !== undefined && rulesVersion !== null) {
    if (
      typeof rulesVersion !== 'string' ||
      !rulesVersion.length ||
      rulesVersion.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(rulesVersion)
    )
      throw new PlanFormatError('Game rules version must be text of 1 to 64 characters.');
    plan.rulesVersion = rulesVersion;
  }

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
    plan.size = expectInt(sizeRaw, 'Size', 1, MAX_SIZE);
  }
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
  um?: (boolean | null)[];
  s?: number;
  r?: string;
  t?: VoltageTier;
  tm?: 'up' | 'down';
  dw?: boolean;
  ag?: 'left' | 'right';
  sf?: 'bronze' | 'steel';
  g?: VoltageTier;
  a?: Record<string, VoltageTier>;
}

const COMPACT_KEYS = new Set([
  'um',
  'v',
  'm',
  'n',
  'l',
  'h',
  'c',
  'u',
  'i',
  's',
  'r',
  't',
  'tm',
  'a',
  'g',
  'dw',
  'ag',
  'sf',
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
  const out: CompactPlan = { v: PLAN_VERSION, m: plan.multiblockId, h: hatchMask(plan.enabledHatches) };
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
    if (plan.manualUnits.some((u) => u.mirrored !== undefined))
      out.um = plan.manualUnits.map((u) => u.mirrored ?? null);
  }
  if (plan.size !== undefined) out.s = plan.size;
  if (plan.rulesVersion !== undefined) out.r = plan.rulesVersion;
  if (plan.voltageTier !== undefined) out.t = plan.voltageTier;
  if (plan.manualTransformerMode !== undefined) out.tm = plan.manualTransformerMode;
  if (plan.dataBankWireless !== undefined) out.dw = plan.dataBankWireless;
  if (plan.assemblyGrowth !== undefined) out.ag = plan.assemblyGrowth;
  if (plan.steamFrameTier !== undefined) out.sf = plan.steamFrameTier;
  if (plan.structureGlassTier !== undefined) out.g = plan.structureGlassTier;
  if (plan.hatchTiers !== undefined) out.a = plan.hatchTiers;
  return out;
}

function fromCompact(input: unknown): PlanState {
  const obj = expectObject(input, 'Plan');
  for (const key of Object.keys(obj)) {
    if (!COMPACT_KEYS.has(key)) throw new PlanFormatError(`Unexpected field "${key}" in plan link.`);
  }
  const v = field(obj, 'v');
  if (v !== 1 && v !== PLAN_VERSION) {
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

  const wireKinds = v === 1 ? HATCH_KINDS.slice(0, 9) : HATCH_KINDS;
  const mask = expectInt(field(obj, 'h'), 'Hatch mask', 0, 2 ** wireKinds.length - 1);
  const enabledHatches = wireKinds.filter((_, bit) => (mask >> bit) & 1);

  const colors: Partial<Record<HatchKind, string>> = {};
  const c = field(obj, 'c');
  if (c !== undefined) {
    const cObj = expectObject(c, 'Colours');
    for (const key of Object.keys(cObj)) {
      const kind = /^(0|[1-9][0-9]*)$/.test(key) ? wireKinds[Number(key)] : undefined;
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
  if (field(obj, 'r') !== undefined) plan.rulesVersion = field(obj, 'r');
  if (field(obj, 't') !== undefined) plan.voltageTier = field(obj, 't');
  if (field(obj, 'tm') !== undefined) plan.manualTransformerMode = field(obj, 'tm');
  if (field(obj, 'dw') !== undefined) plan.dataBankWireless = field(obj, 'dw');
  if (field(obj, 'ag') !== undefined) plan.assemblyGrowth = field(obj, 'ag');
  if (field(obj, 'sf') !== undefined) plan.steamFrameTier = field(obj, 'sf');
  if (field(obj, 'g') !== undefined) plan.structureGlassTier = field(obj, 'g');
  if (field(obj, 'a') !== undefined) plan.hatchTiers = field(obj, 'a');
  const ids = field(obj, 'i');
  const mirrors = field(obj, 'um');
  if (u !== undefined) {
    const flat = expectArray(u, 'Manual units', MAX_COUNT * 4);
    if (flat.length % 4 !== 0) throw new PlanFormatError('Manual units are damaged.');
    const unitCount = flat.length / 4;
    const idList = ids === undefined ? null : expectArray(ids, 'Unit ids', MAX_COUNT);
    if (idList && idList.length !== unitCount) throw new PlanFormatError('Unit ids are damaged.');
    const mirrorList = mirrors === undefined ? null : expectArray(mirrors, 'Unit mirrors', MAX_COUNT);
    if (mirrorList && mirrorList.length !== unitCount) throw new PlanFormatError('Unit mirrors are damaged.');
    if (mirrorList?.some((mirror) => mirror !== null && typeof mirror !== 'boolean'))
      throw new PlanFormatError('Invalid unit mirror.');
    plan.manualUnits = Array.from({ length: unitCount }, (_, k) => ({
      id: idList ? idList[k] : k,
      origin: [flat[4 * k], flat[4 * k + 1], flat[4 * k + 2]],
      rotation: flat[4 * k + 3],
      ...(mirrorList && mirrorList[k] !== null ? { mirrored: mirrorList[k] } : {}),
    }));
  } else if (ids !== undefined || mirrors !== undefined) {
    throw new PlanFormatError('Unit ids without units.');
  }
  const size = field(obj, 's');
  if (size !== undefined) plan.size = size;
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
  return toBase64Url(await deflateRaw(bytes, opts));
}

export async function decodePlan(encoded: string, opts: CompressOptions = {}): Promise<PlanState> {
  if (typeof encoded !== 'string') throw new PlanFormatError('Plan link is missing.');
  if (encoded.length === 0) throw new PlanFormatError('Plan link is empty.');
  const compressed = fromBase64Url(encoded);
  const bytes = await inflateRaw(compressed, { ...opts, limit: MAX_PAYLOAD_BYTES });
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
