import { getSiteDef, isSingleBlock } from '../data/generic';
import { isVoltageTier, VOLTAGE_TIERS } from '../model/tiers';
import { RC2_RULES_VERSION } from '../model/multiblock/rules';
import {
  iconUrl,
  RESOURCE_ROLES,
  type ResourceRole,
  type Endpoint,
  type ResourceDef,
  type SiteGroup,
  type SiteLink,
  type SitePort,
  type SiteState,
} from '../model/site/types';
import type { Rotation } from '../model/core/types';
import type { HatchKind, PlanLimits } from '../model/multiblock/types';
import {
  MAX_PAYLOAD_BYTES,
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
  expectObject,
  field,
} from './codec';

/**
 * Site file format (localStorage, JSON files and `#s=` links). `validateSiteState` is the only way in:
 * strict, readable errors, returns a fresh normalised copy. Links carry the validated JSON deflated (the
 * site is small: no recipes; resources keep only a checked gtnhplanner.com icon path), under the same
 * 64 KB cap as plan links.
 */

export const SITE_VERSION = 2;
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
const MAX_RATE = 1e12;
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
  const gameId = optionalString(field(obj, 'gameId'), `${what} game id`, 512);
  if (gameId !== undefined) res.gameId = gameId;
  return res;
}

function validateGroup(value: unknown, index: number): SiteGroup {
  const what = `Group ${index + 1}`;
  const obj = expectObject(value, what);
  const multiblockId = field(obj, 'multiblockId');
  if (typeof multiblockId !== 'string' || !ID_RE.test(multiblockId) || multiblockId.length > 64) {
    throw new PlanFormatError(`${what} multiblock id is invalid.`);
  }
  const def = getSiteDef(multiblockId);
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
  const label = optionalString(field(obj, 'label'), `${what} label`, MAX_NAME);
  if (label !== undefined) group.label = label;
  const machine = field(obj, 'machine');
  // A look this version does not know (a newer list) is left out rather than refused: it is only cosmetic.
  if (
    typeof machine === 'string' &&
    ID_RE.test(machine) &&
    machine.length <= 64 &&
    (!def || isSingleBlock(def))
  )
    group.machine = machine;
  const tier = field(obj, 'voltageTier');
  if (tier !== undefined && tier !== null) {
    if (!isVoltageTier(tier)) throw new PlanFormatError(`${what} voltage tier is invalid.`);
    group.voltageTier = tier;
  }
  const hatchTiers = field(obj, 'hatchTiers');
  if (hatchTiers !== undefined) {
    const tiers = expectObject(hatchTiers, `${what} hatch tiers`);
    if (Object.keys(tiers).length > MAX_COUNT * 32) throw new PlanFormatError('Too many hatch assignments.');
    group.hatchTiers = {};
    for (const key of Object.keys(tiers).sort()) {
      expectString(key, 'Hatch assignment', 256);
      if (RESERVED_KEYS.has(key) || !isVoltageTier(field(tiers, key)))
        throw new PlanFormatError('Invalid hatch tier.');
      group.hatchTiers[key] = field(tiers, key) as NonNullable<SiteGroup['voltageTier']>;
    }
  }
  const bindings = field(obj, 'resourceBindings');
  const glassTier = field(obj, 'structureGlassTier');
  if (glassTier !== undefined) {
    if (!isVoltageTier(glassTier)) throw new PlanFormatError('Invalid structure glass tier.');
    group.structureGlassTier = glassTier;
  }
  const manualMode = field(obj, 'manualTransformerMode');
  if (manualMode !== undefined) {
    if (manualMode !== 'up' && manualMode !== 'down')
      throw new PlanFormatError('Invalid Manual Transformer mode.');
    group.manualTransformerMode = manualMode;
  }
  const wireless = field(obj, 'dataBankWireless');
  if (wireless !== undefined) {
    if (typeof wireless !== 'boolean') throw new PlanFormatError('Invalid Data Bank wireless setting.');
    group.dataBankWireless = wireless;
  }
  const frame = field(obj, 'steamFrameTier');
  if (frame !== undefined) {
    if (frame !== 'bronze' && frame !== 'steel')
      throw new PlanFormatError('Invalid Water Pump frame material.');
    group.steamFrameTier = frame;
  }
  const growth = field(obj, 'assemblyGrowth');
  if (growth !== undefined) {
    if (growth !== 'left' && growth !== 'right')
      throw new PlanFormatError('Invalid assembly growth direction.');
    group.assemblyGrowth = growth;
  }
  const feedSide = field(obj, 'crackingFeedSide');
  if (feedSide !== undefined) {
    if (feedSide !== 'left' && feedSide !== 'right') throw new PlanFormatError('Invalid cracking feed side.');
    group.crackingFeedSide = feedSide;
  }
  if (bindings !== undefined)
    group.resourceBindings = expectArray(bindings, `${what} resource bindings`, MAX_RESOURCES * 2).map(
      (value) => {
        const binding = expectObject(value, 'Resource binding');
        const out: NonNullable<SiteGroup['resourceBindings']>[number] = {
          kind: expectHatchKind(field(binding, 'kind'), 'Binding kind'),
          resource: expectString(field(binding, 'resource'), 'Binding resource', MAX_KEY),
        };
        const role = field(binding, 'role');
        if (role !== undefined) {
          if (!RESOURCE_ROLES.includes(role as ResourceRole))
            throw new PlanFormatError('Invalid resource role.');
          out.role = role as ResourceRole;
        }
        const slot = field(binding, 'outputSlot');
        if (slot !== undefined) out.outputSlot = expectInt(slot, 'Output slot', 0, 63);
        return out;
      },
    );
  const transformer = field(obj, 'transformer');
  if (transformer !== undefined) {
    const tr = expectObject(transformer, 'Transformer');
    const lowTier = field(tr, 'lowTier');
    const mode = field(tr, 'mode');
    const facing = field(tr, 'facing');
    if (
      !isVoltageTier(lowTier) ||
      lowTier === VOLTAGE_TIERS.at(-1) ||
      (mode !== 'up' && mode !== 'down') ||
      typeof facing !== 'string' ||
      !['north', 'east', 'south', 'west', 'up', 'down'].includes(facing)
    )
      throw new PlanFormatError('Invalid transformer settings.');
    group.transformer = { lowTier, mode, facing: facing as NonNullable<SiteGroup['transformer']>['facing'] };
  }
  const elevation = field(obj, 'elevation');
  if (elevation !== undefined && elevation !== null) {
    const e = expectInt(elevation, `${what} elevation`, 0, SITE_MAX_ELEVATION);
    if (e > 0) group.elevation = e;
  }
  if (field(obj, 'limitsLocked') === true) group.limitsLocked = true;
  const sizeRaw = field(obj, 'size');
  if (sizeRaw !== undefined && sizeRaw !== null) {
    group.size = expectInt(sizeRaw, `${what} size`, 1, MAX_SIZE);
  }
  const src = field(obj, 'source');
  if (src !== undefined && src !== null) {
    const s = expectObject(src, `${what} source`);
    const source: NonNullable<SiteGroup['source']> = {
      name: expectString(field(s, 'name'), `${what} source`, MAX_NAME),
    };
    const mc = field(s, 'machineCount');
    if (mc !== undefined && mc !== null)
      source.machineCount = expectNumber(mc, `${what} machine count`, 0, 1e6);
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
  const obj = expectObject(input, 'Site');
  if (field(obj, 'kind') !== 'site') throw new PlanFormatError('This is not a site file.');
  const v = field(obj, 'v');
  if (v !== 1 && v !== SITE_VERSION)
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

  const groups = expectArray(field(obj, 'groups'), 'Groups', MAX_GROUPS).map(validateGroup);
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
  const rulesVersion = optionalString(field(obj, 'rulesVersion'), 'Game rules version', 64);
  if (rulesVersion !== undefined) site.rulesVersion = rulesVersion;
  const routing = field(obj, 'routing');
  if (routing !== undefined) {
    const settings = expectObject(routing, 'Routing');
    const mode = field(settings, 'mode');
    if (mode !== 'compact' && mode !== 'neat') throw new PlanFormatError('Invalid routing mode.');
    site.routing = { mode, depth: expectInt(field(settings, 'depth'), 'Underground depth', 1, 6) };
  }
  return site;
}

export function emptySite(): SiteState {
  return {
    v: 1,
    rulesVersion: RC2_RULES_VERSION,
    kind: 'site',
    size: [...DEFAULT_SITE_SIZE],
    corridor: DEFAULT_CORRIDOR,
    groups: [],
    links: [],
    ports: [],
    resources: {},
    colors: {},
    routing: { mode: 'neat', depth: 3 },
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
  return `${JSON.stringify({ ...validateSiteState(site), v: SITE_VERSION }, null, 2)}\n`;
}

/** Files and stored copies may be larger than links (the payload cap applies to links only). */
export const MAX_SITE_FILE_BYTES = 1024 * 1024;

export function siteFromJson(text: string): SiteState {
  if (typeof text !== 'string') throw new PlanFormatError('Site file is not text.');
  if (text.length > MAX_SITE_FILE_BYTES) throw new PlanFormatError('Site file is too large.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlanFormatError('Site file is not valid JSON.');
  }
  return validateSiteState(data);
}

export async function encodeSite(site: SiteState, opts: CompressOptions = {}): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...validateSiteState(site), v: SITE_VERSION }));
  const code = toBase64Url(await deflateRaw(bytes, opts));
  if (code.length > MAX_PAYLOAD_BYTES)
    throw new PlanFormatError('This site is too large for a link. Download JSON instead.');
  return code;
}

export async function decodeSite(encoded: string, opts: CompressOptions = {}): Promise<SiteState> {
  if (typeof encoded !== 'string' || encoded.length === 0) throw new PlanFormatError('Site link is empty.');
  const bytes = await inflateRaw(fromBase64Url(encoded), { ...opts, limit: MAX_PAYLOAD_BYTES });
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
  return validateSiteState(data);
}
