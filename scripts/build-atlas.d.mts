export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface TileOptions {
  path?: string;
  tint?: readonly [number, number, number] | number[];
  /** Composited tiles (tools/game-dump): the jar paths of the sprites they are made from. */
  from?: string[];
}

export interface Faces {
  side: string;
  top?: string;
  bottom?: string;
  front?: string;
}

export const REPO: string;
export const ICONSETS: string;
export const TILE: number;
export const TIER_NAMES: string[];
export const TILES: Record<string, TileOptions>;
export const BLOCK_MAP: Record<string, Faces>;
export const HATCH_OVERLAYS: Record<string, string[]>;

export function tileSourcePath(name: string): string;
export function decodePng(data: Uint8Array): RgbaImage;
export function encodePng(image: RgbaImage): Uint8Array;
export function firstFrameTile(image: RgbaImage, tint?: readonly number[]): Uint8Array;
export function packAtlas(tiles: Record<string, Uint8Array>): {
  image: RgbaImage;
  rects: Record<string, [number, number, number, number]>;
};
export function readBlockIds(source?: string): string[];
export function readBlockNames(
  source?: string,
  generatedList?: { id: string; name: string }[],
): Map<string, string>;
export function isTranslucentBlock(id: string, name?: string): boolean;
export function buildManifest(
  rects: Record<string, [number, number, number, number]>,
  atlasSize: { width: number; height: number },
  blockIds: string[],
  names?: Map<string, string>,
): { manifest: unknown; flat: string[] };
