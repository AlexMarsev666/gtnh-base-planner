import { describe, expect, it } from 'vitest';
import { COILS, coilById } from '../data/coils';
import { getMultiblock } from '../data/catalog';
import { withCoil } from './coil';

const ebf = () => getMultiblock('electric-blast-furnace')!;

describe('withCoil', () => {
  it('draws the coil cells with the chosen coil and nothing else', () => {
    const def = ebf();
    const out = withCoil(def, 'kanthal');
    expect(out).not.toBe(def);
    for (const ch of def.coils!.chars) expect(out.legend[ch].blockId).toBe(coilById('kanthal')!.blockId);
    // Everything else is shared with the original.
    expect(out.layers).toBe(def.layers);
    for (const ch of Object.keys(def.legend).filter((c) => !def.coils!.chars.includes(c)))
      expect(out.legend[ch]).toBe(def.legend[ch]);
    // The original is not touched.
    expect(def.legend[def.coils!.chars[0]].blockId).toBe('gt.coil.cupronickel');
  });

  it('is memoised per def and coil', () => {
    const def = ebf();
    expect(withCoil(def, 'kanthal')).toBe(withCoil(def, 'kanthal'));
    expect(withCoil(def, 'kanthal')).not.toBe(withCoil(def, 'nichrome'));
  });

  it('returns the def itself when nothing changes', () => {
    const def = ebf();
    expect(withCoil(def, undefined)).toBe(def);
    expect(withCoil(def, 'no-such-coil')).toBe(def);
    // A multiblock without a heating coil.
    const plain = getMultiblock('distillation-tower')!;
    expect(plain.coils).toBeUndefined();
    expect(withCoil(plain, 'kanthal')).toBe(plain);
    // The coil the def already draws.
    const volcanus = getMultiblock('volcanus')!;
    const drawn = COILS.find((c) => c.blockId === volcanus.legend[volcanus.coils!.chars[0]].blockId)!;
    expect(withCoil(volcanus, drawn.id)).toBe(volcanus);
  });

  it('keeps blocks of the same coil equal on both units, so walls stay compatible', () => {
    const a = withCoil(ebf(), 'hypogen');
    const b = withCoil(ebf(), 'hypogen');
    expect(a).toBe(b);
  });
});
