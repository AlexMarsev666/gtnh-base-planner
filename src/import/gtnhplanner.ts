import { PLACEHOLDER_ID, SINGLE_BLOCK_ID, getSiteDef, isSingleBlock } from '../data/generic';
import { singleMachineForName } from '../data/single-machines';
import {
  SINGLE_BLOCK_NAMES,
  SKIP_NAMES,
  SOURCE_KINDS,
  SOURCE_NAMES,
  VOID_NAMES,
  multiblockForMachineType,
  multiblockForName,
} from '../data/gtnhplanner-machines';
import { arrangeSite, grownSize, type ArrangeOptions, type ArrangeResult } from '../model/site/arrange';
import { createSiteBuilder, localFootprints, localHeights } from '../model/site/build';
import type { SiteBuilder } from '../model/site/buildTypes';
import { IO_KINDS, singleBlockLimits } from '../model/site/group';
import {
  iconUrl,
  type Endpoint,
  type ResourceDef,
  type SiteGroup,
  type SiteLink,
  type SitePort,
  type SiteState,
} from '../model/site/types';
import {
  DEFAULT_CORRIDOR,
  DEFAULT_SITE_SIZE,
  MAX_GROUPS,
  MAX_LINKS,
  MAX_MACHINE_COUNT,
  MAX_PORTS,
  MAX_RATE,
  MAX_RESOURCES,
  SITE_MAX_SIZE,
  SITE_MIN_SIZE,
  validateSiteState,
} from '../share/siteCodec';
import { PlanFormatError } from '../share/binary';
import { clampCount } from '../ui/fields';
import { rotatedSize } from '../model/geometry';
import { packUnits } from '../model/layout/packer';
import { effectiveSize, sizedDef } from '../model/resize';
import type { MultiblockDef, PlanLimits } from '../model/multiblock/types';

/**
 * Import of a GTNH Planner (gtnhplanner.com) project: the JSON their board's "Export JSON" writes
 * (`factoryProjectSchema`, schemaVersion 1), or a copied board selection with the same arrays.
 *
 * Only what a layout needs is read: recipes (machine, inputs, outputs), nodes (recipe, machine count),
 * storages and edges. Everything else is ignored, and malformed entries are skipped rather than failing
 * the whole file, and out-of-range numbers are clamped (machine counts) or dropped (rates) and counted in
 * `adjusted`. Control characters in ids and names are replaced by spaces without being counted. Nothing here
 * touches the network.
 */

export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/**
 * Most entries per section of an imported project, and per recipe side. Far above real projects (a large
 * GTNH base plan has a few hundred of each), low enough that a crafted file is refused before the page
 * spends seconds and memory on it.
 */
export const IMPORT_LIMITS = { recipes: 20_000, nodes: 5_000, storages: 5_000, edges: 20_000, stacks: 256 };

/** Newest `schemaVersion` of GTNH Planner's export this importer was written for. */
export const KNOWN_SCHEMA_VERSION = 1;

export type GtnhKind = 'item' | 'fluid' | 'aspect' | 'power';

export interface GtnhStack {
  kind: GtnhKind;
  id: string;
  displayName?: string;
  dominantColor?: string;
  /** Icon path on gtnhplanner.com, kept only when it is a `/datasets/...png` path. */
  iconPath?: string;
  /** False for catalysts, molds and other inputs that are not used up. */
  consumed?: boolean;
}

export interface GtnhRecipe {
  id: string;
  name: string;
  kind?: string;
  machineType: string;
  minimumTier?: string;
  inputs: GtnhStack[];
  outputs: GtnhStack[];
  handlers: { id: string; label: string; kind?: string }[];
  generator: boolean;
}

export interface GtnhNode {
  id: string;
  recipeId: string;
  machineCount: number;
  overclockTier?: string;
  machineHandlerId?: string;
  enabled: boolean;
}

export interface GtnhStorage {
  id: string;
  kind: GtnhKind;
  resourceId: string;
  displayName?: string;
  dominantColor?: string;
  iconPath?: string;
  drainMode?: string;
}

export interface GtnhEdge {
  id: string;
  source: string;
  target: string;
  resourceKind: GtnhKind;
  resourceId: string;
  ratePerSecond?: number;
}

export interface GtnhProject {
  name: string;
  schemaVersion?: number;
  /** The file comes from a newer export format than `KNOWN_SCHEMA_VERSION`: fields may have been missed. */
  newerSchema?: boolean;
  recipes: Map<string, GtnhRecipe>;
  nodes: GtnhNode[];
  storages: GtnhStorage[];
  edges: GtnhEdge[];
  /** Entries that were malformed and skipped. */
  skipped: number;
  /** Numbers that were out of range and were clamped (machine counts) or dropped (rates). */
  adjusted: number;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * A non-empty string with control characters (the site codec refuses them in names) replaced by spaces,
 * trimmed; empty after that counts as missing.
 * Applied wherever an id or name is read, so ids still match between recipes, nodes and edges. Silent: not
 * counted in `adjusted`.
 */
const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s.length > 0 ? s : undefined;
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const KINDS: readonly GtnhKind[] = ['item', 'fluid', 'aspect', 'power'];
const kindOf = (v: unknown): GtnhKind | undefined =>
  KINDS.includes(v as GtnhKind) ? (v as GtnhKind) : undefined;
const COLOR = /^#[0-9a-f]{6}$/i;

function stack(v: unknown): GtnhStack | null {
  if (!isObj(v)) return null;
  const kind = kindOf(v.kind);
  const id = str(v.id);
  if (!kind || !id) return null;
  const s: GtnhStack = { kind, id };
  const name = str(v.displayName);
  if (name) s.displayName = name;
  const color = str(v.dominantColor);
  if (color && COLOR.test(color)) s.dominantColor = color.toLowerCase();
  const icon = str(v.iconPath);
  if (icon && iconUrl(icon)) s.iconPath = icon;
  if (v.consumed === false) s.consumed = false;
  return s;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Parses exported JSON text. Throws `ImportError` with a readable message when it is not a project. */
export function parseGtnhProject(text: string): GtnhProject {
  if (typeof text !== 'string' || text.trim() === '') throw new ImportError('Nothing to import.');
  if (text.length > MAX_IMPORT_BYTES) throw new ImportError('The file is too large.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('This is not JSON. Use Export JSON on the GTNH Planner board.');
  }
  // A community download may wrap the project.
  if (isObj(data) && isObj(data.plan) && !Array.isArray(data.nodes)) data = data.plan;
  if (!isObj(data) || !Array.isArray(data.nodes) || !Array.isArray(data.recipes)) {
    throw new ImportError('This does not look like a GTNH Planner project (no nodes or recipes).');
  }
  for (const section of ['recipes', 'nodes', 'storages', 'edges'] as const) {
    const n = list(data[section]).length;
    if (n > IMPORT_LIMITS[section])
      throw new ImportError(`Too many ${section} (${n}); at most ${IMPORT_LIMITS[section]} can be imported.`);
  }
  let skipped = 0;
  let adjusted = 0;
  /** A machine count: finite and within the site codec's limit; anything else is clamped (default 1). */
  const count = (v: unknown): number => {
    if (v === undefined) return 1;
    const c = Math.min(MAX_MACHINE_COUNT, Math.max(0, num(v) ?? 1));
    if (c !== v) adjusted++;
    return c;
  };
  /** A rate per second: finite, 0 to `MAX_RATE`; otherwise dropped (a clamped nonsense rate would mislead). */
  const rate = (v: unknown): number | undefined => {
    if (v === undefined || v === null) return undefined;
    const n = num(v);
    if (n !== undefined && n >= 0 && n <= MAX_RATE) return n;
    adjusted++;
    return undefined;
  };
  const recipes = new Map<string, GtnhRecipe>();
  for (const r of list(data.recipes)) {
    const rid = isObj(r) ? str(r.id) : undefined;
    const machineType = isObj(r) ? str(r.machineType) : undefined;
    if (
      !isObj(r) ||
      !rid ||
      !machineType ||
      list(r.inputs).length > IMPORT_LIMITS.stacks ||
      list(r.outputs).length > IMPORT_LIMITS.stacks
    ) {
      skipped++;
      continue;
    }
    const stacks = (v: unknown) =>
      list(v)
        .map(stack)
        .filter((s): s is GtnhStack => s !== null);
    recipes.set(rid, {
      id: rid,
      name: str(r.name) ?? rid,
      kind: str(r.kind),
      machineType,
      minimumTier: str(r.minimumTier),
      inputs: stacks(r.inputs),
      outputs: stacks(r.outputs),
      handlers: list(r.machineHandlers)
        .filter(isObj)
        .flatMap((h) => {
          const id = str(h.id);
          const label = str(h.label);
          return id && label ? [{ id, label, kind: str(h.kind) }] : [];
        }),
      generator: isObj(r.power),
    });
  }
  const nodes: GtnhNode[] = [];
  const nodeIds = new Set<string>();
  for (const n of list(data.nodes)) {
    const id = isObj(n) ? str(n.id) : undefined;
    const recipeId = isObj(n) ? str(n.recipeId) : undefined;
    // A repeated node id would make every link to it ambiguous.
    if (!isObj(n) || !id || !recipeId || nodeIds.has(id)) {
      skipped++;
      continue;
    }
    nodeIds.add(id);
    nodes.push({
      id,
      recipeId,
      machineCount: count(n.machineCount),
      overclockTier: str(n.overclockTier),
      machineHandlerId: str(n.machineHandlerId),
      enabled: n.enabled !== false,
    });
  }
  const storages: GtnhStorage[] = [];
  for (const s of list(data.storages)) {
    const kind = isObj(s) ? kindOf(s.kind) : undefined;
    const id = isObj(s) ? str(s.id) : undefined;
    const resourceId = isObj(s) ? str(s.resourceId) : undefined;
    if (!isObj(s) || !id || !kind || !resourceId) {
      skipped++;
      continue;
    }
    const color = str(s.dominantColor);
    const icon = str(s.iconPath);
    storages.push({
      id,
      kind,
      resourceId,
      displayName: str(s.displayName),
      dominantColor: color && COLOR.test(color) ? color.toLowerCase() : undefined,
      iconPath: icon && iconUrl(icon) ? icon : undefined,
      drainMode: str(s.drainMode),
    });
  }
  const edges: GtnhEdge[] = [];
  for (const e of list(data.edges)) {
    const kind = isObj(e) ? kindOf(e.resourceKind) : undefined;
    const id = isObj(e) ? str(e.id) : undefined;
    const source = isObj(e) ? str(e.source) : undefined;
    const target = isObj(e) ? str(e.target) : undefined;
    const resourceId = isObj(e) ? str(e.resourceId) : undefined;
    if (!isObj(e) || !id || !source || !target || !kind || !resourceId) {
      skipped++;
      continue;
    }
    edges.push({
      id,
      source,
      target,
      resourceKind: kind,
      resourceId,
      ratePerSecond: rate(e.ratePerSecond),
    });
  }
  const schemaVersion = num(data.schemaVersion);
  return {
    name: str(data.name) ?? 'GTNH Planner import',
    schemaVersion,
    newerSchema: schemaVersion !== undefined && schemaVersion > KNOWN_SCHEMA_VERSION,
    recipes,
    nodes,
    storages,
    edges,
    skipped,
    adjusted,
  };
}

// -------------------------------------------------------------------------------------------------
// Mapping
// -------------------------------------------------------------------------------------------------

/** What to build for a node. */
export type MachineChoice =
  | { type: 'multiblock'; id: string }
  | { type: 'single' }
  | { type: 'placeholder' }
  /** Not placed: its outputs enter the site through boundary ports (passive sources, sinks). */
  | { type: 'port' }
  | { type: 'skip' };

export interface ImportRow {
  node: GtnhNode;
  recipe: GtnhRecipe | undefined;
  /** The machine name the plan shows (handler label or recipe map name). */
  machine: string;
  count: number;
  proposed: MachineChoice;
}

export function machineName(node: GtnhNode, recipe: GtnhRecipe | undefined): string {
  if (!recipe) return 'Unknown recipe';
  const handler = recipe.handlers.find((h) => h.id === node.machineHandlerId);
  return handler?.label ?? recipe.machineType;
}

/** The best guess for a node: a catalog multiblock, a single-block machine, a placeholder, or a port. */
export function proposeChoice(node: GtnhNode, recipe: GtnhRecipe | undefined): MachineChoice {
  if (!recipe) return { type: 'skip' };
  const handler = recipe.handlers.find((h) => h.id === node.machineHandlerId);
  const names = [handler?.label, recipe.machineType]
    .filter((n): n is string => !!n)
    .map((n) => n.trim().toLowerCase());
  for (const n of names) {
    const id = multiblockForName(n);
    if (id) return { type: 'multiblock', id };
  }
  if (
    (recipe.kind && SOURCE_KINDS.has(recipe.kind)) ||
    names.some((n) => SOURCE_NAMES.has(n) || VOID_NAMES.has(n))
  )
    return { type: 'port' };
  if (names.some((n) => SKIP_NAMES.has(n)) || handler?.kind === 'crafting') return { type: 'skip' };
  if (handler?.kind === 'single' || names.some((n) => SINGLE_BLOCK_NAMES.has(n))) return { type: 'single' };
  // GT's own name for the machine type ("Vacuum Furnace" is the Utupu-Tanuri).
  for (const n of names) {
    const id = multiblockForMachineType(n);
    if (id) return { type: 'multiblock', id };
  }
  return { type: 'placeholder' };
}

export function importRows(project: GtnhProject): ImportRow[] {
  return project.nodes
    .filter((n) => n.enabled)
    .map((node) => {
      const recipe = project.recipes.get(node.recipeId);
      return {
        node,
        recipe,
        machine: machineName(node, recipe),
        count: clampCount(Math.ceil(node.machineCount - 1e-6)),
        proposed: proposeChoice(node, recipe),
      };
    });
}

// -------------------------------------------------------------------------------------------------
// Building the site
// -------------------------------------------------------------------------------------------------

/** Most layers an imported group is stacked to, and the tallest stack allowed (blocks). */
const MAX_LAYERS = 4;
const MAX_STACK_HEIGHT = 24;
/** Most layers a group may be stacked to when it must fit a site of a size the user set. */
const MAX_BOUND_LAYERS = 12;
const MAX_BOUND_HEIGHT = 48;
/** A stack is kept only when it shrinks the footprint to at most this share of the flat one. */
const STACK_GAIN = 0.75;

/**
 * Limits per group: every group starts on one layer; a group of several machines of one kind goes up
 * (2, 3 or 4 layers) when that shrinks its footprint enough, every unit still fits and the stack stays
 * low. The packer never stacks while a flat layout fits, so a stack is forced by capping the units per
 * layer along X and Z. All variants are built in one trial site (pipes off) under ids of their own;
 * `builder` keeps the packs of the chosen ones for the build that follows.
 */
function stackGroups(
  site: SiteState,
  builder: SiteBuilder,
  below?: boolean,
  bound?: { only: ReadonlySet<string>; room: [number, number] },
): SiteGroup[] {
  const variants: { of: string; limits: PlanLimits }[] = [];
  const singles = new Map<string, PlanLimits>();
  for (const g of site.groups) {
    const def = getSiteDef(g.multiblockId);
    if (g.limitsLocked) continue;
    if (bound && !bound.only.has(g.id)) continue;
    if (def && bound && isSingleBlock(def)) {
      // Single-block machines stack by rule, not by trial: no build is needed to know their footprint.
      singles.set(g.id, singleBlockLimits(g.count, bound.room, MAX_BOUND_LAYERS));
      continue;
    }
    if (!def || isSingleBlock(def)) continue;
    const ratio = def.size[2] / Math.max(1, def.size[0]);
    for (let y = 2; y <= (bound ? MAX_BOUND_LAYERS : MAX_LAYERS) && g.count > y - 1; y++) {
      const perLayer = Math.ceil(g.count / y);
      const rows = new Set<number>();
      // A group that must fit tries the squarest grid only: every variant is a full build.
      const shapes = bound
        ? [Math.sqrt(perLayer * ratio)]
        : [Math.sqrt(perLayer), Math.sqrt(perLayer * ratio), Math.sqrt(perLayer / ratio)];
      for (const r of shapes)
        for (const x of [Math.floor(r), Math.ceil(r)]) rows.add(Math.min(perLayer, Math.max(1, x)));
      for (const x of rows) {
        const z = Math.ceil(perLayer / x);
        // Fewer layers than `y` must not hold every unit, or the packer would stay lower.
        if (x * z * (y - 1) >= g.count) continue;
        variants.push({ of: g.id, limits: { x, y, z } });
      }
    }
  }
  const withSingles = (groups: SiteGroup[]) =>
    singles.size ? groups.map((g) => (singles.has(g.id) ? { ...g, limits: singles.get(g.id)! } : g)) : groups;
  if (variants.length === 0) return withSingles(site.groups);

  // Variants get ids of their own and a copy of every link end of their group, so the same hatches.
  const vid = (i: number) => `~v${i}`;
  const byId = new Map(site.groups.map((g) => [g.id, g]));
  const extra: SiteLink[] = [];
  site.links.forEach((l) =>
    variants.forEach((v, i) => {
      for (const side of ['from', 'to'] as const) {
        const e = l[side];
        if ('group' in e && e.group === v.of)
          extra.push({ ...l, id: `${l.id}~${side}${i}`, [side]: { group: vid(i) } });
      }
    }),
  );
  const trial: SiteState = {
    ...site,
    groups: [
      ...site.groups,
      ...variants.map((v, i) => ({ ...byId.get(v.of)!, id: vid(i), limits: v.limits })),
    ],
    links: [...site.links, ...extra],
  };
  const built = new Map(
    builder(trial, { pipes: false, cables: false, below }).groups.map((pg) => [pg.group.id, pg]),
  );
  const maxHeight = bound ? MAX_BOUND_HEIGHT : MAX_STACK_HEIGHT;
  const area = (id: string): number | null => {
    const b = built.get(id)?.build;
    if (!b || b.pack.placed < b.pack.requested || b.unplaced.length || b.size[1] > maxHeight) return null;
    return b.size[0] * b.size[2];
  };
  if (bound) {
    // A group that must fit: the fewest layers whose footprint fits the room (either way round), else the
    // smallest footprint there is.
    const [rx, rz] = bound.room;
    const fits = (id: string) => {
      const b = built.get(id)?.build;
      return !!b && ((b.size[0] <= rx && b.size[2] <= rz) || (b.size[2] <= rx && b.size[0] <= rz));
    };
    type Pick = { limits: PlanLimits; fit: boolean; unplaced: number; layers: number; area: number };
    const chosen = new Map<string, Pick>();
    // Rooms first, then the fewest hatches left without a place (a tight stack has little wall to put them
    // on, but a group inside the plot beats one hanging out of it), then the fewest layers, then the smallest.
    const beats = (x: Pick, y: Pick) =>
      x.fit !== y.fit
        ? x.fit
        : x.fit
          ? x.unplaced !== y.unplaced
            ? x.unplaced < y.unplaced
            : x.layers !== y.layers
              ? x.layers < y.layers
              : x.area < y.area
          : x.area < y.area;
    const consider = (of: string, limits: PlanLimits, id: string) => {
      const b = built.get(id)?.build;
      if (!b || b.pack.placed < b.pack.requested || b.size[1] > maxHeight) return;
      const next: Pick = {
        limits,
        fit: fits(id),
        unplaced: b.unplaced.length,
        layers: limits.y ?? 1,
        area: b.size[0] * b.size[2],
      };
      const cur = chosen.get(of);
      if (!cur || beats(next, cur)) chosen.set(of, next);
    };
    for (const g of site.groups) if (bound.only.has(g.id)) consider(g.id, g.limits, g.id);
    variants.forEach((v, i) => consider(v.of, v.limits, vid(i)));
    return withSingles(
      site.groups.map((g) => ({ ...g, limits: { ...(chosen.get(g.id)?.limits ?? g.limits) } })),
    );
  }
  const best = new Map<string, { limits: PlanLimits; area: number }>();
  for (const g of site.groups) {
    const b = built.get(g.id)?.build;
    if (b) best.set(g.id, { limits: g.limits, area: b.size[0] * b.size[2] * STACK_GAIN });
  }
  variants.forEach((v, i) => {
    const a = area(vid(i));
    const cur = best.get(v.of);
    if (a !== null && cur && a <= cur.area) best.set(v.of, { limits: v.limits, area: a });
  });
  return site.groups.map((g) => ({ ...g, limits: { ...(best.get(g.id)?.limits ?? g.limits) } }));
}

/**
 * Arranges `site` inside its own size: the chain runs west to east, what is too wide for one floor goes on the
 * next one above, and a group bigger than the ground itself stacks its machines up until it fits. Never grows
 * the site. `builder` packs the groups to measure them (and keeps the packs for the build that follows).
 */
export function arrangeOnFloors(
  site: SiteState,
  builder: SiteBuilder,
  below?: boolean,
  progress: Pick<ArrangeOptions, 'onProgress' | 'signal'> = {},
): { site: SiteState; arranged: ArrangeResult } {
  const onFloors = (s: SiteState) => {
    const built = builder(s, { pipes: false, cables: false, below });
    const footprints = localFootprints(built);
    const heights = localHeights(built);
    return {
      footprints,
      arranged: arrangeSite(s, (id) => footprints.get(id), {
        floors: { heightOf: (id) => heights.get(id) ?? 1 },
        ...progress,
      }),
    };
  };
  let laid = onFloors(site);
  let out = site;
  if (!laid.arranged.fits) {
    const gap = Math.max(1, site.corridor);
    const room: [number, number] = [
      Math.max(1, site.size[0] - 2 * (1 + gap)),
      Math.max(1, site.size[1] - 2 * gap),
    ];
    const tooBig = new Set(
      site.groups
        .filter((g) => {
          const f = laid.footprints.get(g.id);
          return f && !((f[0] <= room[0] && f[1] <= room[1]) || (f[1] <= room[0] && f[0] <= room[1]));
        })
        .map((g) => g.id),
    );
    if (tooBig.size > 0) {
      out = { ...site, groups: stackGroups(site, builder, below, { only: tooBig, room }) };
      laid = onFloors(out);
    }
  }
  return { site: { ...out, groups: laid.arranged.groups }, arranged: laid.arranged };
}

export interface ImportOptions {
  size?: [number, number];
  /**
   * Size the site to the chain: the smallest, squarest size it fits (up to the maximum), whatever `size`
   * says. Default true. Off: keep `size`, and build on several floors what does not fit its ground area
   * (a group too big for the ground stacks its machines up as well).
   */
  fit?: boolean;
  corridor?: number;
  /** Whether the site will be built with connections from below (so the measuring packs match it). */
  below?: boolean;
}

export interface ImportReport {
  groups: number;
  ports: number;
  links: number;
  /** Thaumcraft aspect flows that were left out. */
  aspects: number;
  /** Nodes not placed (skipped by choice, or with an unknown recipe). */
  skipped: number;
  /** Machines shown as placeholders. */
  placeholders: string[];
  /** Numbers that were out of range and were clamped or dropped (in the file, or rates summed too high). */
  adjusted: number;
  /** Limits hit (too many groups, links, ports or resources). */
  truncated: boolean;
  /** Whether the arranged groups fit the site. */
  fits: boolean;
  needed: [number, number];
  /** Floors the groups stand on (1 = all on the ground). */
  floors: number;
}

/** Groups whose packed footprint stays within this many blocks along both sides are packed as usual. */
const LONG_GROUP = 32;

/**
 * Limits for an imported group of `count` units on one layer. The packer prefers the fewest rows (two
 * rows back to back share their walls), so a hundred units become one strip longer than any site. When the
 * usual footprint is longer than `LONG_GROUP`, the units along X and Z are capped to make it as square
 * as possible (the walkways between row pairs cost a little area).
 */
export function squareLimits(raw: MultiblockDef, count: number): PlanLimits {
  const def = sizedDef(raw, effectiveSize(raw, undefined));
  const free: PlanLimits = { x: null, y: 1, z: null };
  const footprint = (limits: PlanLimits): [number, number] | null => {
    const pack = packUnits(def, count, limits);
    if (pack.placed < count) return null;
    let lo = [Infinity, Infinity];
    let hi = [-Infinity, -Infinity];
    for (const u of pack.units) {
      const s = rotatedSize(def, u.rotation);
      lo = [Math.min(lo[0], u.origin[0]), Math.min(lo[1], u.origin[2])];
      hi = [Math.max(hi[0], u.origin[0] + s[0]), Math.max(hi[1], u.origin[2] + s[2])];
    }
    return [hi[0] - lo[0], hi[1] - lo[1]];
  };
  const base = footprint(free);
  if (!base || Math.max(...base) <= LONG_GROUP) return free;
  let best = free;
  let bestScore = [Math.max(...base), base[0] * base[1]];
  const tried = new Set<number>();
  for (let rows = 2; rows <= count; rows++) {
    const x = Math.ceil(count / rows);
    if (tried.has(x)) continue;
    tried.add(x);
    // Both axes are capped: with X alone the packer turns the strip to run along Z.
    const limits: PlanLimits = { x, y: 1, z: Math.ceil(count / x) };
    const f = footprint(limits);
    if (!f) continue;
    const score = [Math.max(...f), f[0] * f[1]];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = limits;
      bestScore = score;
    }
    // Rows only get more numerous from here: once the depth is the long side, stop.
    if (f[1] > f[0]) break;
  }
  return best;
}

/** A stable, readable colour for a resource without one (hue from a string hash). */
export function fallbackColor(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hue * 12) % 12;
    const c = 0.55 * 0.7 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round((0.55 - c) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const MAX_KEY = 150;

export function resourceKey(kind: GtnhKind, id: string): string {
  return kind === 'power' ? 'power:eu' : `${kind}:${id}`.slice(0, MAX_KEY);
}

/**
 * Turns a project into a site: one group per placed node, links from the edges (storages that sit between
 * machines are passed through), boundary ports for everything that enters or leaves the chain, then
 * auto-arrange. `choices` overrides the proposed machine per node id. `builder` packs the groups to measure
 * them; passing the one that builds the site afterwards lets it reuse those packs.
 */
export function buildSiteFromGtnh(
  project: GtnhProject,
  choices: ReadonlyMap<string, MachineChoice> = new Map(),
  opts: ImportOptions = {},
  builder: SiteBuilder = createSiteBuilder(),
): { site: SiteState; report: ImportReport } {
  const rows = importRows(project);
  const resources: Record<string, ResourceDef> = {};
  let truncated = false;
  let adjusted = project.adjusted;
  const addResource = (
    kind: GtnhKind,
    id: string,
    name?: string,
    color?: string,
    icon?: string,
  ): string | null => {
    if (kind === 'aspect') return null;
    const k = resourceKey(kind, id);
    if (!resources[k]) {
      if (Object.keys(resources).length >= MAX_RESOURCES) {
        truncated = true;
        return null;
      }
      resources[k] = {
        kind,
        name: (kind === 'power' ? 'EU' : (name ?? id)).slice(0, 120),
        color: color ?? (kind === 'power' ? '#e8c547' : fallbackColor(k)),
      };
    } else if (name && resources[k].name === id) resources[k].name = name.slice(0, 120);
    if (icon && !resources[k].icon && kind !== 'power') resources[k].icon = icon;
    return k;
  };
  for (const r of project.recipes.values())
    for (const s of [...r.inputs, ...r.outputs])
      addResource(s.kind, s.id, s.displayName, s.dominantColor, s.iconPath);
  for (const s of project.storages)
    addResource(s.kind, s.resourceId, s.displayName, s.dominantColor, s.iconPath);

  // Groups.
  const groups: SiteGroup[] = [];
  const groupOfNode = new Map<string, string>();
  const placeholders = new Set<string>();
  const voidNodes = new Set<string>();
  let skipped = project.nodes.filter((n) => !n.enabled).length;
  for (const row of rows) {
    const choice = choices.get(row.node.id) ?? row.proposed;
    if (VOID_NAMES.has(row.machine.toLowerCase())) voidNodes.add(row.node.id);
    if (choice.type === 'port') continue;
    if (choice.type === 'skip' || !row.recipe) {
      skipped++;
      continue;
    }
    if (groups.length >= MAX_GROUPS) {
      truncated = true;
      continue;
    }
    const multiblockId =
      choice.type === 'multiblock' ? choice.id : choice.type === 'single' ? SINGLE_BLOCK_ID : PLACEHOLDER_ID;
    const def = getSiteDef(multiblockId);
    if (!def) {
      skipped++;
      continue;
    }
    if (choice.type === 'placeholder') placeholders.add(row.machine);
    const id = `g${groups.length + 1}`;
    const g: SiteGroup = {
      id,
      multiblockId,
      count: row.count,
      limits: choice.type === 'multiblock' ? squareLimits(def, row.count) : { x: null, y: 1, z: null },
      enabledHatches: def.defaultHatches.filter((k) => !IO_KINDS.includes(k)),
      origin: [0, 0],
      rotation: 0,
      source: {
        name: row.recipe.name.slice(0, 120),
        machineCount: Math.round(row.node.machineCount * 100) / 100,
      },
    };
    if (row.node.overclockTier) g.source!.tier = row.node.overclockTier.slice(0, 16);
    if (choice.type !== 'multiblock') g.label = row.machine.slice(0, 120);
    if (choice.type === 'single') {
      // The machine's own look, by the names the node and its recipe map use.
      const handler = row.recipe.handlers.find((h) => h.id === row.node.machineHandlerId);
      const look = [handler?.label, row.recipe.machineType, row.machine]
        .map((n) => (n ? singleMachineForName(n) : undefined))
        .find((m) => m);
      if (look) g.machine = look.id;
    }
    groups.push(g);
    groupOfNode.set(row.node.id, id);
  }

  // Ports, one per (direction, resource).
  const ports: SitePort[] = [];
  const portIds = new Map<string, string>();
  const portFor = (dir: 'in' | 'out', resource: string, isVoid = false): string | null => {
    const k = `${dir}|${resource}|${isVoid ? 1 : 0}`;
    let id = portIds.get(k);
    if (!id) {
      if (ports.length >= MAX_PORTS) {
        truncated = true;
        return null;
      }
      id = `${dir}${ports.length + 1}`;
      const p: SitePort = { id, dir, resource };
      if (isVoid) p.void = true;
      ports.push(p);
      portIds.set(k, id);
    }
    return id;
  };

  // Links, deduplicated by (from, to, resource); rates add up.
  const linkByKey = new Map<string, SiteLink>();
  const addLink = (from: Endpoint, to: Endpoint, resource: string, rate?: number): void => {
    const k = `${JSON.stringify(from)}|${JSON.stringify(to)}|${resource}`;
    const existing = linkByKey.get(k);
    if (existing) {
      if (rate !== undefined) {
        const sum = (existing.rate ?? 0) + rate;
        if (sum > MAX_RATE) adjusted++;
        existing.rate = Math.min(MAX_RATE, sum);
      }
      return;
    }
    if (linkByKey.size >= MAX_LINKS) {
      truncated = true;
      return;
    }
    const l: SiteLink = { id: `l${linkByKey.size + 1}`, from, to, resource };
    if (rate !== undefined) l.rate = rate;
    linkByKey.set(k, l);
  };

  let aspects = 0;
  const storageById = new Map(project.storages.map((s) => [s.id, s]));
  const nodeIds = new Set(project.nodes.map((n) => n.id));
  const storageIn = new Map<string, GtnhEdge[]>();
  const storageOut = new Map<string, GtnhEdge[]>();
  const direct: GtnhEdge[] = [];
  for (const e of project.edges) {
    if (e.resourceKind === 'aspect') {
      aspects++;
      continue;
    }
    if (storageById.has(e.target))
      (storageIn.get(e.target) ?? storageIn.set(e.target, []).get(e.target)!).push(e);
    if (storageById.has(e.source))
      (storageOut.get(e.source) ?? storageOut.set(e.source, []).get(e.source)!).push(e);
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) direct.push(e);
  }

  /** Links an edge between a producer end and a consumer end (either may be outside the site). */
  const connect = (src: string | null, dst: string | null, e: GtnhEdge, isVoid = false): void => {
    const res = addResource(e.resourceKind, e.resourceId);
    if (!res) return;
    const a = src ? groupOfNode.get(src) : undefined;
    const b = dst ? groupOfNode.get(dst) : undefined;
    if (a && b) addLink({ group: a }, { group: b }, res, e.ratePerSecond);
    else if (b) {
      const p = portFor('in', res);
      if (p) addLink({ port: p }, { group: b }, res, e.ratePerSecond);
    } else if (a) {
      const p = portFor('out', res, isVoid || (dst !== null && voidNodes.has(dst)));
      if (p) addLink({ group: a }, { port: p }, res, e.ratePerSecond);
    }
  };
  for (const e of direct) connect(e.source, e.target, e);
  for (const s of project.storages) {
    const ins = (storageIn.get(s.id) ?? []).filter((e) => nodeIds.has(e.source));
    const outs = (storageOut.get(s.id) ?? []).filter((e) => nodeIds.has(e.target));
    if (ins.length && outs.length) {
      // A buffer between machines: connect every producer to every consumer.
      for (const i of ins) for (const o of outs) connect(i.source, o.target, o);
    } else if (ins.length) for (const i of ins) connect(i.source, null, i, s.drainMode === 'trash');
    else for (const o of outs) connect(null, o.target, o);
  }

  // Inputs nothing feeds and outputs nothing takes enter / leave through ports.
  const links = () => [...linkByKey.values()];
  for (const row of rows) {
    const gid = groupOfNode.get(row.node.id);
    if (!gid || !row.recipe) continue;
    for (const s of row.recipe.inputs) {
      if (s.consumed === false || s.kind === 'aspect') continue;
      const res = addResource(s.kind, s.id, s.displayName, s.dominantColor);
      if (!res || links().some((l) => 'group' in l.to && l.to.group === gid && l.resource === res)) continue;
      const p = portFor('in', res);
      if (p) addLink({ port: p }, { group: gid }, res);
    }
    for (const s of row.recipe.outputs) {
      if (s.kind === 'aspect') continue;
      const res = addResource(s.kind, s.id, s.displayName, s.dominantColor);
      if (!res || links().some((l) => 'group' in l.from && l.from.group === gid && l.resource === res))
        continue;
      const p = portFor('out', res);
      if (p) addLink({ group: gid }, { port: p }, res);
    }
  }

  // Keep only resources something uses.
  const usedRes = new Set([...links().map((l) => l.resource), ...ports.map((p) => p.resource)]);
  for (const k of Object.keys(resources)) if (!usedRes.has(k)) delete resources[k];

  let size: [number, number] = opts.size ?? [...DEFAULT_SITE_SIZE];
  let site: SiteState;
  try {
    site = validateSiteState({
      v: 1,
      kind: 'site',
      name: project.name.slice(0, 120),
      size,
      corridor: opts.corridor ?? DEFAULT_CORRIDOR,
      groups,
      links: links(),
      ports,
      resources,
      colors: {},
    });
  } catch (err) {
    // Only a validation refusal is the import's fault; anything else is a bug and keeps its own stack.
    if (!(err instanceof PlanFormatError)) throw err;
    throw new ImportError(`Could not build a valid template: ${err.message}`);
  }
  site = { ...site, groups: stackGroups(site, builder, opts.below) };
  const sizes = localFootprints(builder(site, { pipes: false, cables: false, below: opts.below }));
  let arranged = arrangeSite(site, (id) => sizes.get(id));
  if (opts.fit !== false) {
    // From the smallest site up, so a large site left from an earlier chain does not stretch every pipe.
    size = grownSize({ ...site, size: [SITE_MIN_SIZE, SITE_MIN_SIZE] }, (id) => sizes.get(id), SITE_MAX_SIZE);
    site = { ...site, size };
    arranged = arrangeSite(site, (id) => sizes.get(id));
  } else {
    // The size is the user's: what is too wide for one floor goes on the next.
    const laid = arrangeOnFloors(site, builder, opts.below);
    site = laid.site;
    arranged = laid.arranged;
  }
  site = { ...site, groups: arranged.groups };
  return {
    site,
    report: {
      groups: groups.length,
      ports: ports.length,
      links: site.links.length,
      aspects,
      skipped,
      adjusted,
      placeholders: [...placeholders],
      truncated,
      fits: arranged.fits,
      needed: arranged.needed,
      floors: arranged.floors,
    },
  };
}
