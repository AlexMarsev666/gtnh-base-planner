<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { DEFAULT_HATCH_COLORS } from '../model/colors';
  import type { Vec3, ViewMode } from '../model/core/types';
  import type { SceneModel } from '../model/render/types';
  import { createRenderer, type Renderer } from '../render/renderer';
  import { warnOnce } from './notices';

  interface Props {
    scene: SceneModel | null;
    mode: ViewMode;
    xray: boolean;
    selected: number[];
    onpick: (unitIds: number[]) => void;
    onfail: () => void;
    /** DETAILED was requested but the textures failed to load, so SIMPLE is drawn. */
    onviewfallback?: () => void;
    /** Site view: a pipe was clicked (net id), or something else (null). */
    onpicknet?: (netId: number | null) => void;
    /** A hatch block was clicked (its cell), or something else (null). Called after `onpick`. */
    onpickhatch?: (cell: Vec3 | null) => void;
    /** Cells to highlight (the selected hatch). */
    marked?: readonly Vec3[];
    /** Site view: animate flow arrows. */
    flow?: boolean;
    /** The camera azimuth changed (see `RendererOptions.onView`). */
    onview?: (theta: number) => void;
    /** Site view: dragging the selection moved it by whole blocks. Without it the selection cannot be dragged. */
    onmove?: (dx: number, dz: number) => void;
    /** While dragging: the offset so far, null when the drag ends. */
    ondrag?: (offset: [number, number] | null) => void;
    /** Aim the camera at this box whenever `seq` changes. */
    frame?: { min: Vec3; max: Vec3; seq: number } | null;
    /** Canvas pixels covered by the outline (left), a drawer (right) or sheet (bottom). */
    inset?: { left: number; right: number; bottom: number; top: number };
  }
  let {
    scene,
    mode,
    xray,
    selected,
    onpick,
    onfail,
    onviewfallback,
    onpicknet,
    onpickhatch,
    marked = [],
    flow = true,
    onview,
    onmove,
    ondrag,
    frame = null,
    inset = { left: 0, right: 0, bottom: 0, top: 0 },
  }: Props = $props();

  const EMPTY_SCENE: SceneModel = {
    voxels: [],
    hatches: [],
    pipes: null,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    colors: DEFAULT_HATCH_COLORS,
  };

  let canvas = $state<HTMLCanvasElement>();
  let renderer = $state.raw<Renderer | null>(null);

  /** Renderer calls never take the UI down. */
  function guard(name: string, fn: () => unknown): void {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((err: unknown) => warnOnce(name, err));
    } catch (err) {
      warnOnce(name, err);
    }
  }

  onMount(() => {
    if (!canvas) return;
    let r: Renderer;
    try {
      r = createRenderer(canvas, {
        onPick: (ids) => onpick(ids),
        onPickNet: (id) => onpicknet?.(id),
        onPickHatch: (cell) => onpickhatch?.(cell),
        onView: (theta) => onview?.(theta),
        onMoveSelection: (dx, dz) => onmove?.(dx, dz),
        onDragOffset: (o) => ondrag?.(o),
        onViewModeFallback: () => onviewfallback?.(),
      });
    } catch (err) {
      warnOnce('createRenderer', err);
      onfail();
      return;
    }
    // The renderer observes the canvas size itself.
    renderer = r;
    return () => {
      renderer = null;
      guard('dispose', () => r.dispose());
    };
  });

  // Each effect runs only when its own input changes (scene identity is memoised by the pipeline).
  // When the pipeline fails the old build must not stay on screen (or stay pickable).
  let showing = false;
  $effect(() => {
    const r = renderer;
    const s = scene;
    if (!r) return;
    if (s) {
      showing = true;
      guard('setScene', () => r.setScene(s));
    } else if (showing) {
      showing = false;
      guard('setScene', () => r.setScene(EMPTY_SCENE));
      untrack(() => onpick([]));
    }
  });
  $effect(() => {
    const r = renderer;
    const m = mode;
    if (r) guard('setViewMode', () => r.setViewMode(m));
  });
  $effect(() => {
    const r = renderer;
    const on = xray;
    if (r) guard('setXray', () => r.setXray(on));
  });
  $effect(() => {
    const r = renderer;
    const ids = selected;
    if (r) guard('setSelected', () => r.setSelected(ids));
  });
  $effect(() => {
    const r = renderer;
    const cells = marked;
    if (r) guard('setMarkedCells', () => r.setMarkedCells(cells));
  });
  $effect(() => {
    const r = renderer;
    const on = flow;
    if (r) guard('setFlowAnimation', () => r.setFlowAnimation(on));
  });
  $effect(() => {
    const r = renderer;
    const on = !!onmove;
    if (r) guard('setDragEnabled', () => r.setDragEnabled(on));
  });
  // Only a new request moves the camera (not the same one coming back after a mode switch).
  let framedSeq = -1;
  $effect(() => {
    const r = renderer;
    const f = frame;
    if (!r || !f || f.seq === framedSeq) return;
    framedSeq = f.seq;
    guard('frameBox', () => r.frameBox(f.min, f.max));
  });
  $effect(() => {
    const r = renderer;
    const { left, right, bottom, top } = inset;
    if (r) guard('setInset', () => r.setInset(left, right, bottom, top));
  });
</script>

<canvas bind:this={canvas} data-testid="scene"></canvas>

<style>
  canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    background: var(--bg);
    outline: none;
    touch-action: none;
  }
</style>
