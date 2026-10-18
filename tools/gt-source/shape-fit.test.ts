import { describe, expect, it } from 'vitest';
import { plainCells, shapesOf } from './shape-fit.mjs';

// MTEAdvAssLine, 5.09.54.205 (shortened).
const body = `
  private static final String STRUCTURE_PIECE_FIRST = "first";
  private static final String STRUCTURE_PIECE_LATER = "later";
  STRUCTURE_DEFINITION = StructureDefinition.<MTEAdvAssLine>builder()
    .addShape(STRUCTURE_PIECE_FIRST, transpose(new String[][] {
        { "~", "l", "G" },
        { "g", "m", "g" } }))
    .addShape(STRUCTURE_PIECE_LATER, transpose(new String[][] {
        { "d", "l", "d" },
        { "g", "m", "g" } }))
    .addElement('G', ofBlock(GregTechAPI.sBlockCasings3, 10))
    .addElement('l', ofBlock(GregTechAPI.sBlockCasings2, 9))
    .addElement('m', ofBlock(GregTechAPI.sBlockCasings2, 5))
    .addElement('g', chainAllGlasses())
    .addElement('d', buildHatchAdder(MTEAdvAssLine.class).atLeast(DataHatchElement.DataAccess).hint(3)
        .allowOnly(ForgeDirection.NORTH).buildAndChain(GregTechAPI.sBlockCasings3, 10))
    .build();`;
const chain = [{ name: 'MTEAdvAssLine', body, file: 'x' }];

describe('shapesOf', () => {
  it('reads transposed shapes named by a constant as [layer from top][z]', () => {
    expect(shapesOf(chain)).toEqual([
      {
        name: 'first',
        grid: [
          ['~', 'l', 'G'],
          ['g', 'm', 'g'],
        ],
      },
      {
        name: 'later',
        grid: [
          ['d', 'l', 'd'],
          ['g', 'm', 'g'],
        ],
      },
    ]);
  });
});

describe('plainCells', () => {
  // The def is drawn like the generated one: grate casing is one key `E`, plain or with the data hatch.
  const def = {
    controller: { pos: [2, 1, 0] },
    layers: [
      ['ggg', 'mmm', 'ggg'],
      ['EE~', 'lll', 'EEE'],
    ],
    legend: {
      g: { blockId: 'glass' },
      m: { blockId: 'gregtech:gt.blockcasings2@5' },
      l: { blockId: 'gregtech:gt.blockcasings2@9' },
      E: { blockId: 'gregtech:gt.blockcasings3@10', hatches: ['dataAccess'] },
    },
  };
  const rules = { chain: () => chain, src: (f: string) => f };
  const blocks = {
    elementBlocks: (expr: string) => ({
      cands: [...expr.matchAll(/ofBlock\(\w+\.(\w+), (\d+)\)/g)].map((m) => ({
        field: m[1],
        meta: Number(m[2]),
      })),
    }),
    blockOf: (b: string) => ({ field: b.replace(/^.*\./, '') }),
    metaOf: (m: string) => Number(m),
  };
  const names = {
    matches: (c: { field: string; meta: number }, id: string) =>
      id === `gregtech:gt.blockcasings${c.field.at(-1)}@${c.meta}`,
  };
  const leaves = [{ char: 'd', dot: 3, kinds: ['dataAccess'], allowed: null }];

  it('marks the grate cell of the controller piece that GT draws plain', () => {
    const r = plainCells(def, ['E'], {
      rules,
      sourceClass: 'x',
      blocks,
      names,
      ctx: {},
      leaves,
    } as never);
    // The piece has G at z = 2 beside the controller at z = 0; the cells at x = 0 and 1 belong to later slices.
    expect([...r.get('E')!]).toEqual(['2,1,2']);
  });

  it('marks nothing when the piece does not fit the def', () => {
    const wrong = { ...def, layers: [def.layers[0], ['EE~', 'mmm', 'EEE']] };
    const r = plainCells(wrong, ['E'], { rules, sourceClass: 'x', blocks, names, ctx: {}, leaves } as never);
    expect(r.get('E')!.size).toBe(0);
  });
});
