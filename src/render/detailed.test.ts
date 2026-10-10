import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { decodePng } from '../../scripts/build-atlas.mjs';
import { BLOCKS } from '../data/blocks';
import { DEFAULT_HATCH_COLORS } from '../model/colors';
import type { HatchKind } from '../model/multiblock/types';
import { createDetailedProvider, TEXTURES } from './detailed';
import { BOX_FACE_ORDER } from './materials';

const atlasPng = readFileSync(join(__dirname, '../../public/textures/atlas.png'));
const loadAtlas = async () => decodePng(atlasPng);

function mapOf(m: THREE.Material): THREE.Texture | null {
  return (m as THREE.MeshLambertMaterial).map;
}

describe('textures.json', () => {
  it('covers every block id with a texture or an explicit flat fallback', () => {
    for (const id of Object.keys(BLOCKS)) {
      const faces = TEXTURES.blocks[id];
      expect(faces, `${id} missing: run \`node scripts/build-atlas.mjs\``).toBeDefined();
      if (faces.flat) continue;
      for (const key of ['side', 'top', 'bottom', 'front'] as const) {
        const tile = faces[key];
        if (key === 'side') expect(tile, id).toBeTruthy();
        if (tile) expect(TEXTURES.tiles, `${id}.${key}`).toHaveProperty(tile);
      }
    }
  });

  it('has UV rects inside the atlas', () => {
    const { width, height, tile } = TEXTURES.atlas;
    const png = decodePng(atlasPng);
    expect([png.width, png.height]).toEqual([width, height]);
    for (const [name, [x, y, w, h]] of Object.entries(TEXTURES.tiles)) {
      expect(w, name).toBe(tile);
      expect(h, name).toBe(tile);
      expect(x >= 0 && y >= 0 && x + w <= width && y + h <= height, name).toBe(true);
    }
  });

  it('has an overlay for every hatch kind', () => {
    for (const kind of Object.keys(DEFAULT_HATCH_COLORS) as HatchKind[]) {
      const list = TEXTURES.hatchOverlays[kind];
      expect(list?.length, kind).toBeGreaterThan(0);
      for (const t of list ?? []) expect(TEXTURES.tiles).toHaveProperty(t);
    }
  });
});

describe('createDetailedProvider', () => {
  const colors = DEFAULT_HATCH_COLORS;

  it('returns six cached nearest-filtered textured materials for a casing', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    expect(p.mode).toBe('detailed');
    const mats = p.materials({ blockId: 'gt.cokeOvenBrick', kind: 'casing' }, colors);
    expect(mats).toHaveLength(6);
    expect(p.materials({ blockId: 'gt.cokeOvenBrick', kind: 'casing' }, colors)).toBe(mats);
    const tex = mapOf(mats[0])!;
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    // Same tile on every face → one shared material.
    expect(new Set(mats).size).toBe(1);
    p.dispose();
  });

  it('frees the faces of a hatch colour once it changes', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    const hatch = {
      blockId: 'gt.hatch.inputBus',
      kind: 'hatch',
      facing: 'north',
      hatchKind: 'itemIn',
    } as const;
    const casing = p.materials({ blockId: 'gt.cokeOvenBrick', kind: 'casing' }, colors);
    const old = p.materials(hatch, colors)[BOX_FACE_ORDER.indexOf('north')];
    const oldTex = mapOf(old)!;
    const disposed = vi.fn();
    const texDisposed = vi.fn();
    old.addEventListener('dispose', disposed);
    oldTex.addEventListener('dispose', texDisposed);
    const next = { ...colors, itemIn: '#123456' };
    const fresh = p.materials(hatch, next)[BOX_FACE_ORDER.indexOf('north')];
    expect(fresh).not.toBe(old);
    expect(disposed).toHaveBeenCalledOnce();
    expect(texDisposed).toHaveBeenCalledOnce();
    // Faces without the changed colour stay cached.
    expect(p.materials({ blockId: 'gt.cokeOvenBrick', kind: 'casing' }, next)).toBe(casing);
    expect(p.materials(hatch, next)[BOX_FACE_ORDER.indexOf('north')]).toBe(fresh);
    p.dispose();
  });

  it('puts the controller front on the facing side only', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    const mats = p.materials(
      { blockId: 'gt.cokeOvenController', kind: 'controller', facing: 'north' },
      colors,
    );
    const front = BOX_FACE_ORDER.indexOf('north');
    expect(new Set(mats).size).toBe(2);
    mats.forEach((m, i) => {
      if (i !== front) expect(m).toBe(mats[(front + 1) % 6]);
    });
    expect(mats[front]).not.toBe(mats[(front + 1) % 6]);
  });

  it('uses top/bottom tiles when defined', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    const mats = p.materials({ blockId: 'gt.casing.bronzeFirebox', kind: 'casing' }, colors);
    const up = mats[BOX_FACE_ORDER.indexOf('up')];
    const east = mats[BOX_FACE_ORDER.indexOf('east')];
    expect(up).not.toBe(east);
    expect(mats[BOX_FACE_ORDER.indexOf('down')]).toBe(up);
  });

  it('tints hatch faces by mode and colour', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    const visual = (hatchKind: HatchKind) =>
      ({ blockId: 'gt.cokeOvenHatch', kind: 'hatch', facing: 'south', hatchKind }) as const;
    const south = BOX_FACE_ORDER.indexOf('south');
    const a = p.materials(visual('itemIn'), colors);
    const b = p.materials(visual('itemOut'), colors);
    const c = p.materials(visual('itemIn'), { ...colors, itemIn: '#80c040' });
    expect(a[south]).not.toBe(b[south]);
    expect(a[south]).not.toBe(c[south]);
    expect(a[0]).toBe(b[0]); // other faces are plain casing
    // The frame pixel carries the exact (sRGB) hatch colour.
    const img = mapOf(c[south])!.image as { data: Uint8Array };
    expect([...img.data.subarray(0, 3)]).toEqual([0x80, 0xc0, 0x40]);
  });

  it('draws a hatch as the casing it replaces, with its overlay on the front', async () => {
    const p = createDetailedProvider({ loadAtlas });
    await p.load();
    const south = BOX_FACE_ORDER.indexOf('south');
    const hatch = (baseBlockId?: string) =>
      p.materials(
        { blockId: 'gt.hatch.inputBus', kind: 'hatch', facing: 'south', hatchKind: 'itemIn', baseBlockId },
        colors,
      );
    const casing = p.materials({ blockId: 'gt.casing.heatProof', kind: 'casing' }, colors);
    const onCasing = hatch('gt.casing.heatProof');
    const onHull = hatch();
    // Sides are the casing itself; the front differs from both the casing and a hatch on its own hull.
    expect(onCasing[0]).toBe(casing[0]);
    expect(onHull[0]).not.toBe(casing[0]);
    expect(onCasing[south]).not.toBe(casing[south]);
    expect(onCasing[south]).not.toBe(onHull[south]);
  });

  it('falls back to flat colours for unknown or untextured blocks', async () => {
    const p = createDetailedProvider({
      loadAtlas,
      manifest: { ...TEXTURES, blocks: { ...TEXTURES.blocks, 'gt.controller': { flat: true } } },
    });
    await p.load();
    const unknown = p.materials({ blockId: 'vanilla.stone', kind: 'casing' }, colors);
    expect(unknown).toHaveLength(6);
    expect(mapOf(unknown[0])).toBeNull();
    expect((unknown[0] as THREE.MeshLambertMaterial).color.getHexString()).toBe('999999');
    const ctrl = p.materials({ blockId: 'gt.controller', kind: 'controller', facing: 'north' }, colors);
    expect(mapOf(ctrl[0])).toBeNull();
    expect((ctrl[0] as THREE.MeshLambertMaterial).color.getHexString()).toBe(
      BLOCKS['gt.controller'].color.slice(1),
    );
  });

  it('uses flat colours before the atlas has loaded and when loading fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = createDetailedProvider({ loadAtlas: () => Promise.reject(new Error('404')) });
    const before = p.materials({ blockId: 'gt.cokeOvenBrick', kind: 'casing' }, colors);
    expect(mapOf(before[0])).toBeNull();
    await expect(p.load()).rejects.toThrow('404');
    expect(warn).toHaveBeenCalled();
    const hatch = p.materials({ blockId: 'gt.cokeOvenHatch', kind: 'hatch', hatchKind: 'fluidOut' }, colors);
    expect('#' + (hatch[0] as THREE.MeshLambertMaterial).color.getHexString()).toBe(colors.fluidOut);
    warn.mockRestore();
  });

  it('retries the atlas after a failed load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = vi.fn(loadAtlas).mockRejectedValueOnce(new Error('offline'));
    const p = createDetailedProvider({ loadAtlas: loader });
    await expect(p.load()).rejects.toThrow('offline');
    await expect(p.load()).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('loads the atlas once and disposes materials and textures', async () => {
    const loader = vi.fn(loadAtlas);
    const p = createDetailedProvider({ loadAtlas: loader });
    await Promise.all([p.load(), p.load()]);
    expect(loader).toHaveBeenCalledTimes(1);
    const mats = p.materials({ blockId: 'gt.glass.reinforced', kind: 'casing' }, colors);
    expect(mats[0].alphaTest).toBe(0.5);
    // Borosilicate glass is mostly half transparent: blended, not cut out.
    const boro = p.materials({ blockId: 'bartworks:BW_TieredGlass@0', kind: 'casing' }, colors);
    expect(boro[0].transparent).toBe(true);
    expect(boro[0].depthWrite).toBe(false);
    const disposed = vi.fn();
    mats[0].addEventListener('dispose', disposed);
    const tex = mapOf(mats[0])!;
    const texDisposed = vi.fn();
    tex.addEventListener('dispose', texDisposed);
    p.dispose();
    expect(disposed).toHaveBeenCalled();
    expect(texDisposed).toHaveBeenCalled();
    expect(p.materials({ blockId: 'gt.glass.reinforced', kind: 'casing' }, colors)[0]).not.toBe(mats[0]);
  });
});
