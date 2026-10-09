import { getSiteDef, isSingleBlock, TRANSFORMER_ID } from '../data/generic';
import { getSingleMachine, singleMachineTiers } from '../data/single-machines';
import { fallbackColor } from '../model/site/resourceColor';
import { defaultGroupHatches, IO_KINDS } from '../model/site/group';
import type { Endpoint, ResourceKind, SiteGroup, SiteState } from '../model/site/types';
import { effectiveSize } from '../model/resize';
import { minimumGlassTier } from '../model/multiblock/glass';
import type { Rotation } from '../model/core/types';
import type { HatchKind, PlanLimits } from '../model/multiblock/types';
import type { PlanState } from '../model/plan/types';
import {
  MAX_CORRIDOR,
  MAX_GROUPS,
  MAX_LINKS,
  MAX_PORTS,
  SITE_MAX_ELEVATION,
  SITE_MAX_SIZE,
  SITE_MIN_SIZE,
  emptySite,
} from '../share/siteCodec';
import { isolate, site, siteGroup, siteNet } from '../state/site';
import { clampCount } from './fields';
import { isVoltageTier } from '../model/tiers';

/* Pure site transforms (tested) + thin store wrappers used by the site components. */

function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/**
 * The group's own limit axis behind a site-axis field. Limits pack the group before it is turned, so on a
 * group turned a quarter (rotation 1 or 3) its X limit runs along the site's Z and the other way round.
 */
export function groupLimitAxis(axis: keyof PlanLimits, rotation: Rotation): keyof PlanLimits {
  if (axis === 'y' || rotation % 2 === 0) return axis;
  return axis === 'x' ? 'z' : 'x';
}

/** Drops ports no link uses and resources nothing uses. */
export function pruned(s: SiteState): SiteState {
  const portIds = new Set(
    s.links.flatMap((l) => [l.from, l.to]).flatMap((e) => ('port' in e ? [e.port] : [])),
  );
  const ports = s.ports.filter((p) => portIds.has(p.id));
  const used = new Set([...s.links.map((l) => l.resource), ...ports.map((p) => p.resource)]);
  const resources = Object.fromEntries(Object.entries(s.resources).filter(([k]) => used.has(k)));
  return { ...s, ports, resources };
}

/** A new group of `multiblockId` at `origin` (default: east of every group). */
export function withGroupAdded(s: SiteState, multiblockId: string, origin?: [number, number]): SiteState {
  const def = getSiteDef(multiblockId);
  if (!def || s.groups.length >= MAX_GROUPS) return s;
  const g: SiteGroup = {
    id: nextId(
      'g',
      s.groups.map((x) => x.id),
    ),
    multiblockId,
    count: 1,
    limits: { x: null, y: 1, z: null },
    enabledHatches: defaultGroupHatches(def),
    origin: origin ?? [3, 3],
    rotation: 0,
    voltageTier: def.minimumVoltageTier ?? 'LV',
    ...(minimumGlassTier(def) ? { structureGlassTier: minimumGlassTier(def) } : {}),
  };
  if (multiblockId === TRANSFORMER_ID) g.transformer = { lowTier: 'LV', mode: 'down', facing: 'north' };
  return { ...s, groups: [...s.groups, g] };
}

/** The current single-machine plan as a new site group. */
export function withPlanAdded(s: SiteState, p: PlanState, origin?: [number, number]): SiteState {
  const added = withGroupAdded(s, p.multiblockId, origin);
  if (added === s) return s;
  const g = added.groups[added.groups.length - 1];
  const next: SiteGroup = {
    ...g,
    count: p.count,
    limits: { ...p.limits },
    enabledHatches: [...p.enabledHatches],
    ...(p.voltageTier ? { voltageTier: p.voltageTier } : {}),
    ...(p.hatchTiers ? { hatchTiers: { ...p.hatchTiers } } : {}),
    ...(p.manualTransformerMode ? { manualTransformerMode: p.manualTransformerMode } : {}),
    ...(p.dataBankWireless !== undefined ? { dataBankWireless: p.dataBankWireless } : {}),
    ...(p.assemblyGrowth !== undefined ? { assemblyGrowth: p.assemblyGrowth } : {}),
    ...(p.steamFrameTier !== undefined ? { steamFrameTier: p.steamFrameTier } : {}),
    ...(p.structureGlassTier ? { structureGlassTier: p.structureGlassTier } : {}),
  };
  // A transferred saved plan keeps its original glass, including an absent selection.
  if (!p.structureGlassTier) delete next.structureGlassTier;
  // Limits set in the machine view are the user's: keep them.
  if (Object.values(p.limits).some((v) => v !== null && v !== undefined)) next.limitsLocked = true;
  if (p.size !== undefined) next.size = p.size;
  return { ...added, groups: [...added.groups.slice(0, -1), next] };
}

export function withGroupRemoved(s: SiteState, id: string): SiteState {
  if (!s.groups.some((g) => g.id === id)) return s;
  const touches = (e: Endpoint) => 'group' in e && e.group === id;
  return pruned({
    ...s,
    groups: s.groups.filter((g) => g.id !== id),
    links: s.links.filter((l) => !touches(l.from) && !touches(l.to)),
  });
}

export interface GroupPatch {
  multiblockId?: string;
  count?: number;
  size?: number;
  /** Editing the limits by hand also locks them (see `SiteGroup.limitsLocked`) unless `limitsLocked` says otherwise. */
  limits?: PlanLimits;
  limitsLocked?: boolean;
  origin?: [number, number];
  /** Single-block machines: which machine they are (see `SiteGroup.machine`); null clears it. */
  machine?: string | null;
  /** Blocks above the ground; 0 puts the group back on it. */
  elevation?: number;
  rotation?: Rotation;
  label?: string | null;
  /** Hatch kinds besides link hatches. Existing explicit resource interfaces are retained. */
  enabledHatches?: HatchKind[];
  voltageTier?: SiteGroup['voltageTier'] | null;
  hatchTiers?: SiteGroup['hatchTiers'];
  resourceBindings?: SiteGroup['resourceBindings'];
  transformer?: SiteGroup['transformer'];
  crackingFeedSide?: SiteGroup['crackingFeedSide'];
  manualTransformerMode?: SiteGroup['manualTransformerMode'];
  dataBankWireless?: boolean;
  assemblyGrowth?: SiteGroup['assemblyGrowth'];
  steamFrameTier?: SiteGroup['steamFrameTier'];
  structureGlassTier?: SiteGroup['structureGlassTier'] | null;
}

export function withGroupPatched(s: SiteState, id: string, patch: GroupPatch): SiteState {
  let changed = false;
  const groups = s.groups.map((g) => {
    if (g.id !== id) return g;
    const next: SiteGroup = { ...g };
    if (patch.voltageTier === null) delete next.voltageTier;
    else if (isVoltageTier(patch.voltageTier)) next.voltageTier = patch.voltageTier;
    if (patch.hatchTiers) next.hatchTiers = { ...patch.hatchTiers };
    if (patch.resourceBindings) next.resourceBindings = structuredClone(patch.resourceBindings);
    if (patch.transformer) next.transformer = { ...patch.transformer };
    if (patch.crackingFeedSide) next.crackingFeedSide = patch.crackingFeedSide;
    if (patch.manualTransformerMode === 'up' || patch.manualTransformerMode === 'down')
      next.manualTransformerMode = patch.manualTransformerMode;
    if (typeof patch.dataBankWireless === 'boolean') next.dataBankWireless = patch.dataBankWireless;
    if (patch.assemblyGrowth === 'left' || patch.assemblyGrowth === 'right')
      next.assemblyGrowth = patch.assemblyGrowth;
    if (patch.steamFrameTier === 'bronze' || patch.steamFrameTier === 'steel')
      next.steamFrameTier = patch.steamFrameTier;
    if (patch.structureGlassTier === null) delete next.structureGlassTier;
    else if (isVoltageTier(patch.structureGlassTier)) next.structureGlassTier = patch.structureGlassTier;
    if (patch.multiblockId !== undefined && patch.multiblockId !== g.multiblockId) {
      const def = getSiteDef(patch.multiblockId);
      if (def) {
        next.multiblockId = patch.multiblockId;
        next.enabledHatches = defaultGroupHatches(def);
        delete next.size;
        delete next.label;
        delete next.machine;
        delete next.structureGlassTier;
        if (minimumGlassTier(def)) next.structureGlassTier = minimumGlassTier(def);
        delete next.manualTransformerMode;
        delete next.dataBankWireless;
        delete next.assemblyGrowth;
        delete next.steamFrameTier;
      }
    }
    if (patch.count !== undefined) next.count = clampCount(patch.count);
    if (patch.size !== undefined) {
      const def = getSiteDef(next.multiblockId);
      const size = def ? effectiveSize(def, patch.size) : undefined;
      if (size !== undefined) next.size = size;
    }
    if (patch.limits) {
      delete next.arrangeLimits;
      next.limits = { ...patch.limits };
      next.limitsLocked = true;
    }
    if (patch.limitsLocked !== undefined) delete next.arrangeLimits;
    if (patch.limitsLocked === false) delete next.limitsLocked;
    else if (patch.limitsLocked) next.limitsLocked = true;
    if (patch.origin)
      next.origin = [
        clampInt(patch.origin[0], -SITE_MAX_SIZE, 2 * SITE_MAX_SIZE),
        clampInt(patch.origin[1], -SITE_MAX_SIZE, 2 * SITE_MAX_SIZE),
      ];
    if (patch.machine === null) delete next.machine;
    else if (patch.machine !== undefined && getSingleMachine(patch.machine)) {
      const def = getSiteDef(next.multiblockId);
      if (def && isSingleBlock(def)) {
        next.machine = patch.machine;
        const tiers = singleMachineTiers(patch.machine);
        if (tiers.length && (!next.voltageTier || !tiers.includes(next.voltageTier)))
          next.voltageTier = tiers.includes('LV') ? 'LV' : tiers[0];
      }
    }
    if (patch.elevation !== undefined) {
      const e = clampInt(patch.elevation, 0, SITE_MAX_ELEVATION);
      if (e > 0) next.elevation = e;
      else delete next.elevation;
    }
    if (patch.enabledHatches)
      next.enabledHatches = [...new Set(patch.enabledHatches)].filter(
        (k) => !IO_KINDS.includes(k) || next.enabledHatches.includes(k),
      );
    if (patch.rotation !== undefined) next.rotation = (((patch.rotation % 4) + 4) % 4) as Rotation;
    if (patch.label === null || patch.label === '') delete next.label;
    else if (patch.label !== undefined) next.label = patch.label.slice(0, 120);
    changed = JSON.stringify(next) !== JSON.stringify(g);
    return next;
  });
  return changed ? { ...s, groups } : s;
}

export function withGroupMoved(s: SiteState, id: string, dx: number, dz: number): SiteState {
  const g = s.groups.find((x) => x.id === id);
  return g ? withGroupPatched(s, id, { origin: [g.origin[0] + dx, g.origin[1] + dz] }) : s;
}

/** A quarter turn: `dir` 1 clockwise seen from above, -1 counter-clockwise. */
export function withGroupRotated(s: SiteState, id: string, dir: 1 | -1 = 1): SiteState {
  const g = s.groups.find((x) => x.id === id);
  return g ? withGroupPatched(s, id, { rotation: ((g.rotation + dir + 4) % 4) as Rotation }) : s;
}

/** A copy of group `id` (machine, count, size, limits, hatches, turn and label) at `origin`; no links. */
export function withGroupDuplicated(s: SiteState, id: string, origin: [number, number]): SiteState {
  const g = s.groups.find((x) => x.id === id);
  if (!g) return s;
  const added = withGroupAdded(s, g.multiblockId, origin);
  if (added === s) return s;
  const { id: copyId, origin: copyOrigin } = added.groups[added.groups.length - 1];
  const copy: SiteGroup = {
    ...g,
    id: copyId,
    origin: copyOrigin,
    limits: { ...g.limits },
    enabledHatches: [...g.enabledHatches],
    ...(g.hatchTiers ? { hatchTiers: { ...g.hatchTiers } } : {}),
    ...(g.resourceBindings ? { resourceBindings: structuredClone(g.resourceBindings) } : {}),
    ...(g.transformer ? { transformer: { ...g.transformer } } : {}),
  };
  delete copy.source;
  return { ...added, groups: [...added.groups.slice(0, -1), copy] };
}

/** One end of a new link: a group, or a boundary port (created on demand, one per direction and resource). */
export type LinkEnd = { group: string } | { port: true };

export type ResourceChoice = { key: string } | { name: string; kind: ResourceKind };

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'resource'
  );
}

/**
 * Pin port `id` to the cell `to` ([x, z], kept inside the site), or back to automatic placement when `to`
 * is null. Ports stand on the ground, so there is no height to set.
 */
export function withPortPlaced(s: SiteState, id: string, to: [number, number] | null): SiteState {
  const [w, d] = s.size;
  let changed = false;
  const ports = s.ports.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p };
    if (to === null) delete next.pos;
    else next.pos = [clampInt(to[0], 0, w - 1), clampInt(to[1], 0, d - 1)];
    changed = JSON.stringify(next) !== JSON.stringify(p);
    return next;
  });
  return changed ? { ...s, ports } : s;
}

export function withLinkAdded(
  s: SiteState,
  from: LinkEnd,
  to: LinkEnd,
  res: ResourceChoice,
  rate?: number,
): SiteState {
  if (s.links.length >= MAX_LINKS) return s;
  if ('port' in from && 'port' in to) return s;
  let resources = s.resources;
  let key: string;
  if ('key' in res) {
    if (!s.resources[res.key]) return s;
    key = res.key;
  } else {
    const name = res.name.trim().slice(0, 120);
    if (!name) return s;
    const existing = Object.entries(s.resources).find(
      ([, r]) => r.kind === res.kind && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) key = existing[0];
    else {
      const base = res.kind === 'power' ? 'power:eu' : `${res.kind}:${slug(name)}`;
      key = base;
      for (let i = 2; resources[key]; i++) key = `${base}-${i}`;
      resources = {
        ...resources,
        [key]: { kind: res.kind, name, color: res.kind === 'power' ? '#e8c547' : fallbackColor(key) },
      };
    }
  }
  let ports = s.ports;
  const endpoint = (end: LinkEnd, dir: 'in' | 'out'): Endpoint | null => {
    if ('group' in end) return s.groups.some((g) => g.id === end.group) ? { group: end.group } : null;
    const found = ports.find((p) => p.dir === dir && p.resource === key && !p.void);
    if (found) return { port: found.id };
    if (ports.length >= MAX_PORTS) return null;
    const id = nextId(
      dir,
      ports.map((p) => p.id),
    );
    ports = [...ports, { id, dir, resource: key }];
    return { port: id };
  };
  const a = endpoint(from, 'in');
  const b = endpoint(to, 'out');
  if (!a || !b) return s;
  if ('group' in a && 'group' in b && a.group === b.group) return s;
  const dup = s.links.some(
    (l) =>
      JSON.stringify(l.from) === JSON.stringify(a) &&
      JSON.stringify(l.to) === JSON.stringify(b) &&
      l.resource === key,
  );
  if (dup) return s;
  const link = {
    id: nextId(
      'l',
      s.links.map((l) => l.id),
    ),
    from: a,
    to: b,
    resource: key,
    ...(rate !== undefined && rate > 0 ? { rate } : {}),
  };
  return { ...s, resources, ports, links: [...s.links, link] };
}

export function withLinkRemoved(s: SiteState, id: string): SiteState {
  if (!s.links.some((l) => l.id === id)) return s;
  return pruned({ ...s, links: s.links.filter((l) => l.id !== id) });
}

export function withResourceColor(s: SiteState, key: string, color: string): SiteState {
  const r = s.resources[key];
  if (!r || !/^#[0-9a-f]{6}$/i.test(color)) return s;
  return { ...s, resources: { ...s.resources, [key]: { ...r, color: color.toLowerCase() } } };
}

export function withSiteSize(s: SiteState, w: number, d: number): SiteState {
  const size: [number, number] = [
    clampInt(w, SITE_MIN_SIZE, SITE_MAX_SIZE),
    clampInt(d, SITE_MIN_SIZE, SITE_MAX_SIZE),
  ];
  if (size[0] === s.size[0] && size[1] === s.size[1]) return s;
  // Explicit port positions outside the new size fall back to automatic placement.
  const ports = s.ports.map((p) => {
    if (!p.pos || (p.pos[0] < size[0] && p.pos[1] < size[1])) return p;
    const q = { ...p };
    delete q.pos;
    return q;
  });
  return { ...s, size, ports };
}

/**
 * The site grown (never shrunk) so the ground box `min`..`max` (x, z; max exclusive) fits with `margin`
 * free blocks around it, up to SITE_MAX_SIZE. Past the west or north edge the site grows that way: every
 * group moves east / south by the growth, and fixed ports stay on their edge.
 */
export function withGrownToFit(
  s: SiteState,
  min: [number, number],
  max: [number, number],
  margin: number,
): SiteState {
  const [w, d] = s.size;
  // Only a box that actually leaves the site makes it grow.
  if (min[0] >= 0 && min[1] >= 0 && max[0] <= w && max[1] <= d) return s;
  const shift = [0, 1].map((i) => (min[i] < 0 ? Math.min(SITE_MAX_SIZE - s.size[i], margin - min[i]) : 0));
  const size = [0, 1].map((i) =>
    Math.min(
      SITE_MAX_SIZE,
      Math.max(SITE_MIN_SIZE, s.size[i] + shift[i], max[i] > s.size[i] ? max[i] + shift[i] + margin : 0),
    ),
  ) as [number, number];
  if (shift[0] === 0 && shift[1] === 0 && size[0] === w && size[1] === d) return s;
  const groups =
    shift[0] || shift[1]
      ? s.groups.map((g) => ({
          ...g,
          origin: [g.origin[0] + shift[0], g.origin[1] + shift[1]] as [number, number],
        }))
      : s.groups;
  const ports = s.ports.map((p) => {
    if (!p.pos) return p;
    // Keep a fixed port on its edge: west / north stay at 0, east / south follow the new edge.
    const along = (i: 0 | 1, v: number) =>
      v === 0 ? 0 : v === s.size[i] - 1 ? size[i] - 1 : Math.min(size[i] - 1, v + shift[i]);
    return { ...p, pos: [along(0, p.pos[0]), along(1, p.pos[1])] as [number, number] };
  });
  return { ...s, size, groups, ports };
}

export function withCorridor(s: SiteState, n: number): SiteState {
  const corridor = clampInt(n, 0, MAX_CORRIDOR);
  return corridor === s.corridor ? s : { ...s, corridor };
}

export function withName(s: SiteState, name: string): SiteState {
  const n = name.trim().slice(0, 120);
  const next = { ...s };
  if (n) next.name = n;
  else delete next.name;
  return next;
}

// Store wrappers

const clearSelection = () => {
  siteGroup.set(null);
  siteNet.set(null);
  isolate.set(null);
};

export function replaceSite(next: SiteState): void {
  clearSelection();
  site.set(next);
}

export function resetSite(): void {
  const s = emptySite();
  replaceSite(s);
}

export const updateSite = (fn: (s: SiteState) => SiteState) => site.update(fn);
