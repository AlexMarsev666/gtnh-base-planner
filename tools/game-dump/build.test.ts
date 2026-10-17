import { describe, expect, it } from 'vitest';
import { convertStructure, TruncatedDump } from './build.mjs';

const CTRL = {
  registry_name: 'gregtech:gt.blockmachines',
  meta: 1000,
  source_class: 'a.b.MTEX',
  display_name: 'X',
};
type P = [number, number, number];
const block = (d: P) => ({ block: 'gregtech:gt.blockcasings', meta: 0, d });
const docOf = (blocks: P[], hints: { d: P; hint: number }[] = []) => ({
  controller: CTRL,
  variants: [
    {
      trigger_stack_size: 1,
      blocks: [{ block: CTRL.registry_name, meta: CTRL.meta, d: [0, 0, 0] }, ...blocks.map(block)],
      hatch_slots: [],
      hints,
    },
  ],
});
const tooltip = (structure: unknown) => ({ rules: [], checks: null, elements: new Map(), structure });

describe('air hint', () => {
  // A 3x3 ring in the layer above the controller, the controller in front, hint 13 in the middle.
  const ring: P[] = [];
  for (let x = -1; x <= 1; x++) for (let z = 1; z <= 3; z++) if (x !== 0 || z !== 2) ring.push([x, 1, z]);
  ring.push([0, 0, 1], [0, 0, 2], [0, 0, 3]);

  it('turns a hint 13 with nothing placed into a must-stay-air cell', () => {
    const { def } = convertStructure(docOf(ring, [{ d: [0, 1, 2], hint: 13 }]), { id: 'x', name: 'X' });
    expect(def.layers[1]).toEqual(['   ', 'AAA', 'A-A', 'AAA']);
    expect(Object.values(def.legend).some((e) => e.blockId === 'gt.hatch.special')).toBe(false);
  });

  it('keeps every hint 13 cell, even one with no block next to it', () => {
    const { def } = convertStructure(
      docOf(ring, [
        { d: [0, 1, 2], hint: 13 },
        { d: [3, 1, 2], hint: 13 },
      ]),
      { id: 'x', name: 'X' },
    );
    expect(def.size).toEqual([5, 2, 4]);
    expect(def.layers[1]).toEqual(['     ', 'AAA  ', 'A-A -', 'AAA  ']);
  });

  it('keeps an enclosed cell with no hint as air', () => {
    const { def } = convertStructure(docOf([...ring, [0, 2, 2]]), { id: 'x', name: 'X' });
    expect(def.layers[1]).toEqual(['   ', 'AAA', 'A-A', 'AAA']);
  });

  it('still makes another hint with nothing placed a machine-specific hatch cell', () => {
    const { def } = convertStructure(docOf(ring, [{ d: [0, 1, 2], hint: 5 }]), { id: 'x', name: 'X' });
    expect(Object.values(def.legend).some((e) => e.blockId === 'gt.hatch.special')).toBe(true);
  });
});

describe('truncated dump', () => {
  // The controller at the bottom of a column; GT builds 4 layers, the dump has 3.
  const column: P[] = [
    [0, 1, 0],
    [0, 2, 0],
  ];
  const size = { min: [1, 4, 1], max: [1, 4, 1] };
  const piece = [['A'], ['A'], ['A'], ['~']];

  it('takes the missing layers from the source shape', () => {
    const r = convertStructure(docOf(column), { id: 'x', name: 'X' }, tooltip({ size, piece }));
    expect(r.def.size).toEqual([1, 4, 1]);
    expect(r.def.layers.map((l) => l[0])).toEqual(['~', 'A', 'A', 'A']);
    expect(r.shape).toMatchObject({ transposed: true, shape: piece });
  });

  it('leaves a dump as big as the tooltip says alone', () => {
    const r = convertStructure(
      docOf([...column, [0, 3, 0]]),
      { id: 'x', name: 'X' },
      tooltip({ size, piece }),
    );
    expect(r.def.size).toEqual([1, 4, 1]);
    expect(r.shape).toBeNull();
  });

  it('warns when the source has no shape to complete it', () => {
    const r = convertStructure(docOf(column), { id: 'x', name: 'X' }, tooltip({ size, piece: null }));
    expect(r.def.size).toEqual([1, 3, 1]);
    expect(r.sizeWarning).toMatch(/dump is 1x3x1 but the tooltip says 1x4x1/);
  });

  it('fails when the shape does not fit the dump', () => {
    expect(() =>
      convertStructure(
        docOf(column),
        { id: 'x', name: 'X' },
        tooltip({ size, piece: [['Z'], ['A'], ['A'], ['~']] }),
      ),
    ).toThrow(TruncatedDump);
  });
});

describe('hatch kinds only a foreign chain member brings', () => {
  // One hatch cell next to the controller, dot 1, whose element takes an input bus and (through a chain member that
  // names another dot) a muffler: the muffler is only added where the previous entry had it.
  const doc = docOf([[0, 1, 0]], [{ d: [1, 0, 0], hint: 0 }]) as { variants: { hatch_slots: unknown[] }[] };
  doc.variants[0].hatch_slots = [{ d: [1, 0, 0], kinds: ['InputBus'] }];
  const set = Object.assign(new Set(['itemIn', 'fluidIn', 'muffler']), { foreign: new Set(['muffler']) });
  const elements = new Map([[1, [set]]]);
  const hatchesOf = (previous: unknown) => {
    const { def } = convertStructure(doc, { id: 'x', name: 'X' }, { ...tooltip(null), elements, previous });
    return Object.values(def.legend).find((e) => e.hatches)?.hatches;
  };

  it('adds the other kinds of the element and holds the foreign one back', () => {
    expect(hatchesOf(null)).toEqual(['itemIn', 'fluidIn']);
  });

  it('adds the foreign kind where the previous entry had it', () => {
    const previous = {
      controller: { pos: [0, 0, 0] },
      layers: [['~A']],
      legend: { A: { hatches: ['itemIn', 'fluidIn', 'muffler'] } },
    };
    expect(hatchesOf(previous)).toEqual(['itemIn', 'fluidIn', 'muffler']);
  });
});

describe('stray hatch slot', () => {
  it('leaves out a slot with no hint and nothing placed when the machine has hints', () => {
    const doc = docOf([[0, 1, 0]], [{ d: [0, 1, 0], hint: 0 }]) as { variants: { hatch_slots: unknown[] }[] };
    doc.variants[0].hatch_slots = [{ d: [1, 0, 0], kinds: ['Energy'] }];
    expect(convertStructure(doc, { id: 'x', name: 'X' }).def.size).toEqual([1, 2, 1]);
  });
});
