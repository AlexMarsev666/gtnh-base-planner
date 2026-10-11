import type { Dir, Vec3 } from '../core/types';
import type { MultiblockDef, Unit } from '../multiblock/types';
import type { SceneModel } from '../render/types';
import type { Demand, GroupBuild, SiteHatch } from './group';
import type { RouteResult, RouteStats } from './router';
import type { ResourceKind, SiteGroup, SitePort, SiteRouting, SiteState } from './types';

/** What building a site produces: placed groups and ports, nets, warnings, the scene and totals. */

export interface SiteBuildOptions {
  /** Route item and fluid nets. */
  pipes: boolean;
  /** Route power nets (energy / dynamo cables). */
  cables: boolean;
  /** Resource key to highlight: every other net is drawn faded. */
  isolate?: string | null;
  turnCost?: number;
  /**
   * Hatches (and single-block machines) may be reached from below, and pipes may run in the layer under the
   * ground (a trench). Default false.
   */
  below?: boolean;
  /**
   * Routing style and underground depth (up to `depth` layers under the ground, -1 preferred). Overrides
   * `below` when given; absent, `below` means classic with depth 1 (or 0).
   */
  routing?: SiteRouting;
  /**
   * Keep the packs of groups this site does not use (the builder otherwise drops them, so memory stays bounded
   * while editing). For searches that build many layouts of one site and come back to the same packs.
   */
  keepCache?: boolean;
}

export interface PlacedGroup {
  group: SiteGroup;
  index: number;
  def?: MultiblockDef;
  build?: GroupBuild;
  error?: string;
  /** World units (global ids) and hatches. */
  units: Unit[];
  hatches: SiteHatch[];
  /** World bounding box: inclusive min, exclusive max. */
  min: Vec3;
  max: Vec3;
  demand: Demand;
}

export interface PlacedPort {
  port: SitePort;
  cell: Vec3;
  faces: Dir[];
}

export interface NetTerminalInfo {
  role: 'source' | 'sink';
  group?: string;
  port?: string;
  hatch?: SiteHatch;
  cell: Vec3;
}

export interface SiteNet {
  id: number;
  resource: string;
  kind: ResourceKind;
  links: string[];
  terminals: NetTerminalInfo[];
  /** Null when this kind of net is switched off. */
  route: RouteResult | null;
  /** Sum of the known link rates. */
  rate?: number;
}

export type SiteWarning =
  | { type: 'error'; group: string; message: string }
  | { type: 'overlap'; groups: [string, string] }
  | { type: 'outside'; group: string }
  | { type: 'fewer'; group: string; placed: number; requested: number }
  | { type: 'unplaced'; group: string; count: number }
  | { type: 'unsupported'; group: string; resource: string }
  | { type: 'missing'; group: string; resource: string; units: number }
  | { type: 'unrouted'; resource: string; connected: number; total: number }
  | { type: 'noport'; port: string };

export interface SiteBuild {
  groups: PlacedGroup[];
  ports: PlacedPort[];
  nets: SiteNet[];
  scene: SceneModel;
  warnings: SiteWarning[];
  /** The routing asked for, and the underground depth used (less than asked when the grid would be too big). */
  routing: SiteRouting & { depthUsed: number };
  stats: {
    groups: number;
    units: number;
    blocks: number;
    hatches: number;
    pipeBlocks: number;
    cableBlocks: number;
    connected: number;
    terminals: number;
    /** Where the routed blocks of all nets are, and how often they turn. */
    routeStats: RouteStats;
  };
}

/** Side of the group a link end sits on. */
export type Side = 'in' | 'out';

export type SiteBuilder = (site: SiteState, opts: SiteBuildOptions) => SiteBuild;
