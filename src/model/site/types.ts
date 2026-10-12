import type { Rotation, Tier } from '../core/types';
import type { HatchKind, PlanLimits } from '../multiblock/types';
import type { HatchTiers, WallshareMode } from '../plan/types';

/**
 * A site: several groups of multiblocks placed on a bounded ground area, with links that carry one
 * resource from one group (or boundary port) to another. Each group is what a single-machine plan is
 * today: `count` units of one multiblock, packed with the same packer.
 *
 * Coordinates: X = east, Z = south, like the rest of the app. The site covers cells `0 <= x < size[0]`,
 * `0 <= z < size[1]`; groups stand on y = 0, or higher on a floor (see `SiteGroup.elevation`).
 */

export type ResourceKind = 'item' | 'fluid' | 'power';

export interface ResourceDef {
  kind: ResourceKind;
  /** Display name, e.g. "Nitrogen Gas". */
  name: string;
  /** `#rrggbb`, used for pipes, hatch markers and the legend. */
  color: string;
  /**
   * Icon path on gtnhplanner.com (`/datasets/.../name.png`), from a GTNH Planner import. Only paths of that
   * shape are accepted (see `ICON_RE`), so a shared site can never make the page load another address.
   */
  icon?: string;
}

/** Where resource icons are loaded from. */
export const ICON_HOST = 'https://gtnhplanner.com';

/** Accepted icon paths: `/datasets/` followed by plain path segments, ending in `.png`. */
export const ICON_RE = /^\/datasets(\/[A-Za-z0-9_\-][A-Za-z0-9._\-]*)+\.png$/;

export function iconUrl(path: string): string | null {
  return ICON_RE.test(path) && path.length <= 300 && !path.includes('..') ? ICON_HOST + path : null;
}

/** Where one resource's hatch of a group goes. Both parts are optional. */
export interface HatchAssign {
  unit?: number | 'all';
  zone?: string;
}

export type TransformerStep = 'up' | 'down';
/**
 * Transformer families by the amperage of the low side: 4 (plain, 1A in), 16 (Hi-Amp, 4A in) and 64 (Power, 16A
 * in); each from an LV high side up.
 */
export const TRANSFORMER_AMPS = [4, 16, 64] as const;
export type TransformerAmps = (typeof TRANSFORMER_AMPS)[number];

export interface SiteGroup {
  /** Stable id within the site (`[a-z0-9_-]`), used by links. */
  id: string;
  /** Display name override; defaults to the multiblock name. */
  label?: string;
  /** Catalog id, or a generic id from `src/data/generic.ts` (single-block machine, placeholder). */
  multiblockId: string;
  count: number;
  limits: PlanLimits;
  /** Height / length of a resizable multiblock (see `PlanState.size`). */
  size?: number;
  /**
   * The group's `limits` are the user's own: Arrange and Optimize never change them (they still move and turn
   * the group). Set by editing the limits, and switchable in the group's settings.
   */
  limitsLocked?: boolean;
  /**
   * Non-IO hatch kinds to place (energy, maintenance, muffler, dynamo). Item, fluid and steam hatches come
   * from the links that touch the group: one hatch per resource.
   */
  enabledHatches: HatchKind[];
  /** Min corner of the group's (rotated) bounding box on the site: [x, z]. */
  origin: [number, number];
  /** Quarter turns clockwise of the whole group, around its bounding box. */
  rotation: Rotation;
  /**
   * Single-block machines only: which GT machine they are (an id of `src/data/single-machines.json`), so the
   * template draws each with its own look. Absent = a plain machine hull.
   */
  machine?: string;
  /**
   * Blocks between the ground and the group's lowest layer; absent = on the ground. A template that does
   * not fit its ground area is built on several floors, each one a level of groups raised this much.
   */
  elevation?: number;
  /** Machine tier = tier of the group's energy hatches (a transformer: its high side); absent = default. */
  tier?: Tier;
  /** Tier of single hatches that differ from `tier` (see `HatchTiers`). */
  hatchTiers?: HatchTiers;
  /** Tier of the glass that limits the hatches (see `PlanState.glassTier`); absent = the def's glass. */
  glassTier?: Tier;
  /** Units are built mirrored in X. Absent = not mirrored. */
  mirror?: boolean;
  /** Wall sharing mode inside the group; absent = `auto`. */
  wallshare?: WallshareMode;
  /** One maintenance hatch in a shared wall may serve several units (see `PlanState.shareMaintenance`). */
  shareMaintenance?: boolean;
  /** One energy hatch in a shared wall may serve two units (see `PlanState.shareEnergy`). */
  shareEnergy?: boolean;
  /**
   * Where each resource's hatch goes, by resource key: onto one unit (its index in the group, or `all`) and/or
   * into a hatch zone of the multiblock (a region name such as `dot2`). Absent = automatic.
   */
  assign?: Record<string, HatchAssign>;
  /** Transformers only (single block, `machine` = `transformer`; `tier` is the high side): direction. */
  step?: TransformerStep;
  /** Transformers only: amperage of the low side (see `TRANSFORMER_AMPS`); absent = 4. */
  amps?: TransformerAmps;
  /** Where an imported group came from (shown in labels and the group list). */
  source?: { name: string; machineCount?: number; tier?: string };
}

/** One end of a link: a group, or a port on the site boundary. */
export type Endpoint = { group: string } | { port: string };

export interface SiteLink {
  id: string;
  from: Endpoint;
  to: Endpoint;
  /** Key into `SiteState.resources`. */
  resource: string;
  /** Per second (items/s, L/s or EU/t), when known. */
  rate?: number;
}

/**
 * A boundary port: where a resource enters the site (`in`, e.g. an ME interface or a tank) or leaves it
 * (`out`). Without `pos` the port is placed automatically on the west (`in`) or east (`out`) edge.
 */
export interface SitePort {
  id: string;
  dir: 'in' | 'out';
  resource: string;
  /** Explicit [x, z] cell inside the site. */
  pos?: [number, number];
  /** An `out` port that destroys what it gets (trash can, void). */
  void?: boolean;
}

/** `classic` is the plain router, `neat` aligns and bundles runs; `depth` is how many layers below a build pipes may run. */
export const ROUTING_STYLES = ['classic', 'neat'] as const;
export type RoutingStyle = (typeof ROUTING_STYLES)[number];
export type RoutingDepth = 0 | 1 | 2 | 3;
export interface SiteRouting {
  style: RoutingStyle;
  depth: RoutingDepth;
}

export interface SiteState {
  v: 1;
  kind: 'site';
  name?: string;
  /** [width along X, depth along Z] in blocks. */
  size: [number, number];
  /** Free blocks the arranger keeps between groups for pipes. */
  corridor: number;
  groups: SiteGroup[];
  links: SiteLink[];
  ports: SitePort[];
  resources: Record<string, ResourceDef>;
  /** Hatch colour overrides, as in `PlanState.colors`. */
  colors: Partial<Record<HatchKind, string>>;
  /** Routing style and depth; absent = classic, depth from the old "connect below" switch. */
  routing?: SiteRouting;
  /** Seed for the randomised steps (Optimize), a non-negative integer; absent = the built-in one. */
  seed?: number;
}

export function isGroupEnd(e: Endpoint): e is { group: string } {
  return 'group' in e;
}

export function endpointKey(e: Endpoint): string {
  return isGroupEnd(e) ? `g:${e.group}` : `p:${e.port}`;
}
