import { withSteamFrame } from '../model/multiblock/steamWaterPump';
import { derived } from 'svelte/store';
import { getMultiblock } from '../data/catalog';
import { DEFAULT_HATCH_COLORS } from '../model/colors';
import { layoutCandidates, packUnits } from '../model/layout/packer';
import { loosenings } from '../model/layout/variants';
import { alongX } from '../model/orient';
import { resolveLayout, resolveRoutedLayout, type ResolvedLayout } from '../model/plan';
import { effectiveSize, sizedDef } from '../model/resize';
import { placeHatches } from '../model/hatches/placement';
import { withPipeFaces } from '../model/routing/attachments';
import { CABLE_KINDS, PIPE_KINDS, type RoutedKind } from '../model/routing/kinds';
import { routePipes } from '../model/routing/router';
import { buildSceneModel } from '../model/scene';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import type { HatchResult, PackResult, PlanState, WallStats } from '../model/plan/types';
import type { SceneModel } from '../model/render/types';
import type { RouteNet } from '../model/routing/routeNet';
import { computeWallStats } from '../model/walls';
import { connectBelow, plan, showCables, showPipes } from '../state/store';
import { withBuildDimensions } from './dimensions';
import { warnOnce } from './notices';
import { hatchKey, layoutKey, pipesKey, sceneKey } from './pipelineKeys';
import { placeResourceHatches, validateResourceHatches } from '../model/site/resourcePlacement';
import { validateAlternativeCounts } from '../model/multiblock/rules';
import { hatchTiers } from '../data/single-machines';
import { supportsHatchTier } from '../model/hatches/tiers';
import { withUniformHatchTiers } from '../model/hatches/assignments';
import { withStructureGlass } from '../model/multiblock/glass';
import { withAssemblyGrowth } from '../model/multiblock/circuitAssemblyLine';

/** The model functions the pipeline calls (injectable for tests). */
export interface PipelineDeps {
  getMultiblock: (id: string) => MultiblockDef | undefined;
  packUnits: typeof packUnits;
  placeHatches: typeof placeHatches;
  placeResourceHatches?: typeof placeResourceHatches;
  validateResourceHatches?: typeof validateResourceHatches;
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
  placeResourceHatches,
  validateResourceHatches,
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
  hatches: HatchResult | null;
  stats: WallStats | null;
  /** Pipe and cable networks (whichever are switched on), or null when both are off. */
  pipes: RouteNet[] | null;
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
  const layoutStage = stage<PackResult>('packUnits');
  const hatchStage = stage<{
    pack: PackResult;
    hatches: HatchResult;
    loosened: boolean;
    /** Networks already routed while choosing the layout (pipes or cables on, auto layout). */
    pipes?: RouteNet[];
  }>('placeHatches');
  const statsStage = stage<WallStats>('computeWallStats');
  const pipesStage = stage<RouteNet[] | null>('routePipes');
  const sceneStage = stage<SceneModel>('buildSceneModel');
  let lastResultKey: string | undefined;
  let lastResult: PipelineResult | undefined;

  return function run(p: PlanState, pipesOn: boolean, cablesOn = false, below = false): PipelineResult {
    // Hatches may face down, and pipes run under the build, when connections from below are allowed.
    const raw = deps.getMultiblock(p.multiblockId);
    const tiered =
      (p.voltageTier !== undefined ||
        p.hatchTiers !== undefined ||
        p.enabledHatches.includes('dataAccess')) &&
      raw &&
      p.enabledHatches.some((k) => supportsHatchTier(raw, k));
    const d: PipelineDeps =
      tiered && deps.placeResourceHatches
        ? {
            ...deps,
            placeHatches: (df, u, e, a) =>
              Object.keys(p.hatchTiers ?? {}).length
                ? deps.placeResourceHatches!(df, u, e, {}, p, below, {})
                : withUniformHatchTiers(df, u, deps.placeHatches(df, u, e, a, { below }), p),
          }
        : below
          ? { ...deps, placeHatches: (df, u, e, a) => deps.placeHatches(df, u, e, a, { below: true }) }
          : deps;
    const size = raw ? effectiveSize(raw, p.size) : undefined;
    // A resizable multiblock is built at the plan's height / length.
    const def = raw
      ? withSteamFrame(
          withAssemblyGrowth(withStructureGlass(sizedDef(raw, size), p.structureGlassTier), p.assemblyGrowth),
          p.steamFrameTier,
        )
      : undefined;
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
    if (p.size !== undefined && p.size !== size)
      return {
        ...empty,
        error: `Saved size ${p.size} is not supported by the current rules for "${p.multiblockId}"`,
      };

    const kinds: RoutedKind[] = [...(pipesOn ? PIPE_KINDS : []), ...(cablesOn ? CABLE_KINDS : [])];
    // With pipes or cables on, an auto layout is chosen so that every hatch gets connected.
    const routedLayout = kinds.length > 0 && !p.manualUnits;
    const colors = mergeColors(p.colors);
    const layoutK = layoutKey({
      defId: def.id,
      structureGlassTier: p.structureGlassTier,
      assemblyGrowth: p.assemblyGrowth,
      steamFrameTier: p.steamFrameTier,
      size,
      count: p.count,
      limits: p.limits,
      manualUnits: p.manualUnits,
    });
    const hatchK = hatchKey(layoutK, p.enabledHatches, routedLayout ? kinds : null, below, p);
    const pipesK = pipesKey(hatchK, kinds);
    const sceneK = sceneKey(pipesK, colors);
    if (lastResult && sceneK === lastResultKey) return lastResult;

    const finish = (r: PipelineResult) => {
      lastResultKey = sceneK;
      lastResult = r;
      return r;
    };

    const pack = layoutStage(layoutK, () => {
      if (p.manualUnits) {
        const n = p.manualUnits.length;
        return { units: p.manualUnits, requested: n, placed: n };
      }
      return deps.packUnits(def, p.count, p.limits);
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
    const tierErrors = hatchResult.hatches.flatMap((h) =>
      h.tier && hatchTiers(h.kind).length && !hatchTiers(h.kind).includes(h.tier)
        ? [`${h.kind} has no ${h.tier} variant in RC2.`]
        : [],
    );
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
    const validationErrors = deps.validateResourceHatches
      ? [
          ...deps.validateResourceHatches(def, units, withPipeFaces(hatchResult.hatches, pipeNets), p),
          ...validateAlternativeCounts(def, units, hatchResult.hatches),
        ]
      : [];

    // Hatches turn to whichever side their pipe reaches them from.
    // Width and depth of the whole build are measured beside it.
    const scene = sceneStage(sceneK, () =>
      withBuildDimensions(
        deps.buildSceneModel(
          def,
          units,
          withPipeFaces(hatchResult.hatches, pipeNets),
          stats.value,
          pipeNets,
          colors,
        ),
      ),
    );
    return finish({
      def,
      pack: layout,
      loosened,
      hatches: hatchResult,
      stats: stats.value,
      pipes: pipeNets,
      scene: scene.ok ? scene.value : null,
      error: scene.ok
        ? pipes.ok
          ? [...new Set([...tierErrors, ...validationErrors])].join(' ') || null
          : pipes.error
        : scene.error,
    });
  };
}

const run = createPipeline();

/** The derived build for the current plan; recomputes only when the plan or the view toggles change. */
export const build = derived(
  [plan, showPipes, showCables, connectBelow],
  ([$plan, $showPipes, $showCables, $below]) => run($plan, $showPipes, $showCables, $below),
);
