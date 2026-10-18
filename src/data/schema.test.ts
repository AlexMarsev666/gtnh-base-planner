import { describe, expect, it } from 'vitest';
import type { MultiblockDef } from '../model/multiblock/types';
import { localCells } from '../model/geometry';
import { resizeSteps, sizedDef } from '../model/resize';
import { catalog, getMultiblock } from './catalog';
import { validateMultiblockDef } from './validate';

const files = import.meta.glob<MultiblockDef>('./multiblocks/*.json', { eager: true, import: 'default' });
const entries = Object.entries(files).map(([path, def]) => ({
  file: path.replace(/^.*\//, '').replace(/\.json$/, ''),
  def,
}));

function clone(def: MultiblockDef): MultiblockDef {
  return JSON.parse(JSON.stringify(def)) as MultiblockDef;
}

describe('multiblock catalog', () => {
  it('has at least 10 multiblocks', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    expect(entries.length).toBe(catalog.length);
  });

  it('has unique ids', () => {
    const ids = catalog.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(entries)('$file', ({ file, def }) => {
    it('passes validation', () => {
      expect(validateMultiblockDef(def, file)).toEqual([]);
    });

    it('passes validation at every size it can take', () => {
      for (const n of def.resize ? resizeSteps(def.resize) : [])
        expect(validateMultiblockDef(sizedDef(def, n))).toEqual([]);
    });

    it('has a GT source link', () => {
      expect(def.source).toMatch(/^https:\/\/github\.com\//);
    });

    it('builds local cells with exactly one controller', () => {
      const cells = localCells(def);
      expect(cells.filter((c) => c.role === 'controller')).toHaveLength(1);
    });
  });
});

describe('validateMultiblockDef', () => {
  const base = getMultiblock('electric-blast-furnace')!;

  it('accepts a valid def', () => {
    expect(validateMultiblockDef(base, 'electric-blast-furnace')).toEqual([]);
  });

  it('rejects a mismatched file name and a bad id', () => {
    expect(validateMultiblockDef(base, 'ebf').join()).toMatch(/file name/);
    const d = clone(base);
    d.id = 'Bad_Id';
    expect(validateMultiblockDef(d).join()).toMatch(/must match/);
  });

  it('rejects wrong layer dimensions', () => {
    const d = clone(base);
    d.layers[1] = d.layers[1].slice(0, 2);
    expect(validateMultiblockDef(d).join()).toMatch(/rows, expected/);
    const e = clone(base);
    e.layers[2][0] = 'KKKK';
    expect(validateMultiblockDef(e).join()).toMatch(/length 4/);
    const f = clone(base);
    f.layers.pop();
    expect(validateMultiblockDef(f).join()).toMatch(/entries, expected/);
  });

  it('rejects unknown chars', () => {
    const d = clone(base);
    d.layers[1][0] = 'KZK';
    expect(validateMultiblockDef(d).join()).toMatch(/unknown char "Z"/);
  });

  it('rejects missing, duplicate or misplaced controllers', () => {
    const none = clone(base);
    none.layers[0][0] = 'bbb';
    expect(validateMultiblockDef(none).join()).toMatch(/exactly one "~", found 0/);
    const two = clone(base);
    two.layers[0][1] = 'b~b';
    expect(validateMultiblockDef(two).join()).toMatch(/found 2/);
    const moved = clone(base);
    moved.controller = { ...moved.controller, pos: [0, 0, 0] };
    expect(validateMultiblockDef(moved).join()).toMatch(/does not match/);
  });

  it('rejects a controller that does not face out of the box', () => {
    const d = clone(base);
    d.controller = { ...d.controller, facing: 'south' };
    expect(validateMultiblockDef(d).join()).toMatch(/does not face open space on the south side/);
    const east = clone(base);
    east.controller = { ...east.controller, facing: 'east' };
    expect(validateMultiblockDef(east).join()).toMatch(/does not face open space on the east side/);
  });

  it('rejects unknown block ids', () => {
    const d = clone(base);
    d.legend.b = { ...d.legend.b, blockId: 'gt.nope' };
    d.controller = { ...d.controller, blockId: 'gt.nope2' };
    d.hatchBlocks.energy = 'gt.nope3';
    const msg = validateMultiblockDef(d).join();
    expect(msg).toMatch(/gt\.nope"/);
    expect(msg).toMatch(/gt\.nope2/);
    expect(msg).toMatch(/gt\.nope3/);
  });

  it('rejects invalid hatch kinds and missing hatch blocks', () => {
    const d = clone(base);
    (d.legend.f.hatches as string[]).push('laser');
    expect(validateMultiblockDef(d).join()).toMatch(/invalid hatch kind "laser"/);
    const e = clone(base);
    delete e.hatchBlocks.muffler;
    expect(validateMultiblockDef(e).join()).toMatch(/"muffler" is allowed but has no hatchBlocks/);
  });

  it('rejects hatch lists naming kinds no cell allows', () => {
    const d = clone(base);
    d.shareableHatches = [...d.shareableHatches, 'dynamo'];
    expect(validateMultiblockDef(d).join()).toMatch(/shareableHatches lists "dynamo"/);
  });

  it('requires every required kind to be enabled by default', () => {
    const d = clone(base);
    d.defaultHatches = d.defaultHatches.filter((k) => k !== 'muffler');
    expect(validateMultiblockDef(d).join()).toMatch(
      /requiredHatches\.muffler\.min >= 1 but "muffler" is not in defaultHatches/,
    );
  });

  it('checks face rules and regions', () => {
    expect(validateMultiblockDef(getMultiblock('distillation-tower')!)).toEqual([]);
    expect(validateMultiblockDef(getMultiblock('oil-cracking-unit')!)).toEqual([]);
    const d = clone(base);
    d.legend.b = { ...d.legend.b, disallowFaces: { muffler: ['up'] } };
    expect(validateMultiblockDef(d).join()).toMatch(/disallowFaces\.muffler/);
    const r = clone(base);
    r.requiredHatches = { ...r.requiredHatches, energy: { min: 1, regions: ['nowhere'] } };
    expect(validateMultiblockDef(r).join()).toMatch(/regions lists "nowhere"/);
  });

  it('checks allowFaces', () => {
    const d = clone(base);
    d.legend.b = { ...d.legend.b, allowFaces: { muffler: ['up'] } };
    expect(validateMultiblockDef(d).join()).toMatch(/allowFaces.muffler but the cell does not allow/);
    const empty = clone(getMultiblock('assembly-line')!);
    empty.legend.b = { ...empty.legend.b, allowFaces: { fluidIn: [] } };
    expect(validateMultiblockDef(empty).join()).toMatch(/allowFaces.fluidIn must list directions/);
    const bad = clone(getMultiblock('assembly-line')!);
    bad.legend.b = { ...bad.legend.b, allowFaces: { fluidIn: ['down', 'sideways' as never] } };
    expect(validateMultiblockDef(bad).join()).toMatch(/allowFaces.fluidIn must list directions/);
    // The sides GT allows and the ones the entry forbids must leave one.
    const none = clone(getMultiblock('assembly-line')!);
    none.legend.e = { ...none.legend.e, allowFaces: { energy: ['east', 'down'] } };
    expect(validateMultiblockDef(none).join()).toMatch(
      /allowFaces.energy and disallowFaces.energy leave no side/,
    );
    const ok = clone(getMultiblock('assembly-line')!);
    ok.legend.e = { ...ok.legend.e, allowFaces: { energy: ['up', 'down'] } };
    expect(validateMultiblockDef(ok)).toEqual([]);
  });

  it('checks glassTierLimits', () => {
    const cracker = getMultiblock('mega-oil-cracker')!;
    expect(validateMultiblockDef(cracker)).toEqual([]);
    const bad = (limit: unknown) =>
      validateMultiblockDef({ ...clone(cracker), glassTierLimits: limit } as MultiblockDef).join();
    expect(bad({ chars: ['Z'], kinds: ['energy'] })).toMatch(/lists "Z" which is not a legend key/);
    expect(bad({ chars: [], kinds: ['energy'] })).toMatch(/chars must be a non-empty array/);
    expect(bad({ chars: ['C'], kinds: [] })).toMatch(/kinds must be a non-empty array/);
    expect(bad({ chars: ['C'], kinds: ['laser'] })).toMatch(/invalid hatch kind "laser"/);
    expect(bad({ chars: ['C'], kinds: ['dynamo'] })).toMatch(/lists "dynamo" but no legend cell allows it/);
  });

  it('checks zones against the regions of the legend', () => {
    const cracker = getMultiblock('mega-oil-cracker')!;
    expect(Object.keys(cracker.zones ?? {})).toEqual(['dot1', 'dot2', 'dot3', 'dot4']);
    expect(validateMultiblockDef(cracker)).toEqual([]);
    const d = clone(cracker);
    d.zones = { ...d.zones, nowhere: { kinds: ['energy'] } };
    expect(validateMultiblockDef(d).join()).toMatch(/zones names "nowhere"/);
    const k = clone(cracker);
    k.zones = { dot3: { kinds: ['steamIn'] } };
    expect(validateMultiblockDef(k).join()).toMatch(/zones\.dot3 lists "steamIn"/);
  });

  it('rejects a max below min', () => {
    const d = clone(base);
    d.requiredHatches = { ...d.requiredHatches, energy: { min: 2, max: 1 } };
    expect(validateMultiblockDef(d).join()).toMatch(/max must be an integer >= min/);
  });
});
