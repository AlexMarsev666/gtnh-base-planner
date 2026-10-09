import type { Rotation } from '../core/types';
import type { HatchKind, PlanLimits } from '../multiblock/types';
import type { Dir } from '../core/types';
import type { VoltageTier } from '../tiers';

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
  /** Original game stack id; display names never determine structural roles. */
  gameId?: string;
}

/** Where resource icons are loaded from. */
export const ICON_HOST = 'https://gtnhplanner.com';

/** Accepted icon paths: `/datasets/` followed by plain path segments, ending in `.png`. */
export const ICON_RE = /^\/datasets(\/[A-Za-z0-9_\-][A-Za-z0-9._\-]*)+\.png$/;

export function iconUrl(path: string): string | null {
  return ICON_RE.test(path) && path.length <= 300 && !path.includes('..') ? ICON_HOST + path : null;
}

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
   * Explicit hatch kinds, including required resource interfaces in new groups or those retained from
   * a machine plan. Links additionally require one resource hatch per resource and output slot.
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
  /** Absent in legacy documents: unspecified, rather than silently assigning LV. */
  voltageTier?: VoltageTier;
  /** Logical unit/kind/resource assignments, independent of world coordinates. */
  hatchTiers?: Record<string, VoltageTier>;
  resourceBindings?: ResourceBinding[];
  crackingFeedSide?: 'left' | 'right';
  /** Manual multiblock transformer: controller circuit 0 (up) or 1 (down). RC2 disables tapped modes. */
  manualTransformerMode?: 'up' | 'down';
  dataBankWireless?: boolean;
  assemblyGrowth?: 'left' | 'right';
  /** Uniform Water Pump frame material, independent of hatch voltage. */
  steamFrameTier?: 'bronze' | 'steel';
  structureGlassTier?: VoltageTier;
  /** Local high-voltage face and operating direction of a single transformer. */
  transformer?: { lowTier: VoltageTier; mode: 'down' | 'up'; facing: Dir };
  /**
   * Blocks between the ground and the group's lowest layer; absent = on the ground. A template that does
   * not fit its ground area is built on several floors, each one a level of groups raised this much.
   */
  elevation?: number;
  /** Where an imported group came from (shown in labels and the group list). */
  source?: { name: string; machineCount?: number; tier?: string };
}

export const RESOURCE_ROLES = [
  'helium',
  'mask',
  'feed',
  'catalyst',
  'product',
  'hotFluid',
  'coldFluid',
  'water',
  'steam',
  'acid',
  'alkaline',
  'coolant',
  'plasma',
] as const;
export type ResourceRole = (typeof RESOURCE_ROLES)[number];

export interface ResourceBinding {
  kind: HatchKind;
  resource: string;
  role?: ResourceRole;
  /** Zero-based recipe fluid output index. */
  outputSlot?: number;
}

export interface RoutingSettings {
  mode: 'compact' | 'neat';
  depth: number;
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

export interface SiteState {
  v: 1 | 2;
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
  /** Absent in old files means the former compact routing. */
  routing?: RoutingSettings;
  /** Document version and game rules version are deliberately independent. */
  rulesVersion?: string;
}

export function isGroupEnd(e: Endpoint): e is { group: string } {
  return 'group' in e;
}

export function endpointKey(e: Endpoint): string {
  return isGroupEnd(e) ? `g:${e.group}` : `p:${e.port}`;
}
