import { blockInfo } from '../data/blocks';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import type { TextureManifest } from '../render/detailed';
import textureManifest from '../render/textures.json';

const TEXTURES = textureManifest as unknown as TextureManifest;

const ALL_KINDS: HatchKind[] = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'energy',
  'dynamo',
  'maintenance',
  'muffler',
  'steamIn',
  'dataAccess',
];

/** The block id used by most structure cells (used as the picker tile colour). */
export function dominantBlockId(def: MultiblockDef): string {
  const counts = new Map<string, number>();
  for (const layer of def.layers) {
    for (const row of layer) {
      for (const ch of row) {
        const entry = def.legend[ch];
        if (entry) counts.set(entry.blockId, (counts.get(entry.blockId) ?? 0) + 1);
      }
    }
  }
  let best = def.controller.blockId;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN || (n === bestN && id < best)) {
      best = id;
      bestN = n;
    }
  }
  return best;
}

/** Hatch kinds a multiblock can take, in a stable order. */
export function hatchKindsOf(def: MultiblockDef): HatchKind[] {
  const present = new Set<HatchKind>();
  for (const entry of Object.values(def.legend)) for (const k of entry.hatches ?? []) present.add(k);
  return ALL_KINDS.filter((k) => present.has(k));
}

/** Multiply an `#rrggbb` colour's channels by `factor` (0..2), clamped. */
export function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.min(255, Math.max(0, Math.round(c * factor))),
  );
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** One face of the picker icon: atlas tiles (drawn in order) and the flat fallback colour. */
export interface IconFace {
  tiles: string[];
  color: string;
}

export interface IconFaces {
  top: IconFace;
  /** Shows the controller front, as in game. */
  left: IconFace;
  right: IconFace;
}

/**
 * The three faces of an icon cube made of one block, with `front` tiles drawn over the left side. Tiles missing
 * from the atlas are dropped (the face goes flat, in the block's colour).
 */
function cubeFaces(blockId: string, front: (string | undefined)[], manifest: TextureManifest): IconFaces {
  const base = blockInfo(blockId).color;
  const colors = { top: shade(base, 1.15), left: shade(base, 0.9), right: shade(base, 0.72) };
  const block = manifest.blocks[blockId];
  const known = (name: string | undefined): name is string => !!name && name in manifest.tiles;
  const face = (tile: string | undefined, color: string, overlays: (string | undefined)[] = []): IconFace => {
    if (!block || block.flat || !known(tile)) return { tiles: [], color };
    return { tiles: [tile, ...overlays.filter(known)], color };
  };
  return {
    top: face(block?.top ?? block?.side, colors.top),
    left: face(block?.side, colors.left, front),
    right: face(block?.side, colors.right),
  };
}

/**
 * Textured faces of the picker icon: the dominant casing on every face, with the controller's
 * front overlay on the left one. Tiles missing from the atlas are dropped (the face goes flat).
 */
export function iconFaces(def: MultiblockDef, manifest: TextureManifest = TEXTURES): IconFaces {
  return cubeFaces(dominantBlockId(def), [manifest.blocks[def.controller.blockId]?.front], manifest);
}

/**
 * Icon of one block in the required-blocks list. A hatch is drawn as the casing it replaces with its overlay
 * on the front, as in game; any other block shows its own textures, with its front overlay (a controller's)
 * on the left face.
 */
export function blockIconFaces(
  blockId: string,
  hatch?: { kind: HatchKind; base?: string },
  manifest: TextureManifest = TEXTURES,
): IconFaces {
  if (hatch?.base && manifest.blocks[hatch.base])
    return cubeFaces(hatch.base, manifest.hatchOverlays[hatch.kind] ?? [], manifest);
  return cubeFaces(blockId, [manifest.blocks[blockId]?.front], manifest);
}

const iconCache = new Map<string, IconFaces>();

/** `iconFaces`, computed once per multiblock id (the catalog is static). */
export function cachedIconFaces(def: MultiblockDef): IconFaces {
  let faces = iconCache.get(def.id);
  if (!faces) {
    faces = iconFaces(def);
    iconCache.set(def.id, faces);
  }
  return faces;
}

/** Case-insensitive match on name, tier and id. */
export function matchesQuery(def: MultiblockDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [def.name, def.tier ?? '', def.id].some((s) => s.toLowerCase().includes(q));
}
