import { PLACEHOLDER_ID, getSiteDef, isSingleBlock } from '../data/generic';
import { resolveMultiblockId } from '../data/multiblock-aliases';
import { getSingleMachine } from '../data/single-machines';
import { effectiveSize } from '../model/resize';
import {
  iconUrl,
  ROUTING_STYLES,
  TRANSFORMER_AMPS,
  type Endpoint,
  type HatchAssign,
  type ResourceDef,
  type RoutingDepth,
  type RoutingStyle,
  type SiteGroup,
  type SiteLink,
  type SitePort,
  type SiteRouting,
  type SiteState,
  type TransformerAmps,
} from '../model/site/types';
import type { Rotation } from '../model/core/types';
import type { HatchKind, PlanLimits } from '../model/multiblock/types';
import {
  LinkTooLargeError,
  MAX_LINK_CODE_CHARS,
  MAX_SITE_JSON_BYTES,
  PlanFormatError,
  deflateRaw,
  fromBase64Url,
  inflateRaw,
  toBase64Url,
  type CompressOptions,
} from './binary';
import {
  COLOR_RE,
  HATCH_KINDS,
  ID_RE,
  MAX_COUNT,
  MAX_LIMIT,
  MAX_SIZE,
  expectArray,
  expectHatchKind,
  expectInt,
  expectFlag,
  expectObject,
  expectTier,
  expectWallshare,
  field,
  validateHatchTiers,
} from './codec';

/**
 * Site file format (localStorage, JSON files and `#s=` links). `validateSiteState` is the only way in:
 * strict, readable errors, returns a fresh normalised copy. Links carry the validated JSON deflated (the
 * site is small: no recipes; resources keep only a checked gtnhplanner.com icon path), under the same
 * 64 KB cap as plan links.
 */

export const SITE_VERSION = 1;
export const SITE_MIN_SIZE = 8;
export const SITE_MAX_SIZE = 256;
/** Highest a group may stand above the ground (blocks). */
export const SITE_MAX_ELEVATION = 256;
export const DEFAULT_SITE_SIZE: [number, number] = [30, 30];
export const MAX_CORRIDOR = 6;
export const DEFAULT_CORRIDOR = 2;
export const MAX_GROUPS = 256;
export const MAX_LINKS = 1024;
export const MAX_PORTS = 256;
export const MAX_RESOURCES = 512;
const MAX_NAME = 120;
const MAX_KEY = 160;
const MAX_SITE_ID = 32;
export const MAX_RATE = 1e12;
/** Most machines a group may record as its source count. */
export const MAX_MACHINE_COUNT = 1e6;
/** Names with special meaning on plain objects; never resource keys. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function expectString(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new PlanFormatError(`${what} must be text of 1 to ${max} characters.`);
  }
  // Control characters are never part of a name or key.
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new PlanFormatError(`${what} contains control characters.`);
  return value;
}

function optionalString(value: unknown, what: string, max: number): string | undefined {
  return value === undefined || value === null ? undefined : expectString(value, what, max);
}

function expectId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length > MAX_SITE_ID || !ID_RE.test(value)) {
    throw new PlanFormatError(`${what} must be 1 to ${MAX_SITE_ID} of a-z, 0-9, _ and -.`);
  }
  return value;
}

function expectColor(value: unknown, what: string): string {
  if (typeof value !== 'string' || !COLOR_RE.test(value))
    throw new PlanFormatError(`${what} must look like #rrggbb.`);
  return value.toLowerCase();
}

function expectNumber(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new PlanFormatError(`${what} must be a number from ${min} to ${max}.`);
  }
  return value;
}

function expectPair(value: unknown, what: string, min: number, max: number): [number, number] {
  const arr = expectArray(value, what, 2);
  if (arr.length !== 2) throw new PlanFormatError(`${what} must have 2 numbers.`);
  return [expectInt(arr[0], `${what} x`, min, max), expectInt(arr[1], `${what} z`, min, max)];
}

function expectLimit(value: unknown, what: string): number | null {
  return value === null || value === undefined ? null : expectInt(value, what, 1, MAX_LIMIT);
}

function validateResource(value: unknown, key: string): ResourceDef {
  const what = `Resource "${key}"`;
  const obj = expectObject(value, what);
  const kind = field(obj, 'kind');
  if (kind !== 'item' && kind !== 'fluid' && kind !== 'power') {
    throw new PlanFormatError(`${what} kind must be item, fluid or power.`);
  }
  const res: ResourceDef = {
    kind,
    name: expectString(field(obj, 'name'), `${what} name`, MAX_NAME),
    color: expectColor(field(obj, 'color'), `${what} colour`),
  };
  const icon = field(obj, 'icon');
  if (icon !== undefined && icon !== null) {
    if (typeof icon !== 'string' || !iconUrl(icon))
      throw new PlanFormatError(`${what} icon must be a gtnhplanner.com /datasets/ path.`);
    res.icon = icon;
  }
  return res;
}

/** A group whose multiblock id no longer exists, shown as a placeholder. */
export interface ReplacedGroup {
  group: string;
  /** The id that was not found. */
  id: string;
}

export interface SiteLoad {
  site: SiteState;
  replaced: ReplacedGroup[];
}

const GROUP_HATCH_TIER_KEY_RE = new RegExp(`^(${HATCH_KINDS.join('|')}):(.+):(\\d{1,4}|shared)$`);
const ZONE_RE = /^[A-Za-z0-9_-]{1,32}$/;

const NO_RESOURCE_KEY_RE = /^(energy|dynamo|maintenance|muffler):\d{1,4}$/;

/**
 * `"<kind>:<resource>:<unit index>"` or `"<kind>:<resource>:shared"` (the resource key may hold colons); kinds
 * without a resource (energy, dynamo, maintenance, muffler) use `"<kind>:<ordinal>"`.
 */
function isGroupHatchTierKey(key: string): boolean {
  if (key.length > MAX_KEY || /[\u0000-\u001f\u007f]/.test(key)) return false;
  return NO_RESOURCE_KEY_RE.test(key) || GROUP_HATCH_TIER_KEY_RE.test(key);
}

/** Hatch assignments by resource key; empty entries are dropped, keys come out sorted. */
function validateAssign(value: unknown, what: string): NonNullable<SiteGroup['assign']> | undefined {
  if (value === undefined || value === null) return undefined;
  const obj = expectObject(value, `${what} assignments`);
  const keys = Object.keys(obj);
  if (keys.length > MAX_RESOURCES) throw new PlanFormatError(`${what} has too many assignments.`);
  const out: NonNullable<SiteGroup['assign']> = {};
  for (const key of keys.sort()) {
    expectString(key, `${what} assignment key`, MAX_KEY);
    if (RESERVED_KEYS.has(key)) throw new PlanFormatError(`Assignment key "${key}" is not allowed.`);
    const entry = expectObject(field(obj, key), `${what} assignment "${key}"`);
    const assign: HatchAssign = {};
    const unit = field(entry, 'unit');
    if (unit === 'all') assign.unit = 'all';
    else if (unit !== undefined && unit !== null)
      assign.unit = expectInt(unit, `${what} assignment unit`, 0, MAX_COUNT - 1);
    const zone = field(entry, 'zone');
    if (zone !== undefined && zone !== null) {
      if (typeof zone !== 'string' || !ZONE_RE.test(zone))
        throw new PlanFormatError(`${what} assignment zone must be 1 to 32 of a-z, 0-9, _ and -.`);
      assign.zone = zone;
    }
    if (assign.unit !== undefined || assign.zone !== undefined) out[key] = assign;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function validateGroup(value: unknown, index: number, replaced: ReplacedGroup[]): SiteGroup {
  const what = `Group ${index + 1}`;
  const obj = expectObject(value, what);
  const rawId = field(obj, 'multiblockId');
  if (typeof rawId !== 'string' || !ID_RE.test(rawId) || rawId.length > 64) {
    throw new PlanFormatError(`${what} multiblock id is invalid.`);
  }
  let multiblockId = resolveMultiblockId(rawId);
  const found = getSiteDef(multiblockId);
  // An id the catalog no longer has does not reject the template: the group becomes a placeholder.
  if (!found) multiblockId = PLACEHOLDER_ID;
  const def = found ?? getSiteDef(PLACEHOLDER_ID)!;
  const limitsObj = expectObject(field(obj, 'limits'), `${what} limits`);
  const limits: PlanLimits = {
    x: expectLimit(field(limitsObj, 'x'), `${what} limit X`),
    y: expectLimit(field(limitsObj, 'y'), `${what} limit Y`),
    z: expectLimit(field(limitsObj, 'z'), `${what} limit Z`),
  };
  const hatchList = expectArray(field(obj, 'enabledHatches'), `${what} hatches`, HATCH_KINDS.length);
  const enabled = new Set<HatchKind>(hatchList.map((h, i) => expectHatchKind(h, `${what} hatch ${i + 1}`)));
  const group: SiteGroup = {
    id: expectId(field(obj, 'id'), `${what} id`),
    multiblockId,
    count: expectInt(field(obj, 'count'), `${what} count`, 1, MAX_COUNT),
    limits,
    enabledHatches: HATCH_KINDS.filter((k) => enabled.has(k)),
    origin: expectPair(field(obj, 'origin'), `${what} origin`, -SITE_MAX_SIZE, 2 * SITE_MAX_SIZE),
    rotation: expectInt(field(obj, 'rotation'), `${what} rotation`, 0, 3) as Rotation,
  };
  let label = optionalString(field(obj, 'label'), `${what} label`, MAX_NAME);
  if (!found) {
    replaced.push({ group: group.id, id: rawId });
    const missing = `Missing: ${rawId}`;
    label =
      label !== undefined && `${missing} (${label})`.length <= MAX_NAME ? `${missing} (${label})` : missing;
  }
  if (label !== undefined) group.label = label;
  const machine = field(obj, 'machine');
  // A look this version does not know (a newer list) is left out rather than refused: it is only cosmetic.
  if (typeof machine === 'string' && getSingleMachine(machine) && isSingleBlock(def)) group.machine = machine;
  const elevation = field(obj, 'elevation');
  if (elevation !== undefined && elevation !== null) {
    const e = expectInt(elevation, `${what} elevation`, 0, SITE_MAX_ELEVATION);
    if (e > 0) group.elevation = e;
  }
  if (field(obj, 'limitsLocked') === true) group.limitsLocked = true;
  const tier = field(obj, 'tier');
  if (tier !== undefined && tier !== null) group.tier = expectTier(tier, `${what} tier`);
  const hatchTiers = validateHatchTiers(field(obj, 'hatchTiers'), `${what} hatch tiers`, isGroupHatchTierKey);
  if (hatchTiers) group.hatchTiers = hatchTiers;
  const glassTier = field(obj, 'glassTier');
  if (glassTier !== undefined && glassTier !== null)
    group.glassTier = expectTier(glassTier, `${what} glass tier`);
  if (expectFlag(field(obj, 'mirror'), `${what} mirror`)) group.mirror = true;
  const wallshare = field(obj, 'wallshare');
  if (wallshare !== undefined && wallshare !== null) {
    const mode = expectWallshare(wallshare, `${what} wall sharing`);
    if (mode !== 'auto') group.wallshare = mode;
  }
  const assign = validateAssign(field(obj, 'assign'), what);
  if (assign) group.assign = assign;
  // Transformer settings only mean something on a single-block machine; elsewhere the build ignores them.
  const step = field(obj, 'step');
  if (step !== undefined && step !== null) {
    if (step !== 'up' && step !== 'down') throw new PlanFormatError(`${what} step must be up or down.`);
    group.step = step;
  }
  const amps = field(obj, 'amps');
  if (amps !== undefined && amps !== null) {
    if (typeof amps !== 'number' || !(TRANSFORMER_AMPS as readonly number[]).includes(amps))
      throw new PlanFormatError(`${what} amps must be ${TRANSFORMER_AMPS.join(', ')}.`);
    group.amps = amps as TransformerAmps;
  }
  const sizeRaw = field(obj, 'size');
  if (sizeRaw !== undefined && sizeRaw !== null) {
    const size = effectiveSize(def, expectInt(sizeRaw, `${what} size`, 1, MAX_SIZE));
    if (size !== undefined) group.size = size;
  }
  const src = field(obj, 'source');
  if (src !== undefined && src !== null) {
    const s = expectObject(src, `${what} source`);
    const source: NonNullable<SiteGroup['source']> = {
      name: expectString(field(s, 'name'), `${what} source`, MAX_NAME),
    };
    const mc = field(s, 'machineCount');
    if (mc !== undefined && mc !== null)
      source.machineCount = expectNumber(mc, `${what} machine count`, 0, MAX_MACHINE_COUNT);
    const tier = optionalString(field(s, 'tier'), `${what} tier`, 16);
    if (tier !== undefined) source.tier = tier;
    group.source = source;
  }
  return group;
}

function validateEndpoint(value: unknown, what: string): Endpoint {
  const obj = expectObject(value, what);
  const group = field(obj, 'group');
  const port = field(obj, 'port');
  if ((group === undefined) === (port === undefined)) {
    throw new PlanFormatError(`${what} must name either a group or a port.`);
  }
  return group !== undefined
    ? { group: expectId(group, `${what} group`) }
    : { port: expectId(port, `${what} port`) };
}

function validateLink(value: unknown, index: number): SiteLink {
  const what = `Link ${index + 1}`;
  const obj = expectObject(value, what);
  const link: SiteLink = {
    id: expectId(field(obj, 'id'), `${what} id`),
    from: validateEndpoint(field(obj, 'from'), `${what} start`),
    to: validateEndpoint(field(obj, 'to'), `${what} end`),
    resource: expectString(field(obj, 'resource'), `${what} resource`, MAX_KEY),
  };
  const rate = field(obj, 'rate');
  if (rate !== undefined && rate !== null) link.rate = expectNumber(rate, `${what} rate`, 0, MAX_RATE);
  return link;
}

function validatePort(value: unknown, index: number): SitePort {
  const what = `Port ${index + 1}`;
  const obj = expectObject(value, what);
  const dir = field(obj, 'dir');
  if (dir !== 'in' && dir !== 'out') throw new PlanFormatError(`${what} direction must be in or out.`);
  const port: SitePort = {
    id: expectId(field(obj, 'id'), `${what} id`),
    dir,
    resource: expectString(field(obj, 'resource'), `${what} resource`, MAX_KEY),
  };
  const pos = field(obj, 'pos');
  if (pos !== undefined && pos !== null) port.pos = expectPair(pos, `${what} position`, 0, SITE_MAX_SIZE - 1);
  const isVoid = field(obj, 'void');
  if (isVoid === true && dir === 'out') port.void = true;
  return port;
}

function unique<T extends { id: string }>(list: T[], what: string): Set<string> {
  const ids = new Set<string>();
  for (const x of list) {
    if (ids.has(x.id)) throw new PlanFormatError(`${what} id "${x.id}" is used twice.`);
    ids.add(x.id);
  }
  return ids;
}

/**
 * Strict validation of an untrusted site. Checks every reference: links name existing groups, ports and
 * resources; a link starts at an `in` port or a group and ends at an `out` port or a group; a port's
 * resource matches its links. Hatch kinds are normalised to `HATCH_KINDS` order, colours to lower case.
 */
export function validateSiteState(input: unknown): SiteState {
  return validateSiteStateWithReport(input).site;
}

/** `validateSiteState`, also naming the groups whose multiblock is gone and that became placeholders. */
export function validateSiteStateWithReport(input: unknown): SiteLoad {
  const obj = expectObject(input, 'Site');
  if (field(obj, 'kind') !== 'site') throw new PlanFormatError('This is not a site file.');
  const v = field(obj, 'v');
  if (v !== SITE_VERSION)
    throw new PlanFormatError(`Unsupported site version ${JSON.stringify(v) ?? 'undefined'}.`);

  const resourcesObj = expectObject(field(obj, 'resources'), 'Resources');
  const keys = Object.keys(resourcesObj);
  if (keys.length > MAX_RESOURCES) throw new PlanFormatError('Too many resources.');
  const resources: Record<string, ResourceDef> = {};
  for (const k of keys.sort()) {
    expectString(k, 'Resource key', MAX_KEY);
    if (RESERVED_KEYS.has(k)) throw new PlanFormatError(`Resource key "${k}" is not allowed.`);
    resources[k] = validateResource(field(resourcesObj, k), k);
  }
  // Own keys only: an inherited name such as "toString" is not a resource.
  const hasResource = (k: string) => Object.hasOwn(resources, k);

  const replaced: ReplacedGroup[] = [];
  const groups = expectArray(field(obj, 'groups'), 'Groups', MAX_GROUPS).map((g, i) =>
    validateGroup(g, i, replaced),
  );
  const ports = expectArray(field(obj, 'ports'), 'Ports', MAX_PORTS).map(validatePort);
  const links = expectArray(field(obj, 'links'), 'Links', MAX_LINKS).map(validateLink);
  const groupIds = unique(groups, 'Group');
  const portIds = unique(ports, 'Port');
  unique(links, 'Link');
  const portById = new Map(ports.map((p) => [p.id, p]));
  for (const p of ports) {
    if (!hasResource(p.resource)) throw new PlanFormatError(`Port "${p.id}" uses an unknown resource.`);
  }
  links.forEach((l, i) => {
    const what = `Link ${i + 1}`;
    if (!hasResource(l.resource)) throw new PlanFormatError(`${what} uses an unknown resource.`);
    for (const [end, dir] of [
      [l.from, 'in'],
      [l.to, 'out'],
    ] as const) {
      if ('group' in end) {
        if (!groupIds.has(end.group)) throw new PlanFormatError(`${what} names an unknown group.`);
      } else {
        if (!portIds.has(end.port)) throw new PlanFormatError(`${what} names an unknown port.`);
        const port = portById.get(end.port)!;
        if (port.dir !== dir)
          throw new PlanFormatError(`${what} uses port "${port.id}" the wrong way round.`);
        if (port.resource !== l.resource)
          throw new PlanFormatError(`${what} and port "${port.id}" carry different resources.`);
      }
    }
    if ('port' in l.from && 'port' in l.to) throw new PlanFormatError(`${what} joins two ports.`);
  });

  const size = expectPair(field(obj, 'size'), 'Site size', SITE_MIN_SIZE, SITE_MAX_SIZE);
  const corridorRaw = field(obj, 'corridor');
  const corridor =
    corridorRaw === undefined ? DEFAULT_CORRIDOR : expectInt(corridorRaw, 'Corridor', 0, MAX_CORRIDOR);

  const colors: Partial<Record<HatchKind, string>> = {};
  const colorsRaw = field(obj, 'colors');
  if (colorsRaw !== undefined) {
    const c = expectObject(colorsRaw, 'Colours');
    for (const k of Object.keys(c))
      colors[expectHatchKind(k, 'Colour key')] = expectColor(field(c, k), `Colour for "${k}"`);
  }
  const ordered: Partial<Record<HatchKind, string>> = {};
  for (const k of HATCH_KINDS) if (colors[k]) ordered[k] = colors[k];

  const site: SiteState = {
    v: 1,
    kind: 'site',
    size,
    corridor,
    groups,
    links,
    ports,
    resources,
    colors: ordered,
  };
  const name = optionalString(field(obj, 'name'), 'Site name', MAX_NAME);
  if (name !== undefined) site.name = name;
  const routing = field(obj, 'routing');
  if (routing !== undefined && routing !== null) {
    const r = expectObject(routing, 'Routing');
    const style = field(r, 'style');
    if (!(ROUTING_STYLES as readonly unknown[]).includes(style))
      throw new PlanFormatError('Routing style must be classic or neat.');
    site.routing = {
      style: style as RoutingStyle,
      depth: expectInt(field(r, 'depth'), 'Routing depth', 0, 3) as RoutingDepth,
    };
  }
  const seed = field(obj, 'seed');
  if (seed !== undefined && seed !== null) site.seed = expectInt(seed, 'Seed', 0, MAX_SEED);
  return { site, replaced };
}

/** Largest seed: any unsigned 32-bit integer. */
export const MAX_SEED = 0xffffffff;

/**
 * Routing in effect: the site's own setting, or - for sites saved before it existed - the classic router
 * with the depth the browser-wide "connect below" switch gave (one layer when on, none when off).
 */
export function effectiveRouting(site: Pick<SiteState, 'routing'>, connectBelow: boolean): SiteRouting {
  return site.routing ?? { style: 'classic', depth: connectBelow ? 1 : 0 };
}

export function emptySite(): SiteState {
  return {
    v: 1,
    kind: 'site',
    size: [...DEFAULT_SITE_SIZE],
    corridor: DEFAULT_CORRIDOR,
    groups: [],
    links: [],
    ports: [],
    resources: {},
    colors: {},
  };
}

export function sitesEqual(a: SiteState, b: SiteState): boolean {
  try {
    return JSON.stringify(validateSiteState(a)) === JSON.stringify(validateSiteState(b));
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

export function siteToJson(site: SiteState): string {
  return `${JSON.stringify(validateSiteState(site), null, 2)}\n`;
}

/** Alias of the one site JSON limit (files, stored copies and decompressed links). */
export const MAX_SITE_FILE_BYTES = MAX_SITE_JSON_BYTES;

export function siteFromJson(text: string): SiteState {
  return siteFromJsonWithReport(text).site;
}

export function siteFromJsonWithReport(text: string): SiteLoad {
  if (typeof text !== 'string') throw new PlanFormatError('Site file is not text.');
  if (text.length > MAX_SITE_JSON_BYTES) throw new PlanFormatError('Site file is too large.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFormatError('Site file is not valid JSON.');
  }
  return validateSiteStateWithReport(data);
}

export async function encodeSite(site: SiteState, opts: CompressOptions = {}): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(validateSiteState(site)));
  if (bytes.length > MAX_SITE_JSON_BYTES) throw new LinkTooLargeError();
  const code = toBase64Url(await deflateRaw(bytes, opts));
  if (code.length > MAX_LINK_CODE_CHARS) throw new LinkTooLargeError();
  return code;
}

export async function decodeSite(encoded: string, opts: CompressOptions = {}): Promise<SiteState> {
  return (await decodeSiteWithReport(encoded, opts)).site;
}

export async function decodeSiteWithReport(encoded: string, opts: CompressOptions = {}): Promise<SiteLoad> {
  if (typeof encoded !== 'string' || encoded.length === 0) throw new PlanFormatError('Site link is empty.');
  const bytes = await inflateRaw(fromBase64Url(encoded), { ...opts, limit: MAX_SITE_JSON_BYTES });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PlanFormatError('Site link is damaged (not text).');
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFormatError('Site link is damaged (not JSON).');
  }
  return validateSiteStateWithReport(data);
}
