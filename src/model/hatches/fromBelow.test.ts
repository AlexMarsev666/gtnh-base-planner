import { describe, expect, it } from 'vitest';
import type { MultiblockDef } from './../multiblock/types';
import { routePipes } from '../routing/router';
import { packUnits } from '../layout/packer';
import { placeHatches } from './placement';
import { findSites } from './sites';

const free = { x: null, y: null, z: null };

/** A walled-in lowest layer: `W` has no open side but down; `C` is an ordinary wall. */
function box(legendW: MultiblockDef['legend']['W']): MultiblockDef {
  return {
    id: 'boxed',
    name: 'Boxed',
    size: [3, 2, 3],
    layers: [
      ['CCC', 'CWC', 'CCC'],
      ['CCC', 'C~C', 'CCC'],
    ],
    legend: { C: { blockId: 'casing', hatches: ['itemOut'] }, W: legendW },
    controller: { pos: [1, 1, 1], facing: 'north', blockId: 'controller' },
    hatchBlocks: { itemIn: 'bus', itemOut: 'bus' },
    shareableHatches: [],
    defaultHatches: ['itemIn', 'itemOut'],
    wallshare: false,
    requiredHatches: { itemIn: { min: 1 } },
  };
}

describe('fallback sites facing the ground', () => {
  it('offers a walled-in lowest-layer cell only to the kinds the def requires', () => {
    const def = box({ blockId: 'casing', hatches: ['itemIn', 'itemOut'] });
    const units = packUnits(def, 1, free).units;
    const site = findSites(def, units).sites.find((s) => s.fromBelow);
    expect(site?.pos).toEqual([1, 0, 1]);
    expect([...site!.kinds]).toEqual(['itemIn']);
    expect(site!.faces.map((f) => f.dir)).toEqual(['down']);
    expect(findSites(def, units, true).sites.some((s) => s.fromBelow)).toBe(false);
  });

  it('is used only after the normal sites, and marks the hatch', () => {
    const def = box({ blockId: 'casing', hatches: ['itemIn', 'itemOut'] });
    const units = packUnits(def, 1, free).units;
    // Normal casing cells take the bus: the fallback cell stays free.
    const walled = {
      ...def,
      legend: { ...def.legend, C: { blockId: 'casing', hatches: ['itemIn' as const] } },
    };
    const withWalls = placeHatches(walled, units, ['itemIn']);
    expect(withWalls.hatches).toHaveLength(1);
    expect(withWalls.hatches.some((h) => h.fromBelow)).toBe(false);
    const only = { ...def, legend: { ...def.legend, C: { blockId: 'casing' } } };
    const placed = placeHatches(only, units, ['itemIn', 'itemOut']);
    expect(placed.hatches).toEqual([
      { kind: 'itemIn', cell: [1, 0, 1], face: 'down', unitIds: [0], fromBelow: true },
    ]);
    expect(placed.unplaced).toEqual([{ unitId: 0, kind: 'itemOut' }]);
  });

  it('routing leaves such a hatch unconnected without a trench and does not crash', () => {
    const def = getMulti();
    const units = packUnits(def, 1, free).units;
    const placed = placeHatches(def, units, ['itemIn']).hatches;
    const nets = routePipes(def, units, placed, { kinds: ['itemIn'] });
    // Not a terminal without a trench: nothing to connect, nothing missing.
    expect(nets).toEqual([]);
    const below = placeHatches(def, units, ['itemIn'], undefined, { below: true }).hatches;
    const trench = routePipes(def, units, below, { kinds: ['itemIn'], below: true });
    expect(trench.map((n) => [n.connected, n.total])).toEqual([[1, 1]]);
  });
});

function getMulti(): MultiblockDef {
  const def = box({ blockId: 'casing', hatches: ['itemIn'] });
  return { ...def, legend: { ...def.legend, C: { blockId: 'casing' } } };
}
