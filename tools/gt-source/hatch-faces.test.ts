import { describe, expect, it } from 'vitest';
import { allowedSides, DIRS, facesOf, memberTexts, toLocal, type FaceLeaf } from './hatch-faces.mjs';

const sides = (text: string) => {
  const s = allowedSides(text);
  return s && DIRS.filter((d) => s.has(d));
};

// Element expressions copied from GT5-Unofficial 5.09.54.205.
describe('allowedSides', () => {
  it('allowOnly lists the sides', () => {
    expect(
      sides(`buildHatchAdder(MTEAssemblyLine.class).atLeast(Energy).casingIndex(16).hint(4)
        .allowOnly(ForgeDirection.UP, ForgeDirection.NORTH, ForgeDirection.SOUTH).continueIfSuccess().build()`),
    ).toEqual(['north', 'south', 'up']);
  });

  it('disallowOnly gives the complement', () => {
    expect(
      sides(`buildHatchAdder(MTEDistillationTower.class).atLeast(layeredOutputHatch).casingIndex(CASING_INDEX)
        .hint(2).disallowOnly(ForgeDirection.UP, ForgeDirection.DOWN).build()`),
    ).toEqual(['north', 'south', 'east', 'west']);
  });

  it('newAny takes the sides after the dot, and none for the predicate overload', () => {
    expect(sides('InputBus.newAny(16, 2, ForgeDirection.DOWN)')).toEqual(['down']);
    expect(sides('InputBus.newAny(16, 2, (t, te) -> t.skip(te))')).toBeNull();
  });

  it('is null without a restriction, or when every side is allowed', () => {
    expect(
      sides('buildHatchAdder(MTEFoo.class).atLeast(InputBus).casingIndex(16).hint(1).build()'),
    ).toBeNull();
    expect(sides('x.allowOnly().build()')).toBeNull();
  });

  it('lets the last call win, as the builder does', () => {
    expect(sides('x.disallowOnly(ForgeDirection.UP).allowOnly(ForgeDirection.NORTH).build()')).toEqual([
      'north',
    ]);
  });

  it('refuses sides it cannot read', () => {
    expect(() => allowedSides('x.allowOnly(allowedFacings).build()')).toThrow(/unreadable sides/);
  });
});

describe('memberTexts', () => {
  it('flattens chains and keeps the receiver of buildAndChain with its own sides', () => {
    const parts = memberTexts(`buildHatchAdder(MTEAssemblyLine.class).atLeast(InputHatch, Maintenance).hint(1)
      .allowOnly(ForgeDirection.DOWN).buildAndChain(ofBlock(GregTechAPI.sBlockCasings2, 0),
        ofHatchAdder(MTEAssemblyLine::addOutputToMachineList, 16, 4))`);
    expect(parts).toHaveLength(3);
    expect(sides(parts[0])).toEqual(['down']);
    expect(sides(parts[2])).toBeNull();
  });
});

describe('toLocal', () => {
  it('turns the horizontal sides with the controller and keeps up and down', () => {
    expect(toLocal('north', 'north')).toBe('north');
    expect(toLocal('north', 'east')).toBe('east');
    expect(toLocal('east', 'south')).toBe('west');
    expect(toLocal('south', 'west')).toBe('east');
    expect(toLocal('up', 'west')).toBe('up');
  });
});

describe('facesOf', () => {
  const set = (...d: string[]) => new Set(d) as FaceLeaf['allowed'];
  const def = (legend: Record<string, object>, facing = 'north') =>
    ({ id: 't', controller: { facing }, legend }) as Parameters<typeof facesOf>[0];

  it('gives an entry of a zone the sides of the elements with its dot, per kind', () => {
    const leaves: FaceLeaf[] = [
      { char: 'e', dot: 4, kinds: ['energy'], allowed: set('up', 'north', 'south') },
      { char: 'b', dot: 1, kinds: ['fluidIn', 'maintenance'], allowed: set('down') },
      { char: 'x', dot: 4, kinds: ['itemOut', 'fluidOut'], allowed: null },
    ];
    const r = facesOf(
      def({
        A: { blockId: 'a', hatches: ['fluidIn', 'maintenance'], region: 'dot1' },
        B: { blockId: 'b', hatches: ['energy', 'itemOut'], region: 'dot4' },
      }),
      leaves,
    );
    expect(r.allowFaces).toEqual({
      A: { fluidIn: ['down'], maintenance: ['down'] },
      B: { energy: ['north', 'south', 'up'] },
    });
  });

  it('leaves a kind unrestricted when one element takes it on every side, and unions the others', () => {
    const leaves: FaceLeaf[] = [
      { char: 'a', dot: null, kinds: ['itemIn'], allowed: set('down') },
      { char: 'b', dot: null, kinds: ['itemIn'], allowed: null },
      { char: 'c', dot: null, kinds: ['fluidIn'], allowed: set('down') },
      { char: 'd', dot: null, kinds: ['fluidIn'], allowed: set('north') },
    ];
    const r = facesOf(def({ A: { blockId: 'a', hatches: ['itemIn', 'fluidIn'] } }), leaves);
    expect(r.allowFaces).toEqual({ A: { fluidIn: ['north', 'down'] } });
  });

  it('keeps the elements whose kinds hold the entry kinds when elements share a dot (Dangote Distillus)', () => {
    const leaves: FaceLeaf[] = [
      { char: 'l', dot: 2, kinds: ['fluidOut'], allowed: set('north', 'south', 'east', 'west') },
      { char: 'l', dot: 2, kinds: ['energy'], allowed: null },
      { char: 'l', dot: 2, kinds: ['fluidOut'], allowed: null },
      { char: 't', dot: 2, kinds: ['fluidOut'], allowed: set('north', 'south', 'east', 'west', 'up') },
      { char: 't', dot: 2, kinds: ['muffler'], allowed: null },
    ];
    const r = facesOf(
      def({
        B: { blockId: 'a', hatches: ['fluidOut', 'energy'], region: 'dot2' },
        D: { blockId: 'a', hatches: ['fluidOut', 'muffler'], region: 'dot2' },
      }),
      leaves,
    );
    // 'l' also has a member that takes fluidOut on any side, so B stays free; D is only the top element 't'.
    expect(r.allowFaces).toEqual({ D: { fluidOut: ['north', 'south', 'east', 'west', 'up'] } });
    const plain = leaves.filter((l, i) => i !== 2);
    expect(
      facesOf(def({ B: { blockId: 'a', hatches: ['fluidOut', 'energy'], region: 'dot2' } }), plain)
        .allowFaces,
    ).toEqual({ B: { fluidOut: ['north', 'south', 'east', 'west'] } });
  });

  it('takes every member of an element that carries the dot, whatever the dot of the member', () => {
    const leaves: FaceLeaf[] = [
      { char: 'b', dot: 1, kinds: ['fluidIn'], allowed: set('down') },
      { char: 'b', dot: 4, kinds: ['itemOut'], allowed: null },
      { char: 'o', dot: 1, kinds: ['itemOut'], allowed: set('down') },
    ];
    const r = facesOf(def({ A: { blockId: 'a', hatches: ['itemOut', 'fluidIn'], region: 'dot1' } }), leaves);
    // The output adder of 'b' takes an output bus on any side, so only the input hatch is limited.
    expect(r.allowFaces).toEqual({ A: { fluidIn: ['down'] } });
  });

  it('turns the sides with the controller facing', () => {
    const leaves: FaceLeaf[] = [{ char: 'd', dot: 3, kinds: ['dataAccess'], allowed: set('north') }];
    const r = facesOf(def({ A: { blockId: 'a', hatches: ['dataAccess'], region: 'dot3' } }, 'west'), leaves);
    expect(r.allowFaces).toEqual({ A: { dataAccess: ['west'] } });
  });

  it('does not repeat what disallowFaces already says, and notes a disagreement', () => {
    const leaves: FaceLeaf[] = [
      { char: 'e', dot: null, kinds: ['energy'], allowed: set('up', 'north', 'south') },
    ];
    const same = facesOf(
      def({ A: { blockId: 'a', hatches: ['energy'], disallowFaces: { energy: ['west', 'east', 'down'] } } }),
      leaves,
    );
    expect(same).toEqual({ allowFaces: {}, notes: [] });
    const other = facesOf(
      def({ A: { blockId: 'a', hatches: ['energy'], disallowFaces: { energy: ['down'] } } }),
      leaves,
    );
    expect(other.allowFaces).toEqual({ A: { energy: ['north', 'south', 'up'] } });
    expect(other.notes).toHaveLength(1);
  });

  it('writes nothing for sides that add up to all six', () => {
    const leaves: FaceLeaf[] = [
      { char: 'a', dot: null, kinds: ['energy'], allowed: set('north', 'south', 'east', 'west') },
      { char: 'b', dot: null, kinds: ['energy'], allowed: set('up', 'down') },
    ];
    expect(facesOf(def({ A: { blockId: 'a', hatches: ['energy'] } }), leaves).allowFaces).toEqual({});
  });
});
