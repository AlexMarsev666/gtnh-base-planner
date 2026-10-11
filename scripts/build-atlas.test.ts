import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIERS } from '../src/model/core/types';
import {
  BLOCK_MAP,
  HATCH_OVERLAYS,
  TIER_NAMES,
  TILE,
  TILES,
  buildManifest,
  decodePng,
  encodePng,
  firstFrameTile,
  packAtlas,
  readBlockIds,
  tileSourcePath,
} from './build-atlas.mjs';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'tools/texture-sources');

function solid(w: number, h: number, rgba: number[]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4);
  return out;
}

describe('PNG codec', () => {
  it('round-trips RGBA pixels', () => {
    const data = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) & 0xff);
    const back = decodePng(encodePng({ width: 3, height: 2, data }));
    expect(back.width).toBe(3);
    expect(back.height).toBe(2);
    expect([...back.data]).toEqual([...data]);
  });

  it('decodes every committed source texture', () => {
    for (const name of Object.keys(TILES)) {
      const img = decodePng(readFileSync(join(SRC, `${name}.png`)));
      expect(img.width, name).toBeGreaterThan(0);
      expect(img.height % img.width, `${name} is a square or an animation strip`).toBe(0);
    }
  });
});

describe('tiles', () => {
  it('keeps only the first frame of an animated strip', () => {
    const strip = new Uint8Array(16 * 32 * 4);
    strip.set(solid(16, 16, [255, 0, 0, 255]), 0);
    strip.set(solid(16, 16, [0, 0, 255, 255]), 16 * 16 * 4);
    const tile = firstFrameTile({ width: 16, height: 32, data: strip });
    expect(tile.length).toBe(TILE * TILE * 4);
    expect([...tile.subarray(-4)]).toEqual([255, 0, 0, 255]);
  });

  it('applies a multiplicative tint', () => {
    const tile = firstFrameTile(
      { width: 16, height: 16, data: solid(16, 16, [255, 255, 255, 255]) },
      [210, 220, 255],
    );
    expect([...tile.subarray(0, 4)]).toEqual([210, 220, 255, 255]);
  });

  it('packs tiles into non-overlapping rects inside the atlas', () => {
    const tiles: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i++) tiles[`t${i}`] = solid(TILE, TILE, [i, 0, 0, 255]);
    const { image, rects } = packAtlas(tiles);
    const seen = new Set<string>();
    for (const [name, [x, y, w, h]] of Object.entries(rects)) {
      expect(x + w).toBeLessThanOrEqual(image.width);
      expect(y + h).toBeLessThanOrEqual(image.height);
      expect(seen.has(`${x},${y}`)).toBe(false);
      seen.add(`${x},${y}`);
      expect(image.data[(y * image.width + x) * 4]).toBe(Number(name.slice(1)));
    }
  });
});

describe('committed atlas', () => {
  it('references only known tiles', () => {
    for (const [id, faces] of Object.entries(BLOCK_MAP)) {
      for (const t of Object.values(faces)) expect(TILES, `${id} -> ${t}`).toHaveProperty(t);
    }
    for (const list of Object.values(HATCH_OVERLAYS)) for (const t of list) expect(TILES).toHaveProperty(t);
  });

  it('is up to date with the sources, the script and src/data/blocks.ts', () => {
    const tiles: Record<string, Uint8Array> = {};
    for (const [name, opts] of Object.entries(TILES)) {
      tiles[name] = firstFrameTile(decodePng(readFileSync(join(SRC, `${name}.png`))), opts.tint);
    }
    const { image, rects } = packAtlas(tiles);
    const committed = decodePng(readFileSync(join(ROOT, 'public/textures/atlas.png')));
    expect(committed.width).toBe(image.width);
    expect(committed.height).toBe(image.height);
    expect(Buffer.from(committed.data).equals(Buffer.from(image.data))).toBe(true);
    const { manifest } = buildManifest(rects, image, readBlockIds());
    const json = JSON.parse(readFileSync(join(ROOT, 'src/render/textures.json'), 'utf8'));
    expect(json, 'run `node scripts/build-atlas.mjs` to regenerate').toEqual(manifest);
  });

  it('credits every texture file in ATTRIBUTION.md', () => {
    const attribution = readFileSync(join(ROOT, 'ATTRIBUTION.md'), 'utf8');
    expect(attribution).toContain('LGPL-3.0');
    for (const [name, tile] of Object.entries(TILES)) {
      expect(existsSync(join(SRC, `${name}.png`)), name).toBe(true);
      // A composited tile (tools/game-dump) credits every sprite it is made from.
      const sources = tile.from ? tile.from.map((p) => `src/main/resources/${p}`) : [tileSourcePath(name)];
      expect(sources.length, name).toBeGreaterThan(0);
      for (const s of sources) expect(attribution, name).toContain(s);
    }
  });
});

describe('tiered single-block machines', () => {
  it('uses the tiers of the model', () => {
    expect(TIER_NAMES).toEqual([...TIERS]);
  });

  it('keeps the untiered block and has the tiles of every tiered look, but no block of its own', () => {
    expect(BLOCK_MAP['site.machine.macerator'].side).toBe('MACHINE_LV_SIDE');
    expect(Object.keys(BLOCK_MAP).filter((id) => id.includes('@') && id.startsWith('site.machine.'))).toEqual(
      [],
    );
    for (const tier of TIER_NAMES)
      for (const part of ['SIDE', 'TOP', 'BOTTOM']) expect(TILES).toHaveProperty(`MACHINE_${tier}_${part}`);
    // The overlays transformerLook names, for every high side and family GT registers.
    expect(TILES).toHaveProperty('SINGLE_TRANSFORMER_IN_LV');
    expect(TILES).toHaveProperty('SINGLE_TRANSFORMER_OUT_4A_ULV');
    expect(TILES).toHaveProperty('SINGLE_TRANSFORMER_OUT_16A_MAX');
    expect(TILES).toHaveProperty('SINGLE_TRANSFORMER_IN_64A_UXV');
    expect(TILES).toHaveProperty('SINGLE_TRANSFORMER_IN_4A_UEV');
  });
});
