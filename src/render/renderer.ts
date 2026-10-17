import * as THREE from 'three';
import { JUNCTION_COLOR } from '../model/colors';
import { dirVec, key } from '../model/geometry';
import { isCable } from '../model/routing/kinds';
import type { Dir, Vec3, ViewMode } from '../model/core/types';
import type { SceneModel, Voxel } from '../model/render/types';
import { DEFAULT_PHI, DEFAULT_THETA, fitPoints, fitView, OrbitControls } from './controls';
import type { BlockVisual, MaterialProvider } from './materials';
import { choosePick, type PickHit } from './pick';
import { createSimpleProvider } from './simple';

export interface RendererOptions {
  /** Called with the unit ids under the pointer on click (empty array = background or a pipe). */
  onPick?: (unitIds: number[]) => void;
  /** Called on click with the id of the net (`RouteNet.id`) under the pointer, or null. */
  onPickNet?: (netId: number | null) => void;
  /** Called on click with the cell of the hatch block under the pointer, or null when it is something else. */
  onPickHatch?: (cell: Vec3 | null) => void;
  /** Called after a frame when the camera azimuth (`OrbitControls.theta`, radians) changed. */
  onView?: (theta: number) => void;
  /**
   * Dragging the selection (see `setDragEnabled`) ended at a new place: whole blocks along X and Z. The
   * selection outline stays at the new place until the next scene arrives.
   */
  onMoveSelection?: (dx: number, dz: number) => void;
  /** While dragging the selection: the offset so far (null when the drag ends). */
  onDragOffset?: (offset: [number, number] | null) => void;
  /** Called when DETAILED was requested but SIMPLE is drawn instead (the textures could not be loaded). */
  onViewModeFallback?: () => void;
  /** Keep the drawing buffer after compositing so tests can read pixels back. Default false. */
  preserveDrawingBuffer?: boolean;
}

export interface Renderer {
  setScene(model: SceneModel): void;
  setViewMode(mode: ViewMode): Promise<void>;
  setXray(on: boolean): void;
  setSelected(unitIds: number[]): void;
  /** Highlight single cells (the selected hatch); an empty list clears the highlight. */
  setMarkedCells(cells: readonly Vec3[]): void;
  /** Animate flow arrows along nets that carry `flows` (site view). */
  setFlowAnimation(on: boolean): void;
  /** Reset camera to fit the scene. */
  resetView(): void;
  /** Whether pressing on the selection and dragging moves it (site view) instead of orbiting. */
  setDragEnabled(on: boolean): void;
  /** Aim at a box (inclusive min, exclusive max, in blocks), keeping the camera angles. */
  frameBox(min: Vec3, max: Vec3): void;
  /**
   * Pixels of the canvas covered on the left (the outline), the right and at the bottom (a drawer or
   * sheet): the view is shifted so the scene centres in the part left free.
   */
  setInset(left: number, right: number, bottom: number, top: number): void;
  resize(): void;
  dispose(): void;
}

/** Extras for tests and diagnostics; not needed by the UI. */
export interface RendererDebug {
  /** The view mode actually in use (DETAILED falls back to SIMPLE when unavailable). */
  readonly viewMode: ViewMode;
  /** Render `frames` frames synchronously (camera slowly orbiting) and return the mean ms per frame. */
  benchmark(frames: number): number;
  /** Draw calls / triangles of the last frame and number of voxel instances. */
  info(): { calls: number; triangles: number; instances: number };
  /** Look from (`theta`, `phi`) (radians, `phi` from straight up) and refit the scene. */
  setAngles(theta: number, phi: number): void;
}

const CASING_XRAY_OPACITY = 0.1;
/** A floor with pipes under it is drawn this see-through, like the plain ground then. */
const FLOOR_SEE_THROUGH_OPACITY = 0.55;
const CONFLICT_COLOR = '#e5484d';
const SELECT_TINT = '#3b82f6';
const SELECT_LINE = '#111111';
/** Pipe thickness: square like GT pipes, 6/16 of a block (a small pipe). */
const PIPE_WIDTH = 6 / 16;
/** A pipe junction block is a little thicker than the pipes that merge into it. */
const JUNCTION_WIDTH = PIPE_WIDTH * 1.35;
/** Cable thickness: thinner than pipes (a 2x GT cable), so the two read apart at a glance. */
const CABLE_WIDTH = 3 / 16;
/** Flow arrows: wider than a pipe so they show around it, and their speed (blocks per second). */
const FLOW_RADIUS = 0.25;
const FLOW_LENGTH = 0.34;
const FLOW_SPEED = 1.2;
const DIM_OPACITY = 0.14;
const GRID_COLOR = '#e4e2dd';
const SITE_EDGE_COLOR = '#8f8b84';
const SITE_FLOOR_COLOR = '#f6f5f2';
/** Dimension lines beside the build or site: colours, and gap from the edge (blocks). */
const DIM_COLOR = '#aaa69f';
const DIM_GAP = 1.2;
const GIZMO_PX = 96;
const GIZMO_MARGIN_PX = 14;
const AXIS_COLORS = { x: '#d9534f', y: '#4caf50', z: '#3b7dd8' } as const;

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function dirVector(d: Dir): THREE.Vector3 {
  const v = dirVec(d);
  return new THREE.Vector3(v[0], v[1], v[2]);
}

function center(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);
}

/** Line segment endpoints (x, y, z of each) of the 12 edges of every box. */
function boxEdges(boxes: readonly THREE.Box3[]): number[] {
  const positions: number[] = [];
  const corner = (b: THREE.Box3, i: number): number[] => [
    i & 1 ? b.max.x : b.min.x,
    i & 2 ? b.max.y : b.min.y,
    i & 4 ? b.max.z : b.min.z,
  ];
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]; // prettier-ignore
  for (const b of boxes) for (const [a, c] of edges) positions.push(...corner(b, a), ...corner(b, c));
  return positions;
}

function visualKey(v: Voxel): string {
  return `${v.blockId}|${v.kind}|${v.hatchKind ?? ''}|${v.facing ?? ''}|${v.baseBlockId ?? ''}|${v.conflict ? 1 : 0}`;
}

interface VoxelBatch {
  mesh: THREE.InstancedMesh;
  /** Instance id -> index into `model.voxels`. */
  indices: number[];
  kind: Voxel['kind'];
  conflict: boolean;
  /** A single material when all six faces match (one draw call instead of six). */
  baseMaterials: THREE.Material | THREE.Material[];
  /** Drawn see-through (glass): a click goes on to what is behind it, like for a faded block. */
  glass: boolean;
}

/** Device pixels per CSS pixel the canvas is drawn at (the same cap as the WebGL renderer). */
function pixelRatio(): number {
  return Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
}

/**
 * A texture for text drawn at the size it is shown: no mipmaps, so it is sampled about 1:1 instead of
 * being blurred down from a larger canvas.
 */
function textTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** CSS pixel heights of screen labels (the sprite box; the text is two thirds of it). */
const LABEL_PX = 20;
const LABEL_SMALL_PX = 17;

/**
 * A label drawn at a constant size on screen, above everything (site groups and ports). `swatch` adds a
 * coloured dot before the text (the text itself stays dark, so light colours remain readable). The canvas
 * is drawn in device pixels at its on-screen size; `sizeLabel` sets the sprite's scale for the view.
 */
function textSprite(
  text: string,
  swatch: string | undefined,
  small: boolean,
  textColor = '#222222',
): THREE.Sprite {
  const dpr = pixelRatio();
  const cssH = small ? LABEL_SMALL_PX : LABEL_PX;
  const px = Math.round((cssH / 1.5) * dpr);
  const font = `600 ${px}px 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const dot = swatch ? px * 0.9 : 0;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  let w = 64;
  if (ctx) {
    ctx.font = font;
    w = Math.ceil(ctx.measureText(text).width + dot + 16 * dpr);
  }
  const h = Math.round(cssH * dpr);
  c.width = w;
  c.height = h;
  if (ctx) {
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 * dpr;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    const x = 8 * dpr + dot;
    ctx.strokeText(text, x, h / 2);
    ctx.fillStyle = textColor;
    ctx.fillText(text, x, h / 2);
    if (swatch) {
      ctx.beginPath();
      ctx.arc(8 * dpr + px * 0.3, h / 2, px * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8 * dpr + px * 0.3, h / 2, px * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = swatch;
      ctx.fill();
    }
  }
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textTexture(c),
      depthTest: false,
      sizeAttenuation: false,
      transparent: true,
    }),
  );
  sprite.userData.label = { cssH, aspect: w / h };
  sprite.renderOrder = 10;
  return sprite;
}

/**
 * Scales a `textSprite` to its CSS pixel height on a view `viewH` CSS pixels tall. With sizeAttenuation
 * off, a sprite's scale is measured on the view plane at distance 1, which is 2·tan(fov/2) units high.
 */
function sizeLabel(sprite: THREE.Sprite, viewH: number, fov: number): void {
  const label = sprite.userData.label as { cssH: number; aspect: number } | undefined;
  if (!label) return;
  // Before the first resize: a typical view height.
  const h = (label.cssH / (viewH > 0 ? viewH : 720)) * 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  sprite.scale.set(h * label.aspect, h, 1);
}

/** Gizmo label size in gizmo units; the gizmo view is `GIZMO_SPAN` units across `GIZMO_PX` CSS pixels. */
const GIZMO_LABEL = 0.7;
const GIZMO_SPAN = 3.6;

/** Text label for the axis gizmo, drawn at the pixel size it is shown at. */
function labelSprite(text: string, color: string): THREE.Sprite {
  const size = Math.round((GIZMO_LABEL / GIZMO_SPAN) * GIZMO_PX * pixelRatio());
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.font = `600 ${Math.round(size * (text.length > 1 ? 0.46 : 0.62))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2 + size * 0.03);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(c), depthTest: false }));
  sprite.scale.setScalar(GIZMO_LABEL);
  return sprite;
}

function buildGizmo(): THREE.Scene {
  const scene = new THREE.Scene();
  const shaft = new THREE.CylinderGeometry(0.045, 0.045, 1, 10);
  shaft.translate(0, 0.5, 0);
  const tip = new THREE.ConeGeometry(0.11, 0.26, 14);
  tip.translate(0, 1.08, 0);
  const axes: [string, THREE.Vector3, string][] = [
    ['X', new THREE.Vector3(1, 0, 0), AXIS_COLORS.x],
    ['Y', new THREE.Vector3(0, 1, 0), AXIS_COLORS.y],
    ['Z', new THREE.Vector3(0, 0, 1), AXIS_COLORS.z],
  ];
  for (const [label, dir, color] of axes) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
    for (const g of [shaft, tip]) {
      const m = new THREE.Mesh(g, mat);
      m.quaternion.copy(q);
      scene.add(m);
    }
    const s = labelSprite(label, color);
    s.position.copy(dir).multiplyScalar(1.55);
    scene.add(s);
  }
  scene.add(
    new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: '#9a9a9a' })),
  );
  return scene;
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
  });
}

/**
 * UNIT 6 — Three.js renderer. Must not produce a mirrored image (right-handed, Y up).
 * SIMPLE materials come from `./simple.ts`; DETAILED from `createDetailedProvider()` in `./detailed.ts` (UNIT 7).
 *
 * Rendering is on demand (a frame is drawn only after something changed), voxels are drawn as one
 * InstancedMesh per distinct visual, so a 60-unit plan is a few dozen draw calls.
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  options: RendererOptions = {},
): Renderer & RendererDebug {
  const gl = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  gl.setClearColor(0xffffff, 1);
  gl.autoClear = false;
  gl.info.autoReset = false; // count main pass + gizmo together

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4cf, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  scene.add(sun);
  scene.add(sun.target);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 5000);
  const content = new THREE.Group();
  const selection = new THREE.Group();
  /** The highlighted hatch cells; unlike the selection it never moves with a drag. */
  const marks = new THREE.Group();
  scene.add(content, selection, marks);

  const gizmo = buildGizmo();
  const half = GIZMO_SPAN / 2;
  const gizmoCamera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 10);

  // Shared geometries and renderer-owned materials (provider materials are never disposed here).
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // Pipes and markers are a few pixels wide on screen: modest segment counts keep large plans light.
  const discGeo = new THREE.CircleGeometry(0.19, 20);
  const ringGeo = new THREE.RingGeometry(0.19, 0.28, 24);
  const thinRingGeo = new THREE.RingGeometry(0.19, 0.235, 24);
  const pipeGeo = new THREE.BoxGeometry(PIPE_WIDTH, 1, PIPE_WIDTH);
  const jointGeo = new THREE.BoxGeometry(PIPE_WIDTH, PIPE_WIDTH, PIPE_WIDTH);
  const conflictMat = new THREE.MeshLambertMaterial({ color: CONFLICT_COLOR });
  const markerOpts = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...markerOpts });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, ...markerOpts });
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const pipeDimMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: DIM_OPACITY,
    depthWrite: false,
  });
  const flowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const gridMat = new THREE.LineBasicMaterial({ color: GRID_COLOR });
  const edgeMat = new THREE.LineBasicMaterial({ color: SITE_EDGE_COLOR });
  const dimMat = new THREE.LineBasicMaterial({ color: DIM_COLOR });
  const floorMat = new THREE.MeshBasicMaterial({
    color: SITE_FLOOR_COLOR,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const floorSeeThroughMat = new THREE.MeshBasicMaterial({
    color: SITE_FLOOR_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const tintMat = new THREE.MeshBasicMaterial({
    color: SELECT_TINT,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const lineMat = new THREE.LineBasicMaterial({ color: SELECT_LINE });
  const flowGeo = new THREE.ConeGeometry(FLOW_RADIUS, FLOW_LENGTH, 10);
  const ownedMaterials: THREE.Material[] = [
    conflictMat,
    discMat,
    ringMat,
    pipeMat,
    pipeDimMat,
    flowMat,
    gridMat,
    edgeMat,
    dimMat,
    floorMat,
    floorSeeThroughMat,
    tintMat,
    lineMat,
  ];
  const sharedGeometries = [boxGeo, discGeo, ringGeo, thinRingGeo, pipeGeo, jointGeo, flowGeo];

  const simpleProvider = createSimpleProvider();
  let detailedProvider: MaterialProvider | null = null;
  let detailedLoad: Promise<MaterialProvider> | null = null;
  let provider: MaterialProvider = simpleProvider;
  let modeRequest = 0;

  let model: SceneModel | null = null;
  /** Points `fit` frames (see `scenePoints`), computed once per scene. */
  let points: THREE.Vector3[] = scenePoints(null);
  let batches: VoxelBatch[] = [];
  /** Pipe meshes and the net id of each instance, for picking. */
  let pipeBatches: { mesh: THREE.InstancedMesh; netIds: number[]; dim: boolean }[] = [];
  /** Flow arrows: one instance per directed step, moved every frame while animating. */
  /** The floor's meshes, kept across rebuilds (see `buildFloor`). */
  let floorCache: {
    key: string;
    group: THREE.Group;
    geometries: THREE.BufferGeometry[];
    materials: THREE.Material[];
  } | null = null;
  let flows: {
    mesh: THREE.InstancedMesh;
    steps: { a: THREE.Vector3; d: THREE.Vector3; q: THREE.Quaternion }[];
  } | null = null;
  let flowOn = true;
  const clock = typeof performance === 'undefined' ? () => Date.now() : () => performance.now();
  let selected = new Set<number>();
  let marked: readonly Vec3[] = [];
  let xray = false;
  const xrayMaterials = new Map<string, THREE.Material>();
  let fittedBoundsKey = '';
  let autoFit = true;
  let disposed = false;
  let frame = 0;
  let reportedTheta = NaN;
  let width = 0;
  let height = 0;
  let inset = { left: 0, right: 0, bottom: 0, top: 0 };
  let dragEnabled = false;
  /** A drag of the selection: the ground plane at the grabbed height, where it was grabbed, the offset. */
  let drag: { plane: THREE.Plane; start: THREE.Vector3; dx: number; dz: number } | null = null;

  const controls = new OrbitControls(canvas, camera, {
    onChange: requestRender,
    onClick: pick,
    onPressStart: startDrag,
    onDrag: moveDrag,
    onDragEnd: endDrag,
  });
  const stopAutoFit = (): void => {
    autoFit = false;
  };
  canvas.addEventListener('pointerdown', stopAutoFit);
  canvas.addEventListener('wheel', stopAutoFit, { passive: true });

  // Rendering is on demand, so a restored context needs one explicit redraw.
  const onContextLost = (e: Event): void => e.preventDefault(); // lets the browser restore the context
  const onContextRestored = (): void => requestRender();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize());
  resizeObserver?.observe(canvas);

  // ---------------------------------------------------------------- frame

  function requestRender(): void {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
      // Flow arrows keep moving: draw again next frame while they are shown and the page is visible.
      if (flows && flowOn && !(typeof document !== 'undefined' && document.hidden)) requestRender();
    });
  }

  /** Camera and view the labels were last laid out for. */
  let labelView = '';

  /**
   * Hides labels that would cover a more important one on screen: dimensions first, then group names
   * (in scene order), then ports. Runs again whenever the camera or the view size changes, so zooming in
   * brings back the labels that have room.
   */
  function declutterLabels(): void {
    const sprites = content.children.filter(
      (c): c is THREE.Sprite => c instanceof THREE.Sprite && !!c.userData.label,
    );
    const view = `${camera.matrixWorld.elements.join(',')}|${width}|${height}|${sprites.length}`;
    if (view === labelView || width === 0 || height === 0) return;
    labelView = view;
    const kept: [number, number, number, number][] = [];
    const v = new THREE.Vector3();
    const order = sprites
      .map((sp, i) => ({ sp, i, pr: (sp.userData.label as { priority?: number }).priority ?? 0 }))
      .sort((a, b) => b.pr - a.pr || a.i - b.i);
    for (const { sp } of order) {
      const label = sp.userData.label as { cssH: number; aspect: number };
      v.copy(sp.position).project(camera);
      if (v.z < -1 || v.z > 1) {
        sp.visible = false;
        continue;
      }
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      // The text box, without most of the transparent margin around it.
      const hw = (label.cssH * label.aspect) / 2 - 4;
      const hh = label.cssH * 0.34;
      const box: [number, number, number, number] = [x - hw, y - hh, x + hw, y + hh];
      sp.visible = !kept.some((k) => box[0] < k[2] && box[2] > k[0] && box[1] < k[3] && box[3] > k[1]);
      if (sp.visible) kept.push(box);
    }
  }

  function updateFlows(): void {
    if (!flows) return;
    const t = flowOn ? ((clock() / 1000) * FLOW_SPEED) % 1 : 0.5;
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    flows.steps.forEach((s, i) => {
      p.copy(s.a).addScaledVector(s.d, t);
      flows!.mesh.setMatrixAt(i, m.compose(p, s.q, one));
    });
    flows.mesh.instanceMatrix.needsUpdate = true;
  }

  function draw(): void {
    if (disposed) return;
    updateFlows();
    gl.info.reset();
    camera.updateMatrixWorld();
    declutterLabels();
    // Light follows the camera a little (from its upper right) so the visible faces stay readable.
    const offset = camera.position.clone().sub(controls.target);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    sun.position
      .copy(controls.target)
      .add(offset)
      .addScaledVector(right, offset.length() * 0.6);
    sun.position.y += offset.length() * 0.8;
    sun.target.position.copy(controls.target);

    gl.setViewport(0, 0, width, height);
    gl.clear();
    gl.render(scene, camera);

    gizmoCamera.quaternion.copy(camera.quaternion);
    gizmoCamera.position.set(0, 0, 4).applyQuaternion(camera.quaternion);
    gl.clearDepth();
    gl.setViewport(GIZMO_MARGIN_PX + inset.left, GIZMO_MARGIN_PX, GIZMO_PX, GIZMO_PX);
    gl.render(gizmo, gizmoCamera);
    gl.setViewport(0, 0, width, height);

    if (options.onView && controls.theta !== reportedTheta) {
      reportedTheta = controls.theta;
      options.onView(reportedTheta);
    }
  }

  function resize(): void {
    if (disposed) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0 || (w === width && h === height)) return;
    width = w;
    height = h;
    gl.setSize(w, h, false);
    camera.aspect = w / h;
    applyInset();
    for (const child of content.children) if (child instanceof THREE.Sprite) sizeLabel(child, h, camera.fov);
    if (autoFit && model) fit(false);
    requestRender();
  }

  // ---------------------------------------------------------------- camera

  /** The corners of every occupied cell (voxels and pipe cells) that can affect the fit. */
  function scenePoints(m: SceneModel | null): THREE.Vector3[] {
    function* cells(): Generator<Vec3> {
      if (m?.site) {
        yield [0, 0, 0];
        yield [m.site.size[0] - 1, 0, m.site.size[1] - 1];
      }
      // One more block south and east of the dimensioned area keeps its lines in view.
      if (m?.dimensions) {
        const { max, y } = m.dimensions;
        const more = Math.ceil(DIM_GAP);
        yield [Math.ceil(max[0]) - 1 + more, Math.floor(y), Math.ceil(max[1]) - 1 + more];
      }
      for (const v of m?.voxels ?? []) yield v.pos;
      for (const net of m?.pipes ?? []) for (const path of net.paths) yield* path;
    }
    const out = fitPoints(cells());
    return out.length > 0 ? out : fitPoints([[0, 0, 0]]);
  }

  /** Field of view and aspect of the part of the canvas an open outline, drawer or sheet leaves free. */
  function visibleView(): { fov: number; aspect: number } {
    if (width === 0 || height === 0) return { fov: camera.fov, aspect: camera.aspect };
    const w = Math.max(1, width - inset.left - inset.right);
    const h = Math.max(1, height - inset.top - inset.bottom);
    const half = THREE.MathUtils.degToRad(camera.fov) / 2;
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) * (h / height)));
    return { fov, aspect: w / h };
  }

  /** Aim the camera at the whole scene. `keepAngles` keeps the user's rotation. */
  function fit(keepAngles: boolean): void {
    const r = Math.max(1, new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length() / 2);
    const theta = keepAngles ? controls.theta : DEFAULT_THETA;
    const phi = keepAngles ? controls.phi : DEFAULT_PHI;
    const view = visibleView();
    const { target, distance: dist } = fitView(points, theta, phi, view.fov, view.aspect);
    // Zoom range is 0.05x .. 8x the fitted distance (see OrbitControls.setHome).
    camera.near = Math.max(0.05, Math.min(r * 0.01, dist * 0.02));
    camera.far = dist * 10 + r * 4;
    camera.updateProjectionMatrix();
    controls.setHome(target, dist, keepAngles);
    controls.reset();
  }

  // ---------------------------------------------------------------- scene building

  function clearContent(): void {
    for (const child of [...content.children]) {
      content.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.Sprite) {
        child.material.map?.dispose();
        child.material.dispose();
      } else if (child instanceof THREE.LineSegments || child instanceof THREE.Mesh) child.geometry.dispose();
    }
    batches = [];
    pipeBatches = [];
    flows = null;
    for (const m of xrayMaterials.values()) m.dispose();
    xrayMaterials.clear();
  }

  function xrayMaterial(base: THREE.Material, opacity: number): THREE.Material {
    const k = `${base.uuid}|${opacity}`;
    let m = xrayMaterials.get(k);
    if (!m) {
      m = base.clone();
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
      xrayMaterials.set(k, m);
    }
    return m;
  }

  /** X-ray fades the casings; controllers, hatches and conflicts stay solid so they can be found. */
  function isFaded(b: { conflict: boolean; kind: string }): boolean {
    return xray && !(b.conflict || b.kind === 'hatch' || b.kind === 'controller');
  }

  function applyXray(): void {
    for (const b of batches) {
      if (!isFaded(b)) {
        b.mesh.material = b.baseMaterials;
        b.mesh.renderOrder = 0;
        continue;
      }
      const base = b.baseMaterials;
      b.mesh.material = Array.isArray(base)
        ? base.map((m) => xrayMaterial(m, CASING_XRAY_OPACITY))
        : xrayMaterial(base, CASING_XRAY_OPACITY);
      b.mesh.renderOrder = 1;
    }
  }

  function buildVoxels(m: SceneModel): void {
    const groups = new Map<string, number[]>();
    m.voxels.forEach((v, i) => {
      const k = visualKey(v);
      const list = groups.get(k);
      if (list) list.push(i);
      else groups.set(k, [i]);
    });
    const matrix = new THREE.Matrix4();
    for (const indices of groups.values()) {
      const first = m.voxels[indices[0]];
      const visual: BlockVisual = {
        blockId: first.blockId,
        kind: first.kind,
        facing: first.facing,
        hatchKind: first.hatchKind,
        baseBlockId: first.baseBlockId,
      };
      const conflict = !!first.conflict;
      const faces = conflict ? [conflictMat] : provider.materials(visual, m.colors);
      const baseMaterials = faces.every((f) => f === faces[0]) ? faces[0] : faces;
      const mesh = new THREE.InstancedMesh(boxGeo, baseMaterials, indices.length);
      indices.forEach((vi, n) => {
        const p = m.voxels[vi].pos;
        mesh.setMatrixAt(n, matrix.makeTranslation(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
      const glass = [baseMaterials].flat().some((m) => m.transparent);
      batches.push({ mesh, indices, kind: first.kind, conflict, baseMaterials, glass });
    }
  }

  /**
   * A white ring with a disc in the hatch colour on each hatch's outward face. In DETAILED view a machine's
   * hatches show their own textured front (framed in the kind colour), so they only get a thin ring in that
   * colour, which stays visible around an attached pipe; site markers (resource colours) keep the disc.
   */
  function buildHatchMarkers(m: SceneModel): void {
    const marks =
      m.markers ??
      m.voxels
        .filter((v) => v.kind === 'hatch' && v.facing)
        .map((v) => ({
          pos: v.pos,
          face: v.facing!,
          color: v.hatchKind ? m.colors[v.hatchKind] : '#ffffff',
        }));
    if (marks.length === 0) return;
    const ringOnly = !m.markers && provider.mode === 'detailed';
    const rings = new THREE.InstancedMesh(ringOnly ? thinRingGeo : ringGeo, ringMat, marks.length);
    if (ringOnly) {
      const matrix = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      const color = new THREE.Color();
      marks.forEach((v, i) => {
        const n = dirVector(v.face);
        q.setFromUnitVectors(Z_AXIS, n);
        rings.setMatrixAt(i, matrix.compose(center(v.pos).addScaledVector(n, 0.502), q, one));
        rings.setColorAt(i, color.set(v.color));
      });
      rings.instanceMatrix.needsUpdate = true;
      if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      rings.computeBoundingSphere();
      content.add(rings);
      return;
    }
    const discs = new THREE.InstancedMesh(discGeo, discMat, marks.length);
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const color = new THREE.Color();
    marks.forEach((v, i) => {
      const n = dirVector(v.face);
      q.setFromUnitVectors(Z_AXIS, n);
      matrix.compose(center(v.pos).addScaledVector(n, 0.502), q, one);
      discs.setMatrixAt(i, matrix);
      rings.setMatrixAt(i, matrix);
      discs.setColorAt(i, color.set(v.color));
    });
    for (const mesh of [discs, rings]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
    }
    if (discs.instanceColor) discs.instanceColor.needsUpdate = true;
  }

  /**
   * Pipes as square beams through cell centres, like GT pipes. Straight runs are merged into one beam; each
   * beam reaches half a pipe width past its end cells, so bends and junctions close into solid corners.
   * A path of a single cell is a cube. Cables (energy, dynamo) use the same shapes, thinner.
   */
  function buildPipes(m: SceneModel): void {
    if (!m.pipes || m.pipes.length === 0) return;
    /** `w`: section scale relative to `PIPE_WIDTH`. */
    const segments: {
      a: THREE.Vector3;
      b: THREE.Vector3;
      color: string;
      w: number;
      net: number;
      dim: boolean;
    }[] = [];
    const cubes: { p: THREE.Vector3; color: string; w: number; net: number; dim: boolean }[] = [];
    const steps: { a: THREE.Vector3; d: THREE.Vector3; q: THREE.Quaternion; color: string }[] = [];
    const junctions = m.junctions ?? [];
    const joinCells = new Set(junctions.map((j) => key(j.cell)));
    const joinHatches = new Set(junctions.map((j) => key(j.hatch)));
    /** Beams that end at a junction stop at the face of its cube (a hair inside, so no gap shows). */
    const junctionReach = (): number => -(JUNCTION_WIDTH / 2) + 0.005;
    m.pipes.forEach((net, ni) => {
      const color = net.color ?? m.colors[net.kind];
      const netId = net.id ?? -1 - ni;
      const dim = !!net.dim;
      const w = isCable(net.kind) ? CABLE_WIDTH / PIPE_WIDTH : 1;
      const half = (PIPE_WIDTH * w) / 2;
      /** A beam from `a` to `b`, lengthened by `extA` / `extB` beyond them. */
      const beam = (a: THREE.Vector3, b: THREE.Vector3, extA: number, extB: number): void => {
        const dir = new THREE.Vector3().subVectors(b, a).normalize();
        segments.push({
          a: a.clone().addScaledVector(dir, -extA),
          b: b.clone().addScaledVector(dir, extB),
          color,
          w,
          net: netId,
          dim,
        });
      };
      const cells = new Set<string>();
      for (const path of net.paths) {
        path.forEach((p) => cells.add(key(p)));
        const pts = path.map(center);
        const joined = (p: Vec3): boolean => joinCells.has(key(p));
        if (pts.length === 1 && !joined(path[0])) cubes.push({ p: pts[0], color, w, net: netId, dim });
        let start = 0;
        for (let i = 1; i < pts.length; i++) {
          const last = i === pts.length - 1;
          const bend =
            !last &&
            new THREE.Vector3()
              .subVectors(pts[i], pts[i - 1])
              .normalize()
              .distanceTo(new THREE.Vector3().subVectors(pts[i + 1], pts[i]).normalize()) > 1e-6;
          if (last || bend) {
            beam(
              pts[start],
              pts[i],
              joined(path[start]) ? junctionReach() : half,
              joined(path[i]) ? junctionReach() : half,
            );
            start = i;
          }
        }
      }
      // Stubs from each hatch face to the pipe cell in front of it (starting at the face, not inside it).
      for (const h of m.hatches) {
        if (h.net !== undefined && net.id !== undefined ? h.net !== net.id : h.kind !== net.kind) continue;
        const v = dirVec(h.face);
        const front: Vec3 = [h.cell[0] + v[0], h.cell[1] + v[1], h.cell[2] + v[2]];
        if (!cells.has(key(front)) || (joinCells.has(key(front)) && joinHatches.has(key(h.cell)))) continue;
        beam(center(h.cell).addScaledVector(dirVector(h.face), 0.5), center(front), 0, half);
      }
      if (!dim)
        for (const [a, b] of net.flows ?? []) {
          const pa = center(a);
          const d = center(b).sub(pa);
          steps.push({
            a: pa,
            d,
            q: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.clone().normalize()),
            color,
          });
        }
    });
    // One neutral block where the nets of a multi-item hatch merge, and one stub from it to the hatch face.
    for (const j of junctions) {
      const p = center(j.cell);
      cubes.push({ p, color: JUNCTION_COLOR, w: JUNCTION_WIDTH / PIPE_WIDTH, net: -1, dim: !!j.dim });
      segments.push({
        a: center(j.hatch).addScaledVector(dirVector(j.face), 0.5),
        b: p.clone().addScaledVector(dirVector(j.face), JUNCTION_WIDTH / 2 - 0.005),
        color: JUNCTION_COLOR,
        w: 1,
        net: -1,
        dim: !!j.dim,
      });
    }
    const matrix = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    for (const dim of [false, true]) {
      const list = segments.filter((s) => s.dim === dim);
      if (list.length === 0) continue;
      const beams = new THREE.InstancedMesh(pipeGeo, dim ? pipeDimMat : pipeMat, list.length);
      list.forEach((s, i) => {
        const d = new THREE.Vector3().subVectors(s.b, s.a);
        const len = d.length();
        // Beams are axis-aligned, so turning +Y onto the run keeps the square section axis-aligned too.
        q.setFromUnitVectors(Y_AXIS, len > 0 ? d.divideScalar(len) : Y_AXIS);
        matrix.compose(
          new THREE.Vector3().addVectors(s.a, s.b).multiplyScalar(0.5),
          q,
          scale.set(s.w, len, s.w),
        );
        beams.setMatrixAt(i, matrix);
        beams.setColorAt(i, color.set(s.color));
      });
      beams.instanceMatrix.needsUpdate = true;
      if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
      beams.computeBoundingSphere();
      if (dim) beams.renderOrder = 1;
      content.add(beams);
      pipeBatches.push({ mesh: beams, netIds: list.map((s) => s.net), dim });
    }
    for (const dim of [false, true]) {
      const list = cubes.filter((c) => c.dim === dim);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(jointGeo, dim ? pipeDimMat : pipeMat, list.length);
      list.forEach((c, i) => {
        mesh.setMatrixAt(i, matrix.makeScale(c.w, c.w, c.w).setPosition(c.p.x, c.p.y, c.p.z));
        mesh.setColorAt(i, color.set(c.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (dim) mesh.renderOrder = 1;
      content.add(mesh);
      pipeBatches.push({ mesh, netIds: list.map((c) => c.net), dim });
    }
    if (steps.length > 0) {
      const mesh = new THREE.InstancedMesh(flowGeo, flowMat, steps.length);
      steps.forEach((st, i) => {
        // A lighter shade of the pipe colour reads as "something moving inside".
        mesh.setColorAt(i, color.set(st.color).lerp(new THREE.Color('#ffffff'), 0.55));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      content.add(mesh);
      flows = { mesh, steps };
      updateFlows();
    }
  }

  /** Whether any pipe or cable runs below the ground (y < 0). */
  function hasTrench(m: SceneModel): boolean {
    return (m.pipes ?? []).some((n) => n.paths.some((path) => path.some((c) => c[1] < 0)));
  }

  /**
   * The site's ground: a light floor (a plane; a floor of blocks replaces it, see `buildFloor`), a faint block
   * grid and a darker outline (above the floor blocks, on y = 0).
   */
  function buildSite(m: SceneModel): void {
    if (!m.site) return;
    const [w, d] = m.site.size;
    if (!m.floor) {
      // Pipes in a trench under the ground show through a see-through floor.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        hasTrench(m) ? floorSeeThroughMat : floorMat,
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(w / 2, 0, d / 2);
      content.add(floor);
    }
    const y = 0.003;
    const grid: number[] = [];
    for (let x = 1; x < w; x++) grid.push(x, y, 0, x, y, d);
    for (let z = 1; z < d; z++) grid.push(0, y, z, w, y, z);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
    content.add(new THREE.LineSegments(gridGeo, gridMat));
    const edge = [0, y, 0, w, y, 0, w, y, 0, w, y, d, w, y, d, 0, y, d, 0, y, d, 0, y, 0];
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    content.add(new THREE.LineSegments(edgeGeo, edgeMat));
  }

  /**
   * The floor layer of a site: the top face of every block and the four outer sides of the slab, none at the
   * holes pipes and cables make (the faces inside are never seen). It is not pickable (it is not in `batches`),
   * turns see-through when something runs under it, and is kept between rebuilds while its inputs stay the same.
   */
  function buildFloor(m: SceneModel): void {
    const f = m.floor;
    if (!f) return;
    const [w, d] = f.size;
    const see = hasTrench(m);
    const k = `${f.blockId}|${w}|${d}|${see ? 1 : 0}|${provider.mode}|${f.holes.join(';')}`;
    if (floorCache?.key !== k) {
      disposeFloor();
      floorCache = { key: k, ...makeFloor(m, f, see) };
    }
    content.add(floorCache.group);
  }

  function makeFloor(
    m: SceneModel,
    f: NonNullable<SceneModel['floor']>,
    see: boolean,
  ): { group: THREE.Group; geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } {
    const [w, d] = f.size;
    const hole = new Set<number>();
    for (const [x, z] of f.holes) if (x >= 0 && x < w && z >= 0 && z < d) hole.add(x + w * z);
    const faces = provider.materials({ blockId: f.blockId, kind: 'casing' }, m.colors);
    // Own copies: the floor sits just behind the grid lines, and may be see-through, unlike the voxels.
    const own = (face: THREE.Material): THREE.Material => {
      const c = face.clone();
      c.polygonOffset = true;
      c.polygonOffsetFactor = 2;
      c.polygonOffsetUnits = 2;
      if (see) {
        c.transparent = true;
        c.opacity = FLOOR_SEE_THROUGH_OPACITY;
        c.depthWrite = false;
      }
      return c;
    };
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z.
    const topMat = own(faces[2] ?? faces[0]);
    const sideMat = own(faces[4] ?? faces[0]);
    const top = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const side = new THREE.PlaneGeometry(1, 1);
    const tops = new THREE.InstancedMesh(top, topMat, w * d - hole.size);
    const matrix = new THREE.Matrix4();
    let n = 0;
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++)
        if (!hole.has(x + w * z) && n < tops.instanceMatrix.count)
          tops.setMatrixAt(n++, matrix.makeTranslation(x + 0.5, f.y + 1, z + 0.5));
    tops.count = n;
    tops.instanceMatrix.needsUpdate = true;
    tops.computeBoundingSphere();
    // Sides of the edge blocks facing outwards: the plane faces +z, turned about Y to the side it is on.
    const edges: { x: number; z: number; turn: number; at: [number, number] }[] = [];
    for (let x = 0; x < w; x++) {
      edges.push({ x, z: 0, turn: Math.PI, at: [x + 0.5, 0] });
      edges.push({ x, z: d - 1, turn: 0, at: [x + 0.5, d] });
    }
    for (let z = 0; z < d; z++) {
      edges.push({ x: 0, z, turn: -Math.PI / 2, at: [0, z + 0.5] });
      edges.push({ x: w - 1, z, turn: Math.PI / 2, at: [w, z + 0.5] });
    }
    const shown = edges.filter((e) => !hole.has(e.x + w * e.z));
    const sides = new THREE.InstancedMesh(side, sideMat, shown.length);
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    shown.forEach((e, i) =>
      sides.setMatrixAt(
        i,
        matrix.compose(
          new THREE.Vector3(e.at[0], f.y + 0.5, e.at[1]),
          q.setFromAxisAngle(Y_AXIS, e.turn),
          one,
        ),
      ),
    );
    sides.instanceMatrix.needsUpdate = true;
    sides.computeBoundingSphere();
    const group = new THREE.Group();
    group.add(tops, sides);
    return { group, geometries: [top, side], materials: [topMat, sideMat] };
  }

  function disposeFloor(): void {
    if (!floorCache) return;
    for (const mesh of floorCache.group.children) if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    for (const g of floorCache.geometries) g.dispose();
    for (const mat of floorCache.materials) mat.dispose();
    floorCache = null;
  }

  /**
   * Grey dimension lines beside the south edge (width, along X) and the east edge (depth, along Z), the
   * sides the default camera looks at, each with end ticks and its label in the middle.
   */
  function buildDimensions(m: SceneModel): void {
    if (!m.dimensions) return;
    const { min, max, labels } = m.dimensions;
    const [widthText, depthText] = labels;
    const [x0, z0] = min;
    const [x1, z1] = max;
    const y = m.dimensions.y + 0.003;
    const g = DIM_GAP;
    const tick = 0.35;
    const zs = z1 + g;
    const xe = x1 + g;
    // prettier-ignore
    const lines = [
      x0, y, zs, x1, y, zs,
      x0, y, z1 + 0.15, x0, y, zs + tick,
      x1, y, z1 + 0.15, x1, y, zs + tick,
      xe, y, z0, xe, y, z1,
      x1 + 0.15, y, z0, xe + tick, y, z0,
      x1 + 0.15, y, z1, xe + tick, y, z1,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    content.add(new THREE.LineSegments(geo, dimMat));
    // Coloured like the gizmo axis they measure.
    const widthLabel = textSprite(widthText, undefined, false, AXIS_COLORS.x);
    widthLabel.position.set((x0 + x1) / 2, y, zs);
    const depthLabel = textSprite(depthText, undefined, false, AXIS_COLORS.z);
    depthLabel.position.set(xe, y, (z0 + z1) / 2);
    for (const l of [widthLabel, depthLabel]) {
      sizeLabel(l, height, camera.fov);
      l.userData.label.priority = 2;
    }
    content.add(widthLabel, depthLabel);
  }

  function buildLabels(m: SceneModel): void {
    for (const l of m.labels ?? []) {
      const sprite = textSprite(l.text, l.color, !!l.small);
      sprite.position.set(l.pos[0], l.pos[1], l.pos[2]);
      sizeLabel(sprite, height, camera.fov);
      // Group names before port names.
      sprite.userData.label.priority = l.small ? 0 : 1;
      content.add(sprite);
    }
  }

  function rebuild(): void {
    labelView = '';
    clearContent();
    if (!model?.floor) disposeFloor();
    if (model) {
      buildSite(model);
      buildFloor(model);
      buildDimensions(model);
      buildVoxels(model);
      buildHatchMarkers(model);
      buildPipes(model);
      buildLabels(model);
    }
    applyXray();
    rebuildSelection();
    rebuildMarks();
    requestRender();
  }

  function rebuildSelection(): void {
    disposeSelection();
    selection.position.set(0, 0, 0);
    marks.position.set(0, 0, 0);
    if (!model || selected.size === 0) return;
    const voxels = model.voxels.filter((v) => v.unitIds.some((id) => selected.has(id)));
    if (voxels.length === 0) return;

    const tint = new THREE.InstancedMesh(boxGeo, tintMat, voxels.length);
    const matrix = new THREE.Matrix4();
    const s = new THREE.Vector3(1.03, 1.03, 1.03);
    const q = new THREE.Quaternion();
    voxels.forEach((v, i) => tint.setMatrixAt(i, matrix.compose(center(v.pos), q, s)));
    tint.instanceMatrix.needsUpdate = true;
    tint.computeBoundingSphere();
    tint.renderOrder = 2;

    // One outline box per selected unit around its cells.
    const boxes = new Map<number, THREE.Box3>();
    for (const v of voxels)
      for (const id of v.unitIds) {
        if (!selected.has(id)) continue;
        let b = boxes.get(id);
        if (!b) boxes.set(id, (b = new THREE.Box3()));
        b.expandByPoint(new THREE.Vector3(...v.pos)).expandByPoint(center(v.pos).addScalar(0.5));
      }
    for (const box of boxes.values()) box.expandByScalar(0.035);
    const positions = boxEdges([...boxes.values()]);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.renderOrder = 3;
    selection.add(tint, lines);
  }

  function disposeGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.LineSegments) child.geometry.dispose();
    }
  }
  const disposeSelection = (): void => disposeGroup(selection);

  /** A tint and an outline, a little bigger than the cell, around each marked cell (the selected hatch). */
  function rebuildMarks(): void {
    disposeGroup(marks);
    if (marked.length === 0) return;
    const tint = new THREE.InstancedMesh(boxGeo, tintMat, marked.length);
    const matrix = new THREE.Matrix4();
    const size = new THREE.Vector3(1.1, 1.1, 1.1);
    const q = new THREE.Quaternion();
    marked.forEach((c, i) => tint.setMatrixAt(i, matrix.compose(center(c), q, size)));
    tint.instanceMatrix.needsUpdate = true;
    tint.computeBoundingSphere();
    tint.renderOrder = 2;
    const boxes = marked.map((c) =>
      new THREE.Box3(new THREE.Vector3(...c), center(c).addScalar(0.5)).expandByScalar(0.06),
    );
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(boxEdges(boxes), 3));
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.renderOrder = 3;
    marks.add(tint, lines);
  }

  // ---------------------------------------------------------------- picking

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /** Aim the ray through the pointer; false when the canvas has no size. */
  function aim(e: PointerEvent): boolean {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return true;
  }

  interface Found {
    hit: THREE.Intersection;
    pipes?: (typeof pipeBatches)[number];
    voxels?: (typeof batches)[number];
  }

  /** What the (already aimed) ray hits: the nearest solid thing, else the nearest faded one. */
  function hitsUnderPointer(): Found | undefined {
    const hits: (Found & PickHit)[] = [];
    for (const hit of raycaster.intersectObjects(
      [...batches.map((b) => b.mesh), ...pipeBatches.map((b) => b.mesh)],
      false,
    )) {
      if (hit.instanceId === undefined) continue;
      const pipes = pipeBatches.find((b) => b.mesh === hit.object);
      if (pipes) {
        hits.push({ hit, pipes, translucent: pipes.dim });
        continue;
      }
      const voxels = batches.find((b) => b.mesh === hit.object);
      if (voxels) hits.push({ hit, voxels, translucent: voxels.glass || isFaded(voxels) });
    }
    return choosePick(hits);
  }

  function startDrag(e: PointerEvent): boolean {
    if (!dragEnabled || !options.onMoveSelection || !model || selected.size === 0 || !aim(e)) return false;
    const found = hitsUnderPointer();
    const hit = found?.hit;
    const batch = found?.voxels;
    if (!hit || !batch) return false;
    const voxel = model.voxels[batch.indices[hit.instanceId!]];
    if (!voxel.unitIds.some((id) => selected.has(id))) return false;
    const plane = new THREE.Plane(Y_AXIS, -hit.point.y);
    drag = { plane, start: hit.point.clone(), dx: 0, dz: 0 };
    canvas.style.cursor = 'grabbing';
    window.addEventListener('keydown', onDragKey, true);
    return true;
  }

  function moveDrag(e: PointerEvent): void {
    if (!drag || !aim(e)) return;
    const p = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!p) return;
    const dx = Math.round(p.x - drag.start.x);
    const dz = Math.round(p.z - drag.start.z);
    if (dx === drag.dx && dz === drag.dz) return;
    drag.dx = dx;
    drag.dz = dz;
    selection.position.set(dx, 0, dz);
    marks.position.set(dx, 0, dz);
    options.onDragOffset?.([dx, dz]);
    requestRender();
  }

  function endDrag(e: PointerEvent | null, cancelled: boolean): void {
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    window.removeEventListener('keydown', onDragKey, true);
    options.onDragOffset?.(null);
    if (!d) return;
    if (cancelled || (d.dx === 0 && d.dz === 0)) {
      selection.position.set(0, 0, 0);
      marks.position.set(0, 0, 0);
      requestRender();
      // A press on the selection that did not move is a click.
      if (!cancelled && e) pick(e);
      return;
    }
    options.onMoveSelection?.(d.dx, d.dz);
  }

  /** Escape during a drag puts the selection back. */
  function onDragKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    controls.cancelDrag();
  }

  function applyInset(): void {
    // Shift the view window so the scene centres in the uncovered part of the canvas.
    if (inset.left > 0 || inset.right > 0 || inset.bottom > 0 || inset.top > 0)
      camera.setViewOffset(
        width,
        height,
        (inset.right - inset.left) / 2,
        (inset.bottom - inset.top) / 2,
        width,
        height,
      );
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function pick(e: PointerEvent): void {
    if (!options.onPick || !model) return;
    if (!aim(e)) return;
    const found = hitsUnderPointer();
    if (found?.pipes) {
      const id = found.pipes.netIds[found.hit.instanceId!];
      options.onPick([]);
      options.onPickNet?.(id >= 0 ? id : null);
      options.onPickHatch?.(null);
      return;
    }
    if (found?.voxels) {
      const voxel = model.voxels[found.voxels.indices[found.hit.instanceId!]];
      options.onPick([...voxel.unitIds]);
      options.onPickNet?.(null);
      options.onPickHatch?.(voxel.kind === 'hatch' ? voxel.pos : null);
      return;
    }
    options.onPick([]);
    options.onPickNet?.(null);
    options.onPickHatch?.(null);
  }

  // ---------------------------------------------------------------- public API

  const api: Renderer & RendererDebug = {
    get viewMode() {
      return provider.mode;
    },

    setScene(next) {
      if (disposed) return;
      model = next;
      points = scenePoints(next);
      rebuild();
      const box = new THREE.Box3().setFromPoints(points);
      const boundsKey = `${box.min.toArray()}|${box.max.toArray()}`;
      if (boundsKey !== fittedBoundsKey) {
        const first = fittedBoundsKey === '';
        fittedBoundsKey = boundsKey;
        fit(!first && !autoFit);
      }
    },

    async setViewMode(mode) {
      const request = ++modeRequest;
      let next: MaterialProvider = simpleProvider;
      if (mode === 'detailed') {
        // One shared load, so quick toggles never create (and leak) a second provider.
        detailedLoad ??= (async () => {
          const mod = await import('./detailed');
          const p = mod.createDetailedProvider();
          try {
            await p.load();
          } catch (err) {
            p.dispose();
            throw err;
          }
          if (disposed) p.dispose();
          else detailedProvider = p;
          return p;
        })();
        try {
          next = await detailedLoad;
        } catch (err) {
          detailedLoad = null; // allow a retry later
          console.warn('DETAILED view is unavailable, falling back to SIMPLE.', err);
          next = simpleProvider;
          if (!disposed && request === modeRequest) options.onViewModeFallback?.();
        }
      }
      if (disposed || request !== modeRequest || next === provider) return;
      provider = next;
      rebuild();
    },

    setXray(on) {
      if (xray === on) return;
      xray = on;
      applyXray();
      requestRender();
    },

    setSelected(unitIds) {
      // The same selection again (e.g. a new build of the same group) keeps a dragged outline in place.
      if (unitIds.length === selected.size && unitIds.every((id) => selected.has(id))) return;
      selected = new Set(unitIds);
      rebuildSelection();
      requestRender();
    },

    setMarkedCells(cells) {
      if (cells.length === marked.length && cells.every((c, i) => c.every((n, a) => n === marked[i][a])))
        return;
      marked = cells.map((c) => [...c] as Vec3);
      rebuildMarks();
      requestRender();
    },

    setFlowAnimation(on) {
      if (flowOn === on) return;
      flowOn = on;
      requestRender();
    },

    resetView() {
      autoFit = true;
      fit(false);
    },

    resize,

    setDragEnabled(on) {
      dragEnabled = on;
      if (!on) controls.cancelDrag();
    },

    frameBox(min, max) {
      if (disposed) return;
      const pts = fitPoints([
        [min[0], min[1], min[2]],
        [max[0] - 1, max[1] - 1, max[2] - 1],
      ]);
      const view = visibleView();
      const { target, distance } = fitView(pts, controls.theta, controls.phi, view.fov, view.aspect, 0.35);
      autoFit = false;
      controls.target.copy(target);
      controls.radius = distance;
      controls.update();
    },

    setInset(left, right, bottom, top) {
      const next = {
        left: Math.max(0, Math.round(left)),
        right: Math.max(0, Math.round(right)),
        bottom: Math.max(0, Math.round(bottom)),
        top: Math.max(0, Math.round(top)),
      };
      if (
        next.left === inset.left &&
        next.right === inset.right &&
        next.bottom === inset.bottom &&
        next.top === inset.top
      )
        return;
      inset = next;
      if (width > 0 && height > 0) applyInset();
      labelView = '';
      requestRender();
    },

    benchmark(frames) {
      const theta = controls.theta;
      const pixel = new Uint8Array(4);
      const ctx = gl.getContext();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        controls.theta = theta + (i / Math.max(1, frames)) * Math.PI * 2;
        controls.update();
        draw();
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel);
      }
      const ms = (performance.now() - t0) / Math.max(1, frames);
      controls.theta = theta;
      controls.update();
      return ms;
    },

    setAngles(theta, phi) {
      autoFit = false;
      controls.theta = theta;
      controls.phi = phi;
      fit(true);
    },

    info() {
      return {
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        instances: batches.reduce((n, b) => n + b.indices.length, 0),
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver?.disconnect();
      window.removeEventListener('keydown', onDragKey, true);
      controls.dispose();
      canvas.removeEventListener('pointerdown', stopAutoFit);
      canvas.removeEventListener('wheel', stopAutoFit);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      clearContent();
      disposeSelection();
      disposeGroup(marks);
      disposeFloor();
      for (const g of sharedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      disposeObjectTree(gizmo);
      simpleProvider.dispose();
      detailedProvider?.dispose();
      gl.dispose();
    },
  };

  resize();
  requestRender();
  return api;
}
