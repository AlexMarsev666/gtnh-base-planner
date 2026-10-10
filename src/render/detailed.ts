import * as THREE from 'three';
import { blockInfo } from '../data/blocks';
import type { Dir } from '../model/core/types';
import type { HatchKind } from '../model/multiblock/types';
import { BOX_FACE_ORDER, type BlockVisual, type MaterialProvider } from './materials';
import textureManifest from './textures.json';

/**
 * UNIT 7 — DETAILED view: textured materials built from GT5-Unofficial PNGs
 * (`public/textures/atlas.png`, mapping in `src/render/textures.json`). Missing textures fall back to the flat colour.
 *
 * The atlas is decoded once into RGBA pixels; every distinct face (casing tile, casing + controller front,
 * casing + hatch overlays tinted with the hatch colour) is composited in JS into its own small
 * nearest-filtered `DataTexture`. Textures and materials are cached by composition key.
 */

/** `[x, y, width, height]` in atlas pixels, origin top-left. */
export type TileRect = readonly [number, number, number, number];

export interface BlockFaces {
  side?: string;
  top?: string;
  bottom?: string;
  /** Overlay drawn over `side` on the controller's facing side. */
  front?: string;
  /** No texture: DETAILED view uses the flat colour from blocks.ts. */
  flat?: boolean;
}

export interface TextureManifest {
  atlas: { path: string; width: number; height: number; tile: number };
  tiles: Record<string, TileRect>;
  blocks: Record<string, BlockFaces>;
  hatchOverlays: Partial<Record<HatchKind, string[]>>;
}

export const TEXTURES: TextureManifest = textureManifest as unknown as TextureManifest;

/** Decoded atlas (straight, non-premultiplied RGBA8, row 0 = top). */
export interface AtlasPixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface DetailedProviderOptions {
  /** Atlas loader; defaults to THREE.TextureLoader + canvas readback of `BASE_URL + textures/atlas.png`. */
  loadAtlas?: () => Promise<AtlasPixels>;
  manifest?: TextureManifest;
}

/** Straight-alpha "over" of `src` onto `dst` (both RGBA8, same size). */
function over(dst: Uint8Array, src: ArrayLike<number>): void {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3] / 255;
    if (sa === 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) {
      dst[i + c] = Math.round((src[i + c] * sa + dst[i + c] * da * (1 - sa)) / oa);
    }
    dst[i + 3] = Math.round(oa * 255);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  // THREE.Color stores linear values; the DataTexture is sRGB, so read the colour back in sRGB.
  const c = new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** Recolours an overlay with `rgb`, keeping its shading (luminance) and alpha. */
function tint(px: Uint8Array, rgb: [number, number, number]): Uint8Array {
  const out = new Uint8Array(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
    const k = 0.45 + 0.75 * lum;
    for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round(rgb[c] * k));
    out[i + 3] = px[i + 3];
  }
  return out;
}

/** One-pixel frame in the hatch colour so modes stay distinguishable at a glance. */
function frame(size: number, rgb: [number, number, number]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
      const o = (y * size + x) * 4;
      out.set([rgb[0], rgb[1], rgb[2], 255], o);
    }
  }
  return out;
}

/** A face to render: base tile plus overlays, or a flat colour. */
type FaceSpec =
  | { type: 'flat'; color: string }
  | { type: 'tiles'; base: string; front?: string; hatch?: { kind: HatchKind; color: string } };

function faceKey(spec: FaceSpec): string {
  if (spec.type === 'flat') return `flat:${spec.color}`;
  return `tiles:${spec.base}|${spec.front ?? ''}|${spec.hatch ? spec.hatch.kind + ':' + spec.hatch.color : ''}`;
}

async function loadAtlasFromUrl(url: string): Promise<AtlasPixels> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  try {
    const image = texture.image as CanvasImageSource & { width: number; height: number };
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data, width, height };
  } finally {
    texture.dispose();
  }
}

export function createDetailedProvider(options: DetailedProviderOptions = {}): MaterialProvider {
  const manifest = options.manifest ?? TEXTURES;
  const loadAtlas =
    options.loadAtlas ?? (() => loadAtlasFromUrl(import.meta.env.BASE_URL + manifest.atlas.path));
  let atlas: AtlasPixels | null = null;
  let loading: Promise<void> | null = null;
  const textures = new Map<string, THREE.DataTexture>();
  const faceMaterials = new Map<string, THREE.Material>();
  const visualMaterials = new Map<string, THREE.Material[]>();
  /** Hatch colours of the last `materials()` call; a changed colour evicts the faces tinted with the old one. */
  const hatchColors = new Map<HatchKind, string>();

  function evict(tag: string): void {
    for (const [k, m] of faceMaterials) {
      if (!k.endsWith(tag)) continue;
      m.dispose();
      textures.get(k)?.dispose();
      textures.delete(k);
      faceMaterials.delete(k);
    }
    for (const k of visualMaterials.keys()) if (k.includes(tag)) visualMaterials.delete(k);
  }

  /** Callers rebuild the whole scene with one colour per kind, so the old colour's faces are unused. */
  function syncHatchColors(colors: Record<HatchKind, string>): void {
    for (const kind of Object.keys(manifest.hatchOverlays) as HatchKind[]) {
      const next = colors[kind]?.toLowerCase();
      const prev = hatchColors.get(kind);
      if (prev !== undefined && prev !== next) evict(`|${kind}:${prev}`);
      if (next === undefined) hatchColors.delete(kind);
      else hatchColors.set(kind, next);
    }
  }

  function tilePixels(name: string): Uint8Array | null {
    const rect = manifest.tiles[name];
    if (!atlas || !rect) return null;
    const [x0, y0, w, h] = rect;
    if (x0 < 0 || y0 < 0 || x0 + w > atlas.width || y0 + h > atlas.height) return null;
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const start = ((y0 + y) * atlas.width + x0) * 4;
      out.set(atlas.data.subarray(start, start + w * 4), y * w * 4);
    }
    return out;
  }

  /** Composites a textured face; null if a tile is missing. */
  function composite(spec: Extract<FaceSpec, { type: 'tiles' }>): Uint8Array | null {
    const base = tilePixels(spec.base);
    if (!base) return null;
    const out = base.slice();
    if (spec.front) {
      const front = tilePixels(spec.front);
      if (front) over(out, front);
    }
    if (spec.hatch) {
      const rgb = hexToRgb(spec.hatch.color);
      over(out, frame(manifest.atlas.tile, rgb));
      const layers = manifest.hatchOverlays[spec.hatch.kind] ?? [];
      layers.forEach((name, i) => {
        const px = tilePixels(name);
        if (px) over(out, i === layers.length - 1 ? tint(px, rgb) : px);
      });
    }
    return out;
  }

  function makeTexture(px: Uint8Array, size: number): THREE.DataTexture {
    // DataTexture rows run bottom-up (v = 0 first); atlas rows run top-down.
    const flipped = new Uint8Array(px.length);
    const row = size * 4;
    for (let y = 0; y < size; y++) flipped.set(px.subarray(y * row, (y + 1) * row), (size - 1 - y) * row);
    const tex = new THREE.DataTexture(flipped, size, size, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function faceMaterial(spec: FaceSpec): THREE.Material {
    const key = faceKey(spec);
    const cached = faceMaterials.get(key);
    if (cached) return cached;
    let material: THREE.Material;
    const px = spec.type === 'tiles' ? composite(spec) : null;
    if (px) {
      const tex = makeTexture(px, manifest.atlas.tile);
      textures.set(key, tex);
      // Frames and grates are cut out (alpha 0 or 255); glass is see-through (mostly partial alpha), as the game
      // draws it in its translucent pass.
      let cutout = false;
      let partial = 0;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 255) cutout = true;
        if (px[i] > 0 && px[i] < 255) partial++;
      }
      material =
        partial * 4 > px.length / 4
          ? new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02 })
          : new THREE.MeshLambertMaterial({ map: tex, alphaTest: cutout ? 0.5 : 0 });
    } else {
      const color = spec.type === 'flat' ? spec.color : '#999999';
      material = new THREE.MeshLambertMaterial({ color });
    }
    faceMaterials.set(key, material);
    return material;
  }

  function faceSpec(visual: BlockVisual, dir: Dir, colors: Record<HatchKind, string>): FaceSpec {
    const hatchColor = visual.hatchKind ? colors[visual.hatchKind] : undefined;
    const isHatch = visual.kind === 'hatch' && visual.hatchKind !== undefined && hatchColor !== undefined;
    // A hatch looks like the casing it replaces, with its overlay on the front (as in game).
    const casing = isHatch && visual.baseBlockId ? manifest.blocks[visual.baseBlockId] : undefined;
    const faces =
      casing && !casing.flat && casing.side
        ? { ...casing, front: undefined }
        : manifest.blocks[visual.blockId];
    if (!atlas || !faces || faces.flat || !faces.side) {
      // Flat fallback: hatches take their kind colour (as in SIMPLE view).
      return { type: 'flat', color: isHatch ? hatchColor! : blockInfo(visual.blockId).color };
    }
    const base =
      dir === 'up' ? (faces.top ?? faces.side) : dir === 'down' ? (faces.bottom ?? faces.side) : faces.side;
    if (!manifest.tiles[base]) return { type: 'flat', color: blockInfo(visual.blockId).color };
    const facing = visual.facing === dir;
    return {
      type: 'tiles',
      base,
      front: facing && visual.kind === 'controller' ? faces.front : undefined,
      hatch: facing && isHatch ? { kind: visual.hatchKind!, color: hatchColor!.toLowerCase() } : undefined,
    };
  }

  return {
    mode: 'detailed',
    load() {
      loading ??= loadAtlas().then(
        (pixels) => {
          atlas = pixels;
        },
        (err: unknown) => {
          // Forget the failure so the next load() retries; the caller falls back to flat colours.
          loading = null;
          console.warn('DETAILED view: texture atlas failed to load', err);
          throw err;
        },
      );
      return loading;
    },
    materials(visual, colors) {
      syncHatchColors(colors);
      const specs = BOX_FACE_ORDER.map((dir) => faceSpec(visual, dir, colors));
      const key = specs.map(faceKey).join('/');
      let list = visualMaterials.get(key);
      if (!list) {
        list = specs.map(faceMaterial);
        visualMaterials.set(key, list);
      }
      return list;
    },
    dispose() {
      for (const m of faceMaterials.values()) m.dispose();
      for (const t of textures.values()) t.dispose();
      faceMaterials.clear();
      textures.clear();
      visualMaterials.clear();
    },
  };
}
