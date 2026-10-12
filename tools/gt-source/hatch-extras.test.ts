import { describe, expect, it } from 'vitest';
import { patchDef, withExtras } from './hatch-extras.mjs';

const text = `{
  "id": "t",
  "legend": {
    "A": { "blockId": "a", "hatches": ["itemIn"], "region": "dot1" },
    "d": { "blockId": "grate" },
    "g": { "blockId": "glass" }
  },
  "hatchBlocks": { "itemIn": "gt.hatch.inputBus" },
  "requiredHatches": { "itemIn": { "min": 1 } },
  "defaultHatches": ["itemIn"]
}
`;
const extras = {
  dataAccess: { chars: ['d'], max: 1, split: [] },
  allowFaces: { A: { itemIn: ['down'] }, d: { dataAccess: ['north'] } },
  glassTierLimits: { chars: ['g'], kinds: ['energy'] },
};

describe('withExtras and patchDef', () => {
  const def = JSON.parse(text);

  it('patch the text and the object alike, in the same key order', () => {
    const patched = JSON.parse(patchDef(text, def, extras));
    const built = withExtras(def, extras);
    expect(patched).toEqual(built);
    expect(Object.keys(patched.legend.A)).toEqual(Object.keys(built.legend.A));
    expect(Object.keys(patched)).toEqual(Object.keys(built));
    expect(built.legend.d).toEqual({
      blockId: 'grate',
      hatches: ['dataAccess'],
      allowFaces: { dataAccess: ['north'] },
    });
    expect(built.hatchBlocks.dataAccess).toBe('gt.hatch.dataAccess');
    expect(built.requiredHatches.dataAccess).toEqual({ min: 0, max: 1 });
    expect(Object.keys(built).slice(-2)).toEqual(['glassTierLimits', 'defaultHatches']);
  });

  it('draw the plain cells of a key that gets a hatch with a key of their own', () => {
    const grid = {
      ...def,
      layers: [['dd~', 'ldd']],
      legend: { d: { blockId: 'grate' }, l: { blockId: 'l' } },
    };
    const gridText = JSON.stringify(grid, null, 2);
    const split = [{ from: 'd', to: 'P', cells: ['2,0,1'] }];
    const withSplit = { dataAccess: { chars: ['d'], max: 1, split }, allowFaces: {}, glassTierLimits: null };
    const built = withExtras({ ...grid, hatchBlocks: {}, requiredHatches: {} }, withSplit);
    expect(built.layers).toEqual([['dd~', 'ldP']]);
    expect(Object.keys(built.legend)).toEqual(['d', 'P', 'l']);
    expect(built.legend.P).toEqual({ blockId: 'grate' });
    const patched = JSON.parse(
      patchDef(
        gridText.replace('"legend"', '"hatchBlocks": {}, "requiredHatches": {}, "legend"'),
        grid,
        withSplit,
      ),
    );
    expect(patched.layers).toEqual(built.layers);
    expect(Object.keys(patched.legend)).toEqual(['d', 'P', 'l']);
    expect(patched.legend.d.hatches).toEqual(['dataAccess']);
  });

  it('are idempotent', () => {
    const once = patchDef(text, def, extras);
    const again = patchDef(once, JSON.parse(once), {
      ...extras,
      dataAccess: { chars: [], max: 1, split: [] },
    });
    expect(again).toBe(once);
    expect(withExtras(JSON.parse(once), { ...extras, dataAccess: { chars: [], max: 1, split: [] } })).toEqual(
      JSON.parse(once),
    );
  });

  it('remove what the sources no longer say', () => {
    const once = patchDef(text, def, extras);
    const none = patchDef(once, JSON.parse(once), {
      dataAccess: null,
      allowFaces: {},
      glassTierLimits: null,
    });
    const parsed = JSON.parse(none);
    expect(parsed.legend.A.allowFaces).toBeUndefined();
    expect(parsed.glassTierLimits).toBeUndefined();
    const built = withExtras(JSON.parse(once), { dataAccess: null, allowFaces: {}, glassTierLimits: null });
    expect(built.legend.A).toEqual(parsed.legend.A);
    expect(built.glassTierLimits).toBeUndefined();
  });

  it('leave a maximum out when the check has none', () => {
    const built = withExtras(def, { ...extras, dataAccess: { chars: ['d'], max: null, split: [] } });
    expect(built.requiredHatches.dataAccess).toEqual({ min: 0 });
  });
});
