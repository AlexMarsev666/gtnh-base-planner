/**
 * Standalone renderer test page (`renderer-harness.html`), used by `e2e/renderer.spec.ts`.
 * Builds a scene from hand-made coke oven units, hatches and pipes (no layout/ports/routing units needed).
 *
 * Query params: `count` (units, default 12), `pipes=0` (hide pipes), `xray=1`, `select=1,2`, `mode=detailed`,
 * `def=<multiblock id>` (build that multiblock through the real model pipeline instead, for benchmarks),
 * `turn=<n>` (with `def`: pipe bends cost n extra blocks instead of the default; 0 = plain BFS),
 * `theta=<rad>&phi=<rad>` (camera angles; `phi` > 1.57 looks from below).
 */
import { getMultiblock } from '../../data/catalog';
import { DEFAULT_HATCH_COLORS } from '../../model/colors';
import { buildSceneModel } from '../../model/scene';
import { defaultPlan } from '../../state/store';
import { routePipes } from '../../model/routing/router';
import { createPipeline, defaultDeps } from '../../ui/pipeline';
import type { Vec3, ViewMode } from '../../model/core/types';
import type { Unit } from '../../model/multiblock/types';
import type { HatchPlacement, WallStats } from '../../model/plan/types';
import type { SceneModel } from '../../model/render/types';
import type { RouteNet } from '../../model/routing/routeNet';
import { createRenderer, type Renderer, type RendererDebug } from '../renderer';

export interface Harness {
  ready: boolean;
  picks: number[][];
  /** Cell of the hatch block under each click (null when it was something else). */
  hatchPicks: (Vec3 | null)[];
  unitCount: number;
  /** Time the renderer took to build the scene (ms). */
  sceneMs: number;
  renderer: Renderer & RendererDebug;
  setXray(on: boolean): void;
  setViewMode(mode: ViewMode): Promise<void>;
  benchmark(frames: number): number;
}

declare global {
  interface Window {
    __harness?: Harness;
  }
}

interface Layout {
  units: Unit[];
  hatches: HatchPlacement[];
  pipes: RouteNet[];
}

/** Back-to-back rows of coke ovens sharing walls, controllers facing outward, pairs of rows 2 blocks apart. */
export function cokeOvenLayout(count: number): Layout {
  const pairs = Math.max(1, Math.round(Math.sqrt(count) / 2.5));
  const cols = Math.max(1, Math.ceil(count / (2 * pairs)));
  const units: Unit[] = [];
  const hatches: HatchPlacement[] = [];
  const rows = new Map<string, { z: number; frontZ: number; face: 'north' | 'south'; xs: number[] }>();

  for (let i = 0; i < count; i++) {
    const pair = Math.floor(i / (2 * cols));
    const row = Math.floor((i % (2 * cols)) / cols);
    const col = i % cols;
    const origin: Vec3 = [col * 2, 0, pair * 7 + row * 2];
    const id = i + 1;
    units.push({ id, origin, rotation: row === 0 ? 0 : 2 });
    const face = row === 0 ? 'north' : 'south';
    const frontZ = row === 0 ? origin[2] : origin[2] + 2;
    hatches.push({ kind: 'itemIn', cell: [origin[0] + 1, 2, origin[2] + 1], face: 'up', unitIds: [id] });
    hatches.push({ kind: 'itemOut', cell: [origin[0] + 1, 0, frontZ], face, unitIds: [id] });
    hatches.push({
      kind: 'fluidOut',
      cell: [origin[0], 1, frontZ],
      face,
      unitIds: col > 0 ? [id - 1, id] : [id],
    });
    const rowKey = `${pair}:${row}`;
    const r = rows.get(rowKey) ?? { z: origin[2] + 1, frontZ, face, xs: [] };
    r.xs.push(origin[0]);
    rows.set(rowKey, r);
  }

  const nets: Record<'itemIn' | 'itemOut' | 'fluidOut', Vec3[][]> = { itemIn: [], itemOut: [], fluidOut: [] };
  for (const r of rows.values()) {
    const x0 = Math.min(...r.xs);
    const x1 = Math.max(...r.xs);
    const out = r.face === 'north' ? r.frontZ - 1 : r.frontZ + 1;
    const line = (from: number, to: number, y: number, z: number): Vec3[] => {
      const path: Vec3[] = [];
      for (let x = from; x <= to; x++) path.push([x, y, z]);
      return path;
    };
    nets.itemIn.push(line(x0 + 1, x1 + 1, 3, r.z));
    nets.itemOut.push(line(x0 + 1, x1 + 1, 0, out));
    // Fluid line with a riser at the end to exercise bends.
    nets.fluidOut.push([...line(x0, x1 + 2, 1, out), [x1 + 2, 2, out], [x1 + 2, 3, out]]);
  }
  const pipes: RouteNet[] = (['itemIn', 'itemOut', 'fluidOut'] as const).map((kind) => ({
    kind,
    paths: nets[kind],
    length: nets[kind].reduce((n, p) => n + p.length, 0),
    connected: 0,
    total: 0,
  }));
  return { units, hatches, pipes };
}

/** Scene of `count` units of a catalog multiblock, built by the app's own pipeline. */
function pipelineScene(
  id: string,
  count: number,
  pipesOn: boolean,
  turnCost: number | undefined,
): { model: SceneModel; units: number } {
  const deps = {
    ...defaultDeps,
    routePipes: ((d, u, h) => routePipes(d, u, h, { turnCost })) as typeof routePipes,
  };
  const result = createPipeline(deps)({ ...defaultPlan(id), count }, pipesOn);
  if (!result.scene) throw new Error(`harness: no scene for ${id}: ${result.error ?? 'unknown error'}`);
  return { model: result.scene, units: result.pack?.units.length ?? 0 };
}

function cokeOvenScene(count: number, pipesOn: boolean): { model: SceneModel; units: number } {
  const def = getMultiblock('coke-oven');
  if (!def) throw new Error('harness: coke-oven definition missing');
  const { units, hatches, pipes } = cokeOvenLayout(count);
  const stats: WallStats = {
    totalBlocks: 0,
    byBlock: {},
    controllers: units.length,
    hatches: hatches.length,
    sharedWalls: [],
    conflicts: [],
    conflictCells: [],
    savedBlocks: 0,
  };
  const model = buildSceneModel(def, units, hatches, stats, pipesOn ? pipes : null, DEFAULT_HATCH_COLORS);
  return { model, units: units.length };
}

function start(): void {
  const params = new URLSearchParams(location.search);
  const count = Math.max(1, Math.min(200, Number(params.get('count') ?? 12) || 12));
  const pipesOn = params.get('pipes') !== '0';
  const defId = params.get('def');
  const turnParam = params.get('turn');
  const turnCost = turnParam === null ? undefined : Number(turnParam) || 0;
  const { model, units } = defId
    ? pipelineScene(defId, count, pipesOn, turnCost)
    : cokeOvenScene(count, pipesOn);

  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-testid="scene"]');
  if (!canvas) throw new Error('harness: canvas missing');
  const picks: number[][] = [];
  const hatchPicks: (Vec3 | null)[] = [];
  const renderer = createRenderer(canvas, {
    preserveDrawingBuffer: true,
    onPick: (ids) => {
      picks.push(ids);
      renderer.setSelected(ids);
    },
    onPickHatch: (cell) => {
      hatchPicks.push(cell);
      renderer.setMarkedCells(cell ? [cell] : []);
    },
  });
  const t0 = performance.now();
  renderer.setScene(model);
  const sceneMs = performance.now() - t0;
  const theta = params.get('theta');
  const phi = params.get('phi');
  if (theta !== null || phi !== null) renderer.setAngles(Number(theta ?? Math.PI / 4), Number(phi ?? 0.95));
  if (params.get('xray') === '1') renderer.setXray(true);
  const select = params.get('select');
  if (select) renderer.setSelected(select.split(',').map(Number));

  const harness: Harness = {
    ready: false,
    picks,
    hatchPicks,
    unitCount: units,
    sceneMs,
    renderer,
    setXray: (on) => renderer.setXray(on),
    setViewMode: (mode) => renderer.setViewMode(mode),
    benchmark: (frames) => renderer.benchmark(frames),
  };
  window.__harness = harness;

  const mode = params.get('mode');
  const modeReady = mode === 'detailed' ? renderer.setViewMode('detailed') : Promise.resolve();
  void modeReady.then(() => requestAnimationFrame(() => requestAnimationFrame(() => (harness.ready = true))));
}

start();
