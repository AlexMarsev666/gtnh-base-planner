import { getMultiblock } from '../data/catalog';
import { DEFAULT_HATCH_COLORS } from '../model/colors';
import { layoutCandidates, packUnits } from '../model/layout/packer';
import type { LayoutResult, WallshareFallback } from '../model/layout/types';
import type { CapacityEntry, PlaceResult } from '../model/hatches/types';
import { loosenings } from '../model/layout/variants';
import { alongX } from '../model/orient';
import { resolveLayout, resolveRoutedLayout, type ResolvedLayout } from '../model/plan';
import { mirroredDef } from '../model/mirror';
import { effectiveSize, sizedDef } from '../model/resize';
import { placeHatches } from '../model/hatches/placement';
import { withPipeFaces } from '../model/routing/attachments';
import { CABLE_KINDS, PIPE_KINDS, type RoutedKind } from '../model/routing/kinds';
import { routePipes } from '../model/routing/router';
import { buildSceneModel } from '../model/scene';
import { DEFAULT_TIER, hatchTier, planHatchKeys } from '../model/tiers';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import type { PackResult, PlanState, WallStats } from '../model/plan/types';
import type { SceneModel } from '../model/render/types';
import type { RouteNet } from '../model/routing/routeNet';
import { checkValidity, type UnitValidity } from '../model/validity';
import { computeWallStats } from '../model/walls';
import { withBuildDimensions } from './dimensions';
import { warnOnce } from './warn';
import { hatchKey, layoutKey, pipesKey, sceneKey, validityKey } from './pipelineKeys';

/** The model functions the pipeline calls (injectable for tests). */
export interface PipelineDeps {
  getMultiblock: (id: string) => MultiblockDef | undefined;
  packUnits: typeof packUnits;
  placeHatches: typeof placeHatches;
  /** Looser layouts to try when the compact one cannot fit every hatch. */
  layoutCandidates: typeof layoutCandidates;
  /** Looser versions of a layout, tried when pipes or cables leave a hatch unconnected. */
  loosenings: typeof loosenings;
  computeWallStats: typeof computeWallStats;
  routePipes: typeof routePipes;
  buildSceneModel: typeof buildSceneModel;
}

export const defaultDeps: PipelineDeps = {
  getMultiblock,
  packUnits,
  placeHatches,
  layoutCandidates,
  loosenings,
  computeWallStats,
  routePipes,
  buildSceneModel,
};

export interface PipelineResult {
  def: MultiblockDef | undefined;
  pack: PackResult | null;
  /** True when the layout was loosened (gaps, walkways) so every hatch fits. */
  loosened: boolean;
  hatches: PlaceResult | null;
  /** Units that want more hatches than have a cell for them (from the hatch placement), if any. */
  capacity?: CapacityEntry[];
  /** Set when the plan's wall sharing preference could not be honoured, and what was used instead. */
  wallshareFallback?: WallshareFallback;
  stats: WallStats | null;
  /** Pipe and cable networks (whichever are switched on), or null when both are off. */
  pipes: RouteNet[] | null;
  /** True when the routing work budget left hatches unconnected that more search might have connected. */
  routingTruncated?: boolean;
  /** What the game's structure check would object to, per unit (see `checkValidity`); absent when all is well. */
  validity?: UnitValidity;
  scene: SceneModel | null;
  /** First error thrown by a stage (the stages after it are skipped). */
  error: string | null;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Single-entry cache: recompute only when the key changes. Errors are cached too (same input, same error). */
function stage<T>(name: string) {
  let lastKey: string | undefined;
  let last: Outcome<T> | undefined;
  return (key: string, compute: () => T): Outcome<T> => {
    if (last && key === lastKey) return last;
    try {
      last = { ok: true, value: compute() };
    } catch (err) {
      warnOnce(name, err);
      last = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    lastKey = key;
    return last;
  };
}

export function mergeColors(overrides: PlanState['colors']): Record<HatchKind, string> {
  return { ...DEFAULT_HATCH_COLORS, ...overrides };
}

/**
 * plan → def → units → hatches → stats → pipes → scene, each stage memoised on exactly the inputs it
 * depends on, so changing a colour does not re-pack and a camera move (not an input) recomputes nothing.
 */
export function createPipeline(deps: PipelineDeps = defaultDeps) {
  const layoutStage = stage<LayoutResult>('packUnits');
  const hatchStage = stage<{
    pack: PackResult;
    hatches: PlaceResult;
    loosened: boolean;
    /** Networks already routed while choosing the layout (pipes or cables on, auto layout). */
    pipes?: RouteNet[];
    /** The routing work budget cut the search short (see `ResolvedRoutedLayout`). */
    truncated?: boolean;
  }>('placeHatches');
  const statsStage = stage<WallStats>('computeWallStats');
  const pipesStage = stage<RouteNet[] | null>('routePipes');
  const validityStage = stage<UnitValidity>('checkValidity');
  const sceneStage = stage<SceneModel>('buildSceneModel');
  let lastResultKey: string | undefined;
  let lastResult: PipelineResult | undefined;

  return function run(p: PlanState, pipesOn: boolean, cablesOn = false, below = false): PipelineResult {
    // Hatches may face down, and pipes run under the build, when connections from below are allowed.
    // The wall sharing preference also orders the looser layouts tried when hatches do not fit.
    const d: PipelineDeps = {
      ...deps,
      ...(below
        ? { placeHatches: (df, u, e, a, o) => deps.placeHatches(df, u, e, a, { ...o, below: true }) }
        : {}),
      layoutCandidates: (df, n, l) => deps.layoutCandidates(df, n, l, p.wallshare),
    };
    const raw = deps.getMultiblock(p.multiblockId);
    const size = raw ? effectiveSize(raw, p.size) : undefined;
    // A resizable multiblock is built at the plan's height / length, and mirrored in X when asked.
    const sized = raw ? sizedDef(raw, size) : undefined;
    const def = sized && p.mirror ? mirroredDef(sized) : sized;
    const empty: PipelineResult = {
      def,
      pack: null,
      loosened: false,
      hatches: null,
      stats: null,
      pipes: null,
      scene: null,
      error: null,
    };
    if (!def) return { ...empty, error: `Unknown multiblock "${p.multiblockId}"` };

    const kinds: RoutedKind[] = [...(pipesOn ? PIPE_KINDS : []), ...(cablesOn ? CABLE_KINDS : [])];
    // With pipes or cables on, an auto layout is chosen so that every hatch gets connected.
    const routedLayout = kinds.length > 0 && !p.manualUnits;
    const colors = mergeColors(p.colors);
    const layoutK = layoutKey({
      defId: def.id,
      size,
      count: p.count,
      limits: p.limits,
      mirror: !!p.mirror,
      wallshare: p.wallshare,
      manualUnits: p.manualUnits,
    });
    const hatchK = hatchKey(layoutK, p.enabledHatches, routedLayout ? kinds : null, below);
    const pipesK = pipesKey(hatchK, kinds);
    const validityK = validityKey(pipesK, {
      tier: p.tier,
      hatchTiers: p.hatchTiers,
      glassTier: p.glassTier,
    });
    const sceneK = sceneKey(pipesK, colors);
    // The whole result is reused only when nothing it carries changed: the scene and the validity.
    const resultK = `${sceneK}|${validityK}`;
    if (lastResult && resultK === lastResultKey) return lastResult;

    const finish = (r: PipelineResult) => {
      lastResultKey = resultK;
      lastResult = r;
      return r;
    };

    const pack = layoutStage(layoutK, () => {
      if (p.manualUnits) {
        const n = p.manualUnits.length;
        return { units: p.manualUnits, requested: n, placed: n };
      }
      return deps.packUnits(def, p.count, p.limits, p.wallshare);
    });
    if (!pack.ok) return finish({ ...empty, error: pack.error });
    const packed = pack.value;
    // Hatches may loosen the layout (gaps between units) when the compact one leaves no room for them,
    // and so may pipes and cables when they cannot reach every hatch.
    const placed = hatchStage(hatchK, () =>
      p.manualUnits
        ? {
            pack: pack.value,
            hatches: d.placeHatches(def, pack.value.units, p.enabledHatches),
            loosened: false,
          }
        : longSideAlongX(
            routedLayout ? routedOrPlain() : resolveLayout(def, pack.value, p.enabledHatches, p.limits, d),
          ),
    );
    // Which way the chosen layout runs depends on which candidate first fits every hatch, so counts could
    // flip it between X and Z; turn it so its long side is always along X (unless the X and Z limits
    // differ, which turning would break).
    function longSideAlongX<T extends ResolvedLayout & { pipes?: RouteNet[] }>(r: T): T {
      if ((p.limits.x ?? null) !== (p.limits.z ?? null)) return r;
      const out = alongX(def!, { units: r.pack.units, hatches: r.hatches, pipes: r.pipes });
      if (!out) return r;
      return { ...r, pack: { ...r.pack, units: out.units }, hatches: out.hatches, pipes: out.pipes };
    }
    // A routing failure still renders the build: its error then comes from the pipes stage.
    function routedOrPlain() {
      try {
        return resolveRoutedLayout(def!, packed, p.enabledHatches, p.limits, { kinds, below }, d);
      } catch (err) {
        // Routing never fails on purpose, so this is a bug: report it, then fall back.
        warnOnce('resolveRoutedLayout', err);
        return resolveLayout(def!, packed, p.enabledHatches, p.limits, d);
      }
    }
    if (!placed.ok) return finish({ ...empty, pack: pack.value, error: placed.error });
    const units = placed.value.pack.units;
    const hatchResult = placed.value.hatches;
    const layout = placed.value.pack;
    const loosened = placed.value.loosened;

    const stats = statsStage(hatchK, () => deps.computeWallStats(def, units, hatchResult.hatches));
    if (!stats.ok)
      return finish({ ...empty, pack: layout, loosened, hatches: hatchResult, error: stats.error });

    // Pipes and cables are optional: a routing failure still renders the build without them.
    const routed = placed.value.pipes;
    const pipes = pipesStage(pipesK, () =>
      kinds.length > 0 ? (routed ?? d.routePipes(def, units, hatchResult.hatches, { kinds, below })) : null,
    );
    const pipeNets = pipes.ok ? pipes.value : null;
    const routingTruncated = routed ? placed.value.truncated === true : undefined;

    // Hatches turn to whichever side their pipe reaches them from.
    const turned = withPipeFaces(hatchResult.hatches, pipeNets);
    const validity = validityStage(validityK, () => {
      const keys = planHatchKeys(turned);
      return checkValidity(def, units, turned, {
        glassTier: p.glassTier,
        hatchTierOf: (i) => hatchTier(turned[i].kind, keys[i], p.tier ?? DEFAULT_TIER, p.hatchTiers),
      });
    });
    // Width and depth of the whole build are measured beside it.
    const scene = sceneStage(sceneK, () =>
      withBuildDimensions(deps.buildSceneModel(def, units, turned, stats.value, pipeNets, colors)),
    );
    return finish({
      def,
      pack: layout,
      loosened,
      hatches: hatchResult,
      ...(hatchResult.capacity ? { capacity: hatchResult.capacity } : {}),
      ...(packed.fallback ? { wallshareFallback: packed.fallback } : {}),
      stats: stats.value,
      pipes: pipeNets,
      ...(validity.ok && Object.keys(validity.value).length > 0 ? { validity: validity.value } : {}),
      ...(routingTruncated ? { routingTruncated } : {}),
      scene: scene.ok ? scene.value : null,
      error: scene.ok ? (pipes.ok ? null : pipes.error) : scene.error,
    });
  };
}
