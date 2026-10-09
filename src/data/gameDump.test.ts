import { expect, it } from 'vitest';
import type { MultiblockDef } from '../model/multiblock/types';

const { convertStructure } = await import(
  /* @vite-ignore */ new URL('../../tools/game-dump/build.mjs', import.meta.url).href
);

const controller = {
  registry_name: 'gregtech:gt.blockmachines',
  meta: 751,
  source_class: 'example.Controller',
};
const base = { d: [0, 0, 0], block: controller.registry_name, meta: controller.meta };
const casing = { d: [1, 0, 1], block: 'gregtech:gt.blockcasings4', meta: 1 };

it('keeps the reserved AIR hint empty even when it opens onto the outside', () => {
  const { def } = convertStructure(
    {
      controller,
      variants: [
        {
          trigger_stack_size: 1,
          blocks: [base, casing],
          hints: [{ d: [1, 0, 0], hint: 13 }],
          hatch_slots: [{ d: [1, 0, 0], kinds: ['LaserSource'] }],
        },
      ],
    },
    { id: 'test', name: 'Test' },
  );
  expect(def.layers[0][0]).toBe('~-');
  expect(
    Object.values(def.legend as MultiblockDef['legend']).some((e) => e.blockId === 'gt.hatch.special'),
  ).toBe(false);
});

it('retains ordinary special-hatch hints and actual constructed blocks', () => {
  const { def } = convertStructure(
    {
      controller,
      variants: [
        {
          trigger_stack_size: 1,
          blocks: [base, casing],
          hints: [
            { d: [1, 0, 1], hint: 13 },
            { d: [1, 1, 1], hint: 2 },
          ],
          hatch_slots: [],
        },
      ],
    },
    { id: 'test', name: 'Test' },
  );
  expect(def.legend[def.layers[0][1][1]].blockId).toBe('gregtech:gt.blockcasings4@1');
  expect(def.legend[def.layers[1][1][1]].blockId).toBe('gt.hatch.special');
});

it('does not extend a structure for a bare adjacent hatch probe beyond its constructed bounds', () => {
  const { def } = convertStructure(
    {
      controller,
      variants: [
        {
          trigger_stack_size: 1,
          blocks: [base, casing],
          hints: [],
          hatch_slots: [{ d: [2, 0, 1], kinds: ['InputBus'] }],
        },
      ],
    },
    { id: 'test', name: 'Test' },
  );
  expect(def.size).toEqual([2, 1, 2]);
  expect(
    Object.values(def.legend as MultiblockDef['legend']).some(
      (entry) => entry.blockId === 'gt.hatch.inputBus',
    ),
  ).toBe(false);
});

it('retains a required hatch with an actual hologram hint beyond the solid block bounds', () => {
  const { def } = convertStructure(
    {
      controller,
      variants: [
        {
          trigger_stack_size: 1,
          blocks: [base, casing],
          hints: [{ d: [2, 0, 1], hint: 2 }],
          hatch_slots: [{ d: [2, 0, 1], kinds: ['InputBus'] }],
        },
      ],
    },
    { id: 'test', name: 'Test' },
  );
  expect(def.size).toEqual([3, 1, 2]);
  expect(
    Object.values(def.legend as MultiblockDef['legend']).some(
      (entry) => entry.blockId === 'gt.hatch.inputBus',
    ),
  ).toBe(true);
});

it('ignores an alternative-shape probe in free space inside the constructed bounding box', () => {
  const { def } = convertStructure(
    {
      controller,
      variants: [
        {
          trigger_stack_size: 1,
          blocks: [base, casing, { ...casing, d: [3, 0, 3] }],
          hints: [],
          hatch_slots: [{ d: [2, 0, 1], kinds: ['InputBus'] }],
        },
      ],
    },
    { id: 'test', name: 'Test' },
  );
  expect(def.size).toEqual([4, 1, 4]);
  expect(def.layers[0][1][2]).toBe(' ');
  expect(
    Object.values(def.legend as MultiblockDef['legend']).some((e) => e.blockId === 'gt.hatch.inputBus'),
  ).toBe(false);
});
