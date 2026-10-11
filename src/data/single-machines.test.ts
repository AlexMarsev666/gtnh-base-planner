import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { TIERS } from '../model/core/types';
import { BLOCKS } from './blocks';
import {
  SINGLE_MACHINES,
  getSingleMachine,
  hullTiles,
  singleMachineBlockId,
  singleMachineForName,
  singleMachineTiers,
  transformerLook,
  transformerValid,
} from './single-machines';
import { catalog } from './catalog';
import { SINGLE_BLOCK_NAMES, multiblockForName } from './gtnhplanner-machines';
import textures from '../render/textures.json';

const manifest = textures as unknown as {
  tiles: Record<string, unknown>;
  blocks: Record<string, { side?: string; front?: string; flat?: boolean }>;
};

describe('single-block machine looks', () => {
  it('has a unique id and unique names for every machine', () => {
    expect(new Set(SINGLE_MACHINES.map((m) => m.id)).size).toBe(SINGLE_MACHINES.length);
    const names = SINGLE_MACHINES.flatMap((m) => m.names);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n, n).toBe(n.toLowerCase());
  });

  it('gives every machine a block with a textured hull and its own front', () => {
    for (const m of SINGLE_MACHINES) {
      const id = singleMachineBlockId(m.id);
      expect(BLOCKS[id]?.name, id).toBe(m.name);
      const faces = manifest.blocks[id];
      expect(faces?.flat, id).toBeUndefined();
      expect(manifest.tiles[faces?.side ?? ''], id).toBeDefined();
      expect(manifest.tiles[faces?.front ?? ''], id).toBeDefined();
    }
    // Machines do not all look alike.
    const fronts = new Set(SINGLE_MACHINES.map((m) => manifest.blocks[singleMachineBlockId(m.id)].front));
    expect(fronts.size).toBe(SINGLE_MACHINES.length);
  });

  it('finds a look by the names GTNH Planner uses, in any case', () => {
    expect(singleMachineForName('Macerator')?.id).toBe('macerator');
    expect(singleMachineForName(' Tank ')?.id).toBe('tank');
    expect(singleMachineForName('Gas Turbine')?.id).toBe('generator');
    expect(singleMachineForName('Wire Mill')?.id).toBe('wiremill');
    expect(singleMachineForName('Nothing Like It')).toBeUndefined();
    expect(getSingleMachine('macerator')?.name).toBe('Macerator');
    expect(getSingleMachine('nope')).toBeUndefined();
  });

  it('is what the import takes for a single-block machine, and never a catalog multiblock', () => {
    for (const m of SINGLE_MACHINES)
      for (const n of m.names) {
        expect(SINGLE_BLOCK_NAMES.has(n), n).toBe(true);
        expect(multiblockForName(n), n).toBeUndefined();
      }
  });

  it('reads the fuel cells of GT++ by the name the planner gives them', () => {
    expect(multiblockForName('Solid-Oxide Fuel Cell Mk I')).toBe('solid-oxide-fuel-cell-mk-i');
    expect(catalog.some((d) => d.id === 'solid-oxide-fuel-cell-mk-i')).toBe(true);
  });
  it('keeps every id of earlier versions, which saved plans and links name', () => {
    const early =
      'alloy-smelter amplifabricator arc-furnace assembler autoclave bender brewery canner centrifuge chemical-bath chemical-reactor circuit-assembler compressor cutting-machine distillery electric-furnace electrolyzer electromagnetic-polarizer electromagnetic-separator extractor extruder fermenter fluid-canner fluid-extractor fluid-heater fluid-solidifier forge-hammer forming-press laser-engraver lathe macerator mass-fabricator microwave mixer ore-washer packager plasma-arc-furnace printer pump recycler replicator rock-breaker scanner sifter thermal-centrifuge unpackager wiremill generator tank'.split(
        ' ',
      );
    expect(early).toHaveLength(49);
    for (const id of early) {
      expect(getSingleMachine(id), id).toBeDefined();
      expect(BLOCKS[singleMachineBlockId(id)], id).toBeDefined();
    }
  });
});

describe('single-block machine tiers', () => {
  it('gives every machine a range of tiers, as GT registers it', () => {
    for (const m of SINGLE_MACHINES) {
      const tiers = singleMachineTiers(m.id);
      expect(tiers.length, m.id).toBeGreaterThan(0);
      expect(tiers[0], m.id).toBe('LV');
    }
    expect(singleMachineTiers('macerator')).toEqual(TIERS.slice(1, 13));
    expect(singleMachineTiers('circuit-assembler').at(-1)).toBe('MAX');
    expect(singleMachineTiers('packager').at(-1)).toBe('UV');
    expect(singleMachineTiers('rock-breaker')).toEqual(['LV', 'MV', 'HV', 'EV', 'IV']);
    expect(singleMachineTiers('tank').at(-1)).toBe('IV');
    expect(singleMachineTiers('nope')).toEqual([]);
  });

  it('has a texture source for every hull tier and every transformer overlay', () => {
    const sources = join(__dirname, '../../tools/texture-sources');
    const has = (tile: string) => existsSync(join(sources, tile + '.png'));
    for (const tier of TIERS)
      for (const tile of Object.values(hullTiles(tier))) expect(has(tile), tile).toBe(true);
    for (const tier of singleMachineTiers('transformer'))
      for (const step of ['up', 'down'] as const) {
        const look = transformerLook(tier, step);
        expect(has(look.front), look.front).toBe(true);
        expect(has(look.sides), look.sides).toBe(true);
        for (const tile of Object.values(hullTiles(look.hull))) expect(has(tile), tile).toBe(true);
        for (const amps of [16, 64] as const) {
          const l = transformerLook(tier, step, amps);
          expect(has(l.front), l.front).toBe(true);
          expect(has(l.sides), l.sides).toBe(true);
        }
      }
  });

  it('draws a transformer as MTETransformer does', () => {
    expect(getSingleMachine('transformer')?.transformer).toBe(true);
    expect(singleMachineTiers('transformer')).toEqual(TIERS.slice(1));
    expect(transformerLook('HV', 'down')).toEqual({
      hull: 'MV',
      front: 'SINGLE_TRANSFORMER_IN_HV',
      sides: 'SINGLE_TRANSFORMER_OUT_4A_MV',
    });
    expect(transformerLook('LuV', 'up')).toEqual({
      hull: 'IV',
      front: 'SINGLE_TRANSFORMER_OUT_LUV',
      sides: 'SINGLE_TRANSFORMER_IN_4A_IV',
    });
    // Hi-Amp: 4A high side, 16A low side. Power: 16A high side, 64A low side.
    expect(transformerLook('UEV', 'down', 16)).toEqual({
      hull: 'UHV',
      front: 'SINGLE_TRANSFORMER_IN_4A_UEV',
      sides: 'SINGLE_TRANSFORMER_OUT_16A_UHV',
    });
    expect(transformerLook('MAX', 'up', 64)).toEqual({
      hull: 'UXV',
      front: 'SINGLE_TRANSFORMER_OUT_16A_MAX',
      sides: 'SINGLE_TRANSFORMER_IN_64A_UXV',
    });
  });

  it('allows Hi-Amp transformers from UEV up only', () => {
    expect(transformerValid('LV', 4)).toBe(true);
    expect(transformerValid('MAX', 64)).toBe(true);
    expect(transformerValid('UHV', 16)).toBe(false);
    expect(transformerValid('UEV', 16)).toBe(true);
    expect(transformerValid('MAX', 16)).toBe(true);
    expect(hullTiles('LuV').side).toBe('MACHINE_LuV_SIDE');
  });
});
