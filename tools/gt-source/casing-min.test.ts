import { describe, expect, it } from 'vitest';
import {
  BlockNames,
  BlockReader,
  charsOf,
  ClassContext,
  countedBlocks,
  uncountedElements,
  evalInt,
  patchDef,
  removeProperty,
  sourceClassOf,
  tooltipCasings,
  withConstraints,
} from './casing-min.mjs';

const ctxOf = (body: string) => new ClassContext([{ name: 'MTETest', body }]);
const lone = (ctx: ClassContext, expr: string) => ctx.eval(expr);

const registry = {
  casingsEnum: new Map([
    ['PressureContainmentCasing', { field: 'sBlockCasings10', meta: 3 }],
    ['SolidSteelMachineCasing', { field: 'sBlockCasings2', meta: 0 }],
  ]),
  blockClass: new Map([
    ['sBlockCasings1', 'BlockCasings1'],
    ['sBlockCasings2', 'BlockCasings2'],
    ['sBlockCasings4', 'BlockCasings4'],
  ]),
  allSources: () => [] as [string, string][],
  classSrc: () => null,
};
const blocks = new BlockReader(registry);

describe('evalInt', () => {
  const none = () => null;

  it('reads literals, operators and parentheses', () => {
    expect(evalInt('40 - 16', none)).toEqual([{ c: 24, vars: {} }]);
    expect(evalInt('(2 + 3) * 4 / 2', none)).toEqual([{ c: 10, vars: {} }]);
    expect(evalInt('24 + 24 + 9', none)).toEqual([{ c: 57, vars: {} }]);
  });

  it('resolves constants of the class, also through other constants', () => {
    const ctx = ctxOf(
      'private static final int MAX_CASINGS = 77; private static final int MIN_CASINGS = MAX_CASINGS - 53;',
    );
    expect(lone(ctx, 'MIN_CASINGS')).toEqual([{ c: 24, vars: {} }]);
  });

  it('reads the formula of a size as coefficients of a variable', () => {
    const ctx = ctxOf('protected int mHeight; protected int width = 0; void f() { width++; }');
    expect(lone(ctx, '7 * (mHeight + 1) - 5')).toEqual([{ c: 2, vars: { mHeight: 7 } }]);
    expect(lone(ctx, '91 + width * 20')).toEqual([{ c: 91, vars: { width: 20 } }]);
  });

  it('treats a field with an initialiser that the code bumps as a variable, not a constant', () => {
    const ctx = ctxOf('private int casingAmount = 0; void f() { ++casingAmount; }');
    expect(ctx.intName('casingAmount')).toEqual({ variable: true });
  });

  it('follows zero-argument methods, most derived class first', () => {
    const ctx = new ClassContext([
      { name: 'Gas', body: 'public int minCasingAmount() { return 372 - 26; }' },
      { name: 'Base', body: 'public int minCasingAmount() { return 372; }' },
    ]);
    expect(lone(ctx, 'minCasingAmount()')).toEqual([{ c: 346, vars: {} }]);
  });

  it('gives alternatives for a ternary, also inside parentheses', () => {
    const ctx = ctxOf('int MIN = 462;');
    expect(lone(ctx, 'structureTier == 2 ? 69 : 26').map((a) => a.c)).toEqual([69, 26]);
    expect(lone(ctx, 'MIN + (foundry.present ? 15 : 0)').map((a) => a.c)).toEqual([477, 462]);
  });

  it('fails on what it cannot read', () => {
    const ctx = ctxOf('int a = 1;');
    expect(() => ctx.eval('unknownName + 1')).toThrow(/unknown name/);
    expect(() => ctxOf('int a; int b;').eval('a * b')).toThrow(/not linear/);
    expect(() => ctx.eval('foo(1)')).toThrow();
  });
});

describe('countedBlocks', () => {
  it('reads Casings.X.asElement() from onElementPass', () => {
    const ctx = ctxOf(`
      private int casingAmount;
      .buildAndChain(onElementPass(x -> ++x.casingAmount, Casings.PressureContainmentCasing.asElement()))`);
    expect(countedBlocks('casingAmount', ctx, blocks)).toMatchObject({
      cands: [{ field: 'sBlockCasings10', meta: 3 }],
      errors: [],
      counting: [{ char: null, hatch: null }],
    });
  });

  it('keeps one counter apart from another', () => {
    const ctx = ctxOf(`
      .buildAndChain(onElementPass(x -> ++x.casingAmountStainless, ofBlock(GregTechAPI.sBlockCasings4, 1)))
      .buildAndChain(onElementPass(x -> ++x.casingAmount, Casings.SolidSteelMachineCasing.asElement()))`);
    expect(countedBlocks('casingAmountStainless', ctx, blocks).cands).toEqual([
      { field: 'sBlockCasings4', meta: 1 },
    ]);
    expect(countedBlocks('casingAmount', ctx, blocks).cands).toEqual([{ field: 'sBlockCasings2', meta: 0 }]);
  });

  it('reads a method reference, a constant meta and a cast', () => {
    const ctx = ctxOf(`
      private static final int DIM = 7;
      private int mCasingAmount;
      private void onCasingAdded() { mCasingAmount++; }
      .addElement('A', onElementPass(MTETest::onCasingAdded, ofBlock(GregTechAPI.sBlockCasings1, DIM)))
      .addElement('B', onElementPass(m -> m.mCasingAmount++, ofBlock(GregTechAPI.sBlockCasings4, (byte) 2)))`);
    expect(countedBlocks('mCasingAmount', ctx, blocks).cands).toEqual([
      { field: 'sBlockCasings1', meta: 7 },
      { field: 'sBlockCasings4', meta: 2 },
    ]);
  });

  it('takes every block of a tiered list', () => {
    const ctx = ctxOf(`
      int casingAmount;
      onElementPass(m -> m.casingAmount++, ofBlocksTiered(MTETest::tier,
        ImmutableList.of(Pair.of(sBlockCasings2, 4), Pair.of(sBlockCasings2, 5)), -1, (m, t) -> m.tier = t, m -> m.tier))`);
    expect(countedBlocks('casingAmount', ctx, blocks).cands).toEqual([
      { field: 'sBlockCasings2', meta: 4 },
      { field: 'sBlockCasings2', meta: 5 },
    ]);
  });

  it('reads the steam machines: the bump sits in an if on block and meta', () => {
    const ctx = ctxOf(`
      private int casingAmount = 0;
      public Integer getTierMachineCasing(Block block, int meta) {
        if (block == sBlockCasings1 && 10 == meta) {
          casingAmount++;
          return 1;
        }
        if (block == sBlockCasings2 && meta == 0) {
          casingAmount++;
          return 2;
        }
        return null;
      }`);
    expect(countedBlocks('casingAmount', ctx, blocks).cands).toEqual([
      { field: 'sBlockCasings1', meta: 10 },
      { field: 'sBlockCasings2', meta: 0 },
    ]);
  });

  it('follows a method that returns the block and one that returns the meta', () => {
    const ctx = ctxOf(`
      int mCasing;
      protected Block getCasingBlock() { return GregTechAPI.sBlockCasings4; }
      protected int getCasingMeta() { return 1; }
      onElementPass(x -> ++x.mCasing, ofBlock(getCasingBlock(), getCasingMeta()))`);
    expect(countedBlocks('mCasing', ctx, blocks).cands).toEqual([{ field: 'sBlockCasings4', meta: 1 }]);
  });

  it('reports a counter nothing bumps', () => {
    expect(countedBlocks('nothing', ctxOf('int nothing;'), blocks).errors).toEqual([
      'no element bumps nothing',
    ]);
  });
});

describe('tooltipCasings', () => {
  it('reads the casing lines of the builder, with ranges, minimums and computed counts', () => {
    const ctx = ctxOf(`
      public int minCasingAmount() { return 346; }
      tt.addCasing("16-79", "Clean Stainless Steel Machine Casing", false)
        .addCasingInfoRange("Solidifier Casing", 91, 211, false)
        .addCasingInfoMin("Frame", 4, false)
        .addCasingInfoExactly("Glass", 24, true)
        .addCasing(minCasingAmount() + "-440", "Reinforced Gas Turbine Casing", false)`);
    expect(tooltipCasings(ctx)).toEqual([
      { name: 'Clean Stainless Steel Machine Casing', lo: 16, hi: 79 },
      { name: 'Reinforced Gas Turbine Casing', lo: 346, hi: 440 },
      { name: 'Glass', lo: 24, hi: 24 },
      { name: 'Frame', lo: 4, hi: Infinity },
      { name: 'Solidifier Casing', lo: 91, hi: 211 },
    ]);
  });
});

describe('BlockNames', () => {
  const info = (unloc: string, names: Record<number, string>) => ({
    unloc,
    name: (m: number) => names[m] ?? null,
  });
  const reg = {
    blockInfo: (field: string) =>
      field === 'sBlockCasings4'
        ? info('gt.blockcasings4', { 1: 'Clean Stainless Steel Machine Casing' })
        : null,
  };
  const fieldOfName = (n: string) => (n === 'gt.blockcasings4' ? 'sBlockCasings4' : undefined);
  const names = new BlockNames(
    reg,
    fieldOfName,
    new Map([['gt.casing.cleanStainless', 'Clean Stainless Steel Machine Casing']]),
  );

  it('matches the dump ids by registry name and meta', () => {
    expect(names.matches({ field: 'sBlockCasings4', meta: 1 }, 'gregtech:gt.blockcasings4@1')).toBe(true);
    expect(names.matches({ field: 'sBlockCasings4', meta: 1 }, 'gregtech:gt.blockcasings4@2')).toBe(false);
    expect(names.matches({ field: 'sBlockCasings4', meta: null }, 'gregtech:gt.blockcasings4@2')).toBe(true);
    expect(names.matches({ vanilla: 'hardened_clay', meta: 0 }, 'minecraft:hardened_clay@0')).toBe(true);
    expect(names.matches({ name: 'kekztech_x', meta: 0 }, 'kekztech:kekztech_x@0')).toBe(true);
  });

  it('matches the old converter ids by unlocalized name and the planner ids by display name', () => {
    expect(names.matches({ field: 'sBlockCasings4', meta: 1 }, 'gt5u.gtBlockcasings4.1')).toBe(true);
    expect(names.matches({ field: 'sBlockCasings4', meta: 1 }, 'gt.casing.cleanStainless')).toBe(true);
    expect(names.matches({ field: 'sBlockCasings4', meta: 0 }, 'gt.casing.cleanStainless')).toBe(false);
  });
});

describe('writing the fields', () => {
  const text = `{
  "id": "x",
  "requiredHatches": { "energy": { "min": 1 } },
  "defaultHatches": ["energy"],
  "wallshare": true
}
`;
  const fields = {
    minCasings: [{ chars: ['a', 'b'], min: 3, perSlab: 2 }],
    requiredAny: [{ kinds: ['itemIn', 'fluidIn'], min: 1 }],
  };

  it('inserts both before defaultHatches, in the order withConstraints gives', () => {
    const out = patchDef(text, fields);
    expect(Object.keys(JSON.parse(out))).toEqual([
      'id',
      'requiredHatches',
      'requiredAny',
      'minCasings',
      'defaultHatches',
      'wallshare',
    ]);
    expect(JSON.parse(out)).toEqual(withConstraints(JSON.parse(text), fields));
    expect(Object.keys(withConstraints(JSON.parse(text), fields))).toEqual(Object.keys(JSON.parse(out)));
  });

  it('replaces earlier values, and removes them when there are none', () => {
    const once = patchDef(text, fields);
    expect(patchDef(once, fields)).toBe(once);
    const none = patchDef(once, { minCasings: [], requiredAny: [] });
    expect(JSON.parse(none)).toEqual(JSON.parse(text));
  });

  it('removes a last property without leaving a comma', () => {
    expect(JSON.parse(removeProperty('{\n  "a": 1,\n  "b": [1, 2]\n}', 'b'))).toEqual({ a: 1 });
  });
});

describe('sourceClassOf', () => {
  it('takes the class from the source link', () => {
    expect(
      sourceClassOf({
        source:
          'https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.205/src/main/java/gregtech/common/tileentities/machines/multi/MTEOilCracker.java',
      }),
    ).toBe('gregtech.common.tileentities.machines.multi.MTEOilCracker');
    expect(sourceClassOf({})).toBeNull();
  });
});

describe('counted cells', () => {
  const body = `
    protected int mCasing;
    protected void onCasingFound() { mCasing++; }
    protected void onTop(boolean casing) { if (casing) onCasingFound(); }
    static {
      builder
        .addShape("main", new String[][] { { "b~b", "bcb" } })
        .addShape("hint", new String[][] { { "LLL" } })
        .addElement('b', ofChain(buildHatchAdder(X.class).atLeast(Energy).hint(1).build(),
          onElementPass(MTETest::onCasingFound, ofBlock(GregTechAPI.sBlockCasings4, 1))))
        .addElement('c', onElementPass(t -> t.onTop(true), ofBlock(GregTechAPI.sBlockCasings4, 1)))
        .addElement('D', ofBlock(GregTechAPI.sBlockCasings4, 1))
        .addElement('L', buildHatchAdder(X.class).atLeast(Energy).hint(2).buildAndChain(GregTechAPI.sBlockCasings4, 1));
    }
    checkPiece("main", 1, 1, 0, errors);`;
  const ctx = ctxOf(body);

  it('counts through the methods a lambda calls', () => {
    expect(countedBlocks('mCasing', ctx, blocks).counting).toEqual([
      { char: 'b', hatch: true, cands: [{ field: 'sBlockCasings4', meta: 1 }] },
      { char: 'c', hatch: false, cands: [{ field: 'sBlockCasings4', meta: 1 }] },
    ]);
  });

  it('lists the elements of the same block that do not count, but not hint-only ones', () => {
    // 'D' is not in the shape "main" that the check runs? it is not in any shape: also left out. 'L' is hint-only.
    expect(uncountedElements('mCasing', ctx, blocks)).toEqual([]);
    const placed = ctxOf(body.replace('{ "b~b", "bcb" }', '{ "b~b", "bcD" }'));
    expect(uncountedElements('mCasing', placed, blocks)).toEqual([
      { char: 'D', hatch: false, cands: [{ field: 'sBlockCasings4', meta: 1 }] },
    ]);
  });

  const names = {
    matches: (c: { field?: string; meta: number | null }, id: string) => id === `${c.field}@${c.meta}`,
  } as unknown as ConstructorParameters<typeof BlockNames>[0] & { matches: () => boolean };
  const def = {
    legend: {
      A: { blockId: 'sBlockCasings4@1', hatches: ['energy'] },
      B: { blockId: 'sBlockCasings4@1' },
      C: { blockId: 'sBlockCasings4@1', hatches: ['itemIn'] },
    },
  };
  const cand = { field: 'sBlockCasings4', meta: 1 };
  const asNames = names as unknown as BlockNames;

  it('keeps every character of the block when nothing else places it', () => {
    expect(charsOf(def, ['sBlockCasings4@1'], [], [], asNames)).toEqual(['A', 'B', 'C']);
  });

  it('tells the counted hatch casing from a plain one of the same block by the hatches', () => {
    const counting = [{ char: 'b', hatch: true, cands: [cand] }];
    const plain = [{ char: 'D', hatch: false, cands: [cand] }];
    expect(charsOf(def, ['sBlockCasings4@1'], counting, plain, asNames)).toEqual(['A', 'C']);
  });

  it('fails when the counted and the uncounted element look alike', () => {
    const counting = [{ char: 'b', hatch: true, cands: [cand] }];
    const hatchy = [{ char: 'L', hatch: true, cands: [cand] }];
    expect(() => charsOf(def, ['sBlockCasings4@1'], counting, hatchy, asNames)).toThrow(/cannot tell/);
    const mixed = [...counting, { char: 'c', hatch: false, cands: [cand] }];
    expect(() => charsOf(def, ['sBlockCasings4@1'], mixed, hatchy, asNames)).toThrow(/cannot tell/);
  });

  it('keeps the condition of a ternary on each alternative', () => {
    const alts = evalInt('tier == 2 ? 69 : 26', () => null);
    expect(alts.map((a) => [a.c, (a as { when?: { negate: boolean } }).when?.negate])).toEqual([
      [69, false],
      [26, true],
    ]);
  });
});
