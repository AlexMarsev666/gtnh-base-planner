import { describe, expect, it } from 'vitest';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import { sizedDef } from '../model/resize';
import { catalog } from './catalog';
import generatedShapes from './gt-shapes.generated.json';

/**
 * Every hand-made catalog structure, cell by cell, against the StructureLib shape in GT5-Unofficial 5.09.54.205
 * (the version in GT:NH 2.9.0-RC-2). Entries built from the game dump (tools/game-dump) are the game's own
 * placement and are not listed here. Shapes and elements are copied from the Java sources linked in each JSON
 * `source`: which block each character is and which hatches (`buildHatchAdder(...).atLeast(...)`) may replace it.
 * The few entries still converted from the sources (tools/gt-source) bring their GT shape along in
 * gt-shapes.generated.json.
 */

type Cat =
  | { t: 'ctrl' | 'air' | 'any' | 'lavaOrAir' }
  | { t: 'casing'; block: string; hatches: HatchKind[] }
  | { t: 'hatchOnly'; kind: HatchKind }
  | { t: 'casingOrCoil'; block: string; hatches: HatchKind[] };

const casing = (block: string, ...hatches: HatchKind[]): Cat => ({ t: 'casing', block, hatches });
const hatchOnly = (kind: HatchKind): Cat => ({ t: 'hatchOnly', kind });
const [IB, OB, IH, OH, MA, EN, MU, DY, SI]: HatchKind[] = [
  'itemIn',
  'itemOut',
  'fluidIn',
  'fluidOut',
  'maintenance',
  'energy',
  'muffler',
  'dynamo',
  'steamIn',
];

/** Assembly Line slices, [layer from top][z]: first (controller), later, and the last one (output bus). */
const AL_FIRST = [
  [' ', 'e', ' '],
  ['~', 'l', 'G'],
  ['g', 'm', 'g'],
  ['b', 'i', 'b'],
];
const AL_LATER = [
  [' ', 'e', ' '],
  ['d', 'l', 'd'],
  ['g', 'm', 'g'],
  ['b', 'i', 'b'],
];
const AL_LAST = [
  [' ', 'e', ' '],
  ['d', 'l', 'd'],
  ['g', 'm', 'g'],
  ['B', 'i', 'B'],
];

/**
 * `transposed`: shape[layer from top][z][x] (StructureLib `transpose(...)`); else shape[z][row from top][x].
 * Resizable multiblocks give the shape as a function of their size (height / length).
 */
type Shape = string[][] | ((size: number) => string[][]);
const GT: Record<string, { transposed: boolean; shape: Shape; el: Record<string, Cat> }> = {
  'big-barrel-brewery': {
    transposed: false,
    shape: [
      ['BBB', 'BBB', 'B~B', 'BBB', 'C C'],
      ['BBB', 'A A', 'A A', 'BBB', '   '],
      ['BBB', 'BAB', 'BAB', 'BBB', 'C C'],
    ],
    el: {
      B: casing('gt.casing.reinforcedWooden', IB, OB, IH, OH, MA, EN),
      A: casing('glass'),
      C: casing('gt.frame.steel'),
    },
  },
  'bricked-blast-furnace': {
    transposed: true,
    shape: [
      ['ccc', 'c-c', 'ccc'],
      ['ccc', 'clc', 'ccc'],
      ['c~c', 'clc', 'ccc'],
      ['ccc', 'ccc', 'ccc'],
    ],
    el: { c: casing('gt.casing.firebricks'), l: { t: 'lavaOrAir' } },
  },
  // One Coke Oven Hatch type with three screwdriver modes.
  'coke-oven': {
    transposed: true,
    shape: [
      ['CCC', 'CCC', 'CCC'],
      ['C~C', 'C-C', 'CCC'],
      ['CCC', 'CCC', 'CCC'],
    ],
    el: { C: casing('gt.cokeOvenBrick', IB, OB, OH) },
  },
  'dissection-apparatus': {
    transposed: false,
    shape: [
      ['CCCCC', 'C   C', 'C   C', 'C   C', 'CC~CC'],
      ['CCCCC', ' BBB ', ' AAA ', ' BBB ', 'CCCCC'],
      ['CCCCC', ' BBB ', ' ABA ', ' BBB ', 'CCCCC'],
      ['CCCCC', ' BBB ', ' AAA ', ' BBB ', 'CCCCC'],
      ['CCCCC', 'C   C', 'C   C', 'C   C', 'CCCCC'],
    ],
    el: { C: casing('gt.casing.cleanStainless', IB, OB, MA, EN), B: casing('itemPipe'), A: casing('glass') },
  },
  // Base piece, three ring layers with an air core, and the top ring closed by a casing (height 5).
  'distillation-tower': {
    transposed: true,
    // Base, then STRUCTURE_PIECE_LAYER up to the top layer, whose centre is a casing.
    shape: (h) => [
      ['lll', 'lcl', 'lll'],
      ...Array.from({ length: h - 2 }, () => ['lll', 'l-l', 'lll']),
      ['b~b', 'bbb', 'bbb'],
    ],
    el: {
      b: casing('gt.casing.cleanStainless', EN, OB, IH, IB, MA),
      l: casing('gt.casing.cleanStainless', OH, EN, MA),
      c: casing('gt.casing.cleanStainless'),
    },
  },
  'electric-blast-furnace': {
    transposed: true,
    shape: [
      ['fff', 'fmf', 'fff'],
      ['CCC', 'C-C', 'CCC'],
      ['CCC', 'C-C', 'CCC'],
      ['b~b', 'bbb', 'bbb'],
    ],
    el: {
      f: casing('gt.casing.heatProof', OH),
      m: hatchOnly(MU),
      C: casing('coil'),
      b: casing('gt.casing.heatProof', IH, OH, IB, OB, MA, EN),
    },
  },
  'implosion-compressor': {
    transposed: true,
    shape: [
      ['CCC', 'CCC', 'CCC'],
      ['C~C', 'C-C', 'CCC'],
      ['CCC', 'CCC', 'CCC'],
    ],
    el: { C: casing('gt.casing.solidSteel', IB, OB, MA, EN, MU) },
  },
  'industrial-centrifuge': {
    transposed: false,
    shape: [
      [' CCC ', 'C   C', 'C   C', 'C   C', ' CCC '],
      [' AAA ', 'ACCCA', 'AC~CA', 'ACCCA', ' AAA '],
      ['  C  ', ' BBB ', 'CBBBC', ' BBB ', '  C  '],
      ['  C  ', ' BBB ', 'CBBBC', ' BBB ', '  C  '],
      [' AAA ', 'ACCCA', 'ACCCA', 'ACCCA', ' AAA '],
    ],
    el: {
      C: casing('gtpp.casing.centrifuge', IB, OB, MA, EN, MU, IH, OH),
      A: casing('gt.frame.eglinSteel'),
      B: casing('gtpp.casing.largeSieveGrate'),
    },
  },
  // `x`: a hatch, the casing, or the one required heating coil.
  'large-chemical-reactor': {
    transposed: true,
    shape: [
      ['ccc', 'cxc', 'ccc'],
      ['c~c', 'xPx', 'cxc'],
      ['ccc', 'cxc', 'ccc'],
    ],
    el: {
      c: casing('gt.casing.chemicallyInert', IH, OH, IB, OB, MA, EN),
      P: casing('gt.casing.ptfePipe'),
      x: { t: 'casingOrCoil', block: 'gt.casing.chemicallyInert', hatches: [IH, OH, IB, OB, MA, EN] },
    },
  },
  'large-heat-exchanger': {
    transposed: true,
    shape: [
      ['ccc', 'cCc', 'ccc'],
      ['ccc', 'cPc', 'ccc'],
      ['ccc', 'cPc', 'ccc'],
      ['c~c', 'cHc', 'ccc'],
    ],
    el: {
      c: casing('gt.casing.stableTitanium', IB, IH, OB, OH, MA),
      P: casing('gt.casing.titaniumPipe'),
      C: hatchOnly(OH),
      H: hatchOnly(IH),
    },
  },
  'multi-smelter': {
    transposed: true,
    shape: [
      ['ccc', 'cmc', 'ccc'],
      ['CCC', 'C-C', 'CCC'],
      ['b~b', 'bbb', 'bbb'],
    ],
    el: {
      c: casing('gt.casing.heatProof', MA),
      m: hatchOnly(MU),
      C: casing('coil'),
      b: casing('gt.casing.heatProof', MA, IB, OB, EN),
    },
  },
  'oil-cracking-unit': {
    transposed: true,
    shape: [
      ['lcmcr', 'lcmcr', 'lcmcr'],
      ['lc~cr', 'l---r', 'lcmcr'],
      ['lcmcr', 'lcmcr', 'lcmcr'],
    ],
    el: {
      c: casing('coil'),
      l: casing('gt.casing.cleanStainless', IH, EN, MA),
      r: casing('gt.casing.cleanStainless', OH, EN, MA),
      m: casing('gt.casing.cleanStainless', IH, IB, EN, MA),
    },
  },
  'pyrolyse-oven': {
    transposed: false,
    shape: [
      ['       ', '       ', ' F   F ', 'FBF FBF', 'DBD~DBD', 'GGGGGGG'],
      ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
      ['       ', '       ', ' C   C ', 'F FFF F', 'D     D', 'GCGGGCG'],
      ['       ', '       ', ' C   C ', 'F FFF F', 'D D D D', 'GCGGGCG'],
      [' E   E ', ' A   A ', ' A   A ', 'FAF FAF', 'DADDDAD', 'GGGGGGG'],
    ],
    el: {
      A: casing('gt.casing.steelPipe'),
      B: casing('gt.casing.steelFirebox'),
      C: casing('coil'),
      D: casing('gt.casing.pyrolyseOven'),
      E: casing('gt.frame.steel'),
      F: casing('gt.casing.pyrolyseOven', IB, IH, MU),
      G: casing('gt.casing.pyrolyseOven', OB, OH, EN, MA),
    },
  },
  'vacuum-freezer': {
    transposed: true,
    shape: [
      ['CCC', 'CCC', 'CCC'],
      ['C~C', 'C-C', 'CCC'],
      ['CCC', 'CCC', 'CCC'],
    ],
    el: { C: casing('gt.casing.frostProof', IH, OH, IB, OB, MA, EN) },
  },
  'steam-separator': {
    transposed: true,
    shape: [
      [' AAA ', 'AAAAA', 'AAAAA', 'AAAAA', ' AAA '],
      ['     ', ' ABA ', ' BDB ', ' ABA ', '     '],
      ['  A  ', ' ACA ', 'ACDCA', ' ACA ', '  A  '],
      [' A~A ', 'AABAA', 'ABDBA', 'AABAA', ' AAA '],
      [' AAA ', 'AAAAA', 'AAAAA', 'AAAAA', ' AAA '],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB, OH),
      B: casing('gt.casing.bronzeGearbox'),
      C: casing('gt.casing.bronzePipe'),
      D: casing('gt.casing.bronzeFirebox'),
    },
  },
  'steam-grinder': {
    transposed: false,
    shape: [
      [' A ', 'CAC', 'C~C', 'AAA'],
      ['ABA', 'A A', 'A A', 'AAA'],
      [' A ', 'CAC', 'CAC', 'AAA'],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB),
      B: casing('gt.casing.bronzeGearbox'),
      C: casing('gt.frame.bronze'),
    },
  },
  'steam-squasher': {
    transposed: false,
    shape: [
      ['CCC', 'C~C', 'CCC'],
      ['AAA', 'AAA', 'AAA'],
      ['   ', ' C ', 'AAA'],
      ['   ', ' C ', 'AAA'],
      ['EEE', 'EEE', 'AAA'],
      ['   ', '   ', 'AAA'],
      ['AAA', 'AAA', 'AAA'],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB),
      C: casing('gt.casing.bronzePipe'),
      E: casing('mc.ironBlock'),
    },
  },
  'steam-presser': {
    transposed: true,
    shape: [
      ['     ', '     ', '  B  ', '     ', '     '],
      ['     ', '  A  ', 'AABAA', '  A  ', '     '],
      ['     ', '     ', 'A C A', '     ', '     '],
      ['     ', '     ', 'A C A', '     ', '     '],
      ['     ', '     ', 'A   A', '     ', '     '],
      ['     ', ' A~A ', 'AA AA', ' AAA ', '     '],
      [' AAA ', 'AAAAA', 'AAAAA', 'AAAAA', ' AAA '],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB),
      B: casing('gt.casing.bronzePipe'),
      C: casing('mc.ironBlock'),
    },
  },
  'steam-hearth': {
    transposed: true,
    shape: [
      [' B ', 'B B', ' B '],
      ['A~A', 'D D', 'ADA'],
      ['ACA', 'CAC', 'ACA'],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB),
      B: casing('gt.casing.bronzeGearbox'),
      C: casing('gt.casing.bronzePipe'),
      D: casing('gt.casing.bronzeFirebox'),
    },
  },
  'steam-blender': {
    transposed: true,
    shape: [
      ['     ', '  A  ', ' ABA ', '  A  ', '     '],
      ['  A  ', '     ', 'A C A', '     ', '  A  '],
      [' A~A ', 'A D A', 'ADBDA', 'A D A', ' AAA '],
      [' AAA ', 'AAAAA', 'AAAAA', 'AAAAA', ' AAA '],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB, OH, IH),
      B: casing('gt.casing.bronzeGearbox'),
      C: casing('gt.casing.bronzePipe'),
      D: casing('gt.frame.bronze'),
    },
  },
  'steam-purifier': {
    transposed: true,
    shape: [
      ['         ', '         ', ' CCCCCC  ', '         ', '         '],
      ['         ', '         ', ' C    C  ', '         ', '         '],
      ['     AAA ', '    A   A', ' C  A C A', '    A   A', '     AAA '],
      ['    ADDDA', 'AAA D   D', 'AAA D C D', 'AAA D   D', '    ADDDA'],
      ['    ADDDA', 'A~A DEEED', 'AAA DECED', 'AAA DEEED', '    ADDDA'],
      ['    AAAAA', 'AAA ABBBA', 'AAA ABABA', 'AAA ABBBA', '    AAAAA'],
    ],
    el: {
      A: casing('gt.casing.bronzePlated', SI, IB, OB, IH),
      B: casing('gt.casing.bronzeGearbox'),
      C: casing('gt.casing.bronzePipe'),
      D: casing('glass'),
      E: { t: 'lavaOrAir' },
    },
  },
  'steam-fuser': {
    transposed: true,
    shape: [
      ['CCC', 'CCC', 'CCC', 'CCC'],
      ['C~C', 'GPG', 'GPG', 'CCC'],
      ['CCC', 'CCC', 'CCC', 'CCC'],
    ],
    el: {
      C: casing('gt.casing.bronzePlated', SI, IB, OB),
      P: casing('gt.casing.bronzePipe'),
      G: casing('glass'),
    },
  },
  'large-steam-turbine': {
    transposed: false,
    shape: [
      ['---', '---', '---'],
      ['CCC', 'C~C', 'CCC'],
      [' B ', 'BAB', ' B '],
      [' B ', 'BAB', ' B '],
      ['AEA', 'EAE', 'AEA'],
      ['AEA', 'EAE', 'AEA'],
      ['B B', 'BDB', 'B B'],
    ],
    el: {
      C: casing('gt.casing.turbine'),
      B: casing('gt.frame.iron'),
      A: casing('gt.casing.steelPipe'),
      D: hatchOnly(DY),
      E: casing('gt.casing.turbine', MA, IH, OH, OB, IB),
    },
  },
  'large-gas-turbine': {
    transposed: false,
    shape: [
      ['---', '---', '---'],
      ['CCC', 'C~C', 'CCC'],
      [' B ', 'BAB', ' B '],
      [' B ', 'BAB', ' B '],
      ['AEA', 'EAE', 'AEA'],
      ['AEA', 'EAE', 'AEA'],
      ['B B', 'BDB', 'B B'],
    ],
    el: {
      C: casing('gt.casing.turbineStainless'),
      B: casing('gt.frame.stainless'),
      A: casing('itemPipe'),
      D: hatchOnly(DY),
      E: casing('gt.casing.turbineStainless', MA, IH, OH, OB, IB, MU),
    },
  },
  'large-hp-steam-turbine': {
    transposed: false,
    shape: [
      ['---', '---', '---'],
      ['CCC', 'C~C', 'CCC'],
      [' B ', 'BAB', ' B '],
      [' B ', 'BAB', ' B '],
      ['AEA', 'EAE', 'AEA'],
      ['AEA', 'EAE', 'AEA'],
      ['B B', 'BDB', 'B B'],
    ],
    el: {
      C: casing('gt.casing.turbineTitanium'),
      B: casing('gt.frame.titanium'),
      A: casing('gt.casing.titaniumPipe'),
      D: hatchOnly(DY),
      E: casing('gt.casing.turbineTitanium', MA, IH, OH, OB, IB),
    },
  },
  'large-supercritical-steam-turbine': {
    transposed: false,
    shape: [
      ['---', '---', '---'],
      ['CCC', 'C~C', 'CCC'],
      [' B ', 'BAB', ' B '],
      [' B ', 'BAB', ' B '],
      ['AEA', 'EAE', 'AEA'],
      ['AEA', 'EAE', 'AEA'],
      ['B B', 'BDB', 'B B'],
    ],
    el: {
      C: casing('gt.casing.turbineSC'),
      B: casing('gt.frame.pbi'),
      A: casing('gt.casing.pbiPipe'),
      D: hatchOnly(DY),
      E: casing('gt.casing.turbineSC', MA, IH, OH, OB, IB),
    },
  },
  'large-plasma-turbine': {
    transposed: false,
    shape: [
      ['---', '---', '---'],
      ['CCC', 'C~C', 'CCC'],
      [' B ', 'BAB', ' B '],
      [' B ', 'BAB', ' B '],
      ['AEA', 'EAE', 'AEA'],
      ['AEA', 'EAE', 'AEA'],
      ['B B', 'BDB', 'B B'],
    ],
    el: {
      C: casing('gt.casing.turbineTungstensteel'),
      B: casing('gt.frame.tungstensteel'),
      A: casing('gt.casing.tungstensteelPipe'),
      D: hatchOnly(DY),
      E: casing('gt.casing.turbineTungstensteel', MA, IH, OH, OB, IB),
    },
  },
  'large-combustion-engine': {
    transposed: false,
    shape: [
      ['   ---- ', '   ---- ', '        '],
      ['EBECCCCE', 'E~ECCCCE', 'EDEDDDDE'],
      ['EBEFFFFE', 'DBBAAAAG', 'DDDDDDDD'],
      ['EBEBBBBE', 'EBEFFFFE', 'EDEDDDDE'],
    ],
    el: {
      A: casing('gt.casing.titaniumGearbox'),
      B: casing('gt.casing.stableTitanium', MA, MU),
      C: casing('gt.casing.engineIntake'),
      D: casing('gt.casing.chemicallyInert'),
      E: casing('gt.frame.ptfe'),
      F: casing('gt.casing.stableTitanium', IH),
      G: hatchOnly(DY),
    },
  },
  'extreme-combustion-engine': {
    transposed: false,
    shape: [
      ['          ', '    H    H', 'H H H    H', 'H H H    H', 'FEFEFEEEEF'],
      ['    H----H', 'H H CGGGGC', 'CCC CDDDDC', 'C~C CBBBBC', 'FEFEFEEEEF'],
      ['    H----H', 'H H CGGGGC', 'CCCAAAAAAI', 'CCC CBBBBC', 'FEFEFEEEEF'],
      ['    H----H', 'H H CGGGGC', 'CCC CDDDDC', 'CCC CBBBBC', 'FEFEFEEEEF'],
      ['          ', '    H    H', 'H H H    H', 'H H H    H', 'FEFEFEEEEF'],
    ],
    el: {
      A: casing('gt.casing.steelGearbox'),
      B: casing('gt.casing.tungstensteelFirebox'),
      C: casing('gt.casing.robustTungstensteel', MU, MA),
      D: casing('gt.casing.turbineTungstensteel', IH),
      E: casing('gt.casing.chemicallyInert'),
      F: casing('gt.casing.ptfePipe'),
      G: casing('gt.casing.extremeEngineIntake'),
      H: casing('gt.frame.ptfe'),
      I: hatchOnly(DY),
    },
  },
  'large-semifluid-generator': {
    transposed: true,
    shape: [
      ['III', 'CCC', 'CCC', 'CCC'],
      ['I~I', 'CGC', 'CGC', 'CMC'],
      ['III', 'CCC', 'CCC', 'CCC'],
    ],
    el: {
      C: casing('gt.casing.stableTitanium', MU, IH, MA),
      G: casing('gt.casing.steelGearbox'),
      I: casing('gt.casing.engineIntake'),
      M: hatchOnly(DY),
    },
  },
  'assembly-line': {
    transposed: true,
    shape: (n) =>
      Array.from({ length: 4 }, (_, layer) =>
        Array.from({ length: 3 }, (_, z) =>
          [AL_FIRST, ...Array.from({ length: n - 2 }, () => AL_LATER), AL_LAST]
            .map((s) => s[layer][z])
            .join(''),
        ),
      ),
    el: {
      G: casing('gt.casing.grate'),
      d: casing('gt.casing.grate'),
      l: casing('gt.casing.assembler'),
      m: casing('gt.casing.assemblyLine'),
      g: casing('glass'),
      e: casing('gt.casing.solidSteel', EN),
      b: casing('gt.casing.solidSteel', IH, MA),
      B: casing('gt.casing.solidSteel', IH, MA, OB),
      i: casing('gt.hatch.inputBus'),
    },
  },
  'large-fluid-extractor': {
    transposed: true,
    shape: [
      ['     ', ' ccc ', ' ccc ', ' ccc ', '     '],
      ['     ', ' f f ', '  s  ', ' f f ', '     '],
      ['     ', ' f f ', '  s  ', ' f f ', '     '],
      ['     ', ' f f ', '  s  ', ' f f ', '     '],
      ['ccccc', 'ccccc', 'ccscc', 'ccccc', 'ccccc'],
      ['fgggf', 'ghhhg', 'ghshg', 'ghhhg', 'fgggf'],
      ['fgggf', 'ghhhg', 'ghshg', 'ghhhg', 'fgggf'],
      ['fgggf', 'ghhhg', 'ghshg', 'ghhhg', 'fgggf'],
      ['cc~cc', 'ccccc', 'ccccc', 'ccccc', 'ccccc'],
    ],
    el: {
      c: casing('gt.casing.robustTungstensteel', IB, OB, OH, EN, MA),
      g: casing('glass'),
      h: casing('coil'),
      s: casing('gt.coil.solenoid'),
      f: casing('gt.frame.blackSteel'),
    },
  },
  'industrial-autoclave': {
    transposed: true,
    shape: [
      ['  AAA  ', '  AFA  ', '  AFA  ', '  AFA  ', '  AFA  ', '  AFA  ', '  AFA  ', '  AFA  ', '  AAA  '],
      [' ABBBA ', ' AA AA ', ' A   A ', ' A   A ', ' A   A ', ' A   A ', ' A   A ', ' AA AA ', ' ABBBA '],
      ['ABBBBBA', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'ABBBBBA'],
      ['ABBBBBA', 'ACDEDCA', 'ACDEDCA', 'ACDEDCA', 'ACDEDCA', 'ACDEDCA', 'ACDEDCA', 'ACDEDCA', 'ABBBBBA'],
      ['ABBBBBA', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'A C C A', 'ABBBBBA'],
      ['AABBBAA', ' AA AA ', ' A   A ', ' A   A ', ' A   A ', ' A   A ', ' A   A ', ' AA AA ', 'AABBBAA'],
      ['A A~A A', '  AAA  ', '  AAA  ', '  AAA  ', '  AAA  ', '  AAA  ', '  AAA  ', '  AAA  ', 'A AAA A'],
    ],
    el: {
      A: casing('gt.casing.pressureContainment', IB, OB, IH, OH, MA, EN),
      B: casing('glass'),
      C: casing('gt.frame.ptfe'),
      D: casing('gt.casing.bronzePipe'),
      E: casing('itemPipe'),
      F: casing('coil'),
    },
  },
  'turbocan-pro': {
    transposed: true,
    shape: [
      ['  AAA  ', ' AAAAA ', 'AAAAAAA', 'AAAAAAA', 'AAAAAAA', ' AAAAA ', '  AAA  '],
      ['       ', '  B B  ', ' BAAAB ', '  A A  ', ' BAAAB ', '  B B  ', '       '],
      ['       ', '  B B  ', ' BA~AB ', '  A A  ', ' BAAAB ', '  B B  ', '       '],
      ['       ', '  B B  ', ' BAAAB ', '  A A  ', ' BAAAB ', '  B B  ', '       '],
      ['  AAA  ', ' AAAAA ', 'AAAAAAA', 'AAAAAAA', 'AAAAAAA', ' AAAAA ', '  AAA  '],
    ],
    el: { A: casing('gt.casing.solidSteel', IB, OB, MA, EN, IH, OH), B: casing('gt.casing.steelPipe') },
  },
};

/** Tiered blocks: any tier is fine, the catalog shows one. */
const ALIAS: Record<string, string> = {
  'gt.glass.reinforced': 'glass',
  'gt.coil.cupronickel': 'coil',
  'gt.casing.itemPipeTin': 'itemPipe',
};

function gtCells(transposed: boolean, shape: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  shape.forEach((outer, i) =>
    outer.forEach((row, j) =>
      [...row].forEach((ch, a) => {
        // StructureLib's first axis runs to the right of a controller seen from the front: west (-x) for one
        // facing north. The catalog's x runs east, so the shape is mirrored.
        const x = row.length - 1 - a;
        // transposed: i = layer from the top, j = z; else i = z, j = row from the top.
        const [y, z] = transposed ? [shape.length - 1 - i, j] : [outer.length - 1 - j, i];
        out.set(`${x},${y},${z}`, ch);
      }),
    ),
  );
  return out;
}

function gtCat(ch: string, el: Record<string, Cat>): Cat {
  if (ch === '~') return { t: 'ctrl' };
  if (ch === '-') return { t: 'air' };
  if (ch === ' ') return { t: 'any' };
  return el[ch];
}

function ourCat(ch: string, def: MultiblockDef): Cat {
  if (ch === '~') return { t: 'ctrl' };
  if (ch === '-') return { t: 'air' };
  if (ch === ' ') return { t: 'any' };
  const e = def.legend[ch];
  if (e.blockId.startsWith('gt.hatch.') && e.hatches) return hatchOnly(e.hatches[0]);
  return casing(ALIAS[e.blockId] ?? e.blockId, ...(e.hatches ?? []));
}

const sorted = (h: HatchKind[]) => [...h].sort();

function sameCell(gt: Cat, ours: Cat): boolean {
  if (gt.t === 'lavaOrAir') return ours.t === 'air';
  if (gt.t === 'casingOrCoil')
    return (
      (ours.t === 'casing' && ours.block === 'coil' && ours.hatches.length === 0) ||
      (ours.t === 'casing' &&
        ours.block === gt.block &&
        sorted(ours.hatches).join() === sorted(gt.hatches).join())
    );
  if (gt.t === 'casing')
    return (
      ours.t === 'casing' &&
      ours.block === gt.block &&
      sorted(ours.hatches).join() === sorted(gt.hatches).join()
    );
  if (gt.t === 'hatchOnly') return ours.t === 'hatchOnly' && ours.kind === gt.kind;
  return ours.t === gt.t;
}

Object.assign(GT, generatedShapes as unknown as typeof GT);

describe('catalog structures match GT5-Unofficial', () => {
  const checked = catalog.filter((d) => !d.generated || d.id in generatedShapes);

  it('has a GT shape for every hand-made multiblock', () => {
    expect(checked.map((d) => d.id).sort()).toEqual(Object.keys(GT).sort());
  });

  for (const raw of checked) {
    const r = raw.resize;
    const sizes = r ? [...new Set([r.min, r.default, r.max])] : [undefined];
    for (const size of sizes)
      it(size === undefined ? raw.id : `${raw.id} (${r!.label} ${size})`, () => {
        const def = sizedDef(raw, size);
        const { transposed, shape, el } = GT[def.id];
        const gt = gtCells(transposed, typeof shape === 'function' ? shape(size!) : shape);
        const ours = new Map<string, string>();
        def.layers.forEach((layer, y) =>
          layer.forEach((row, z) => [...row].forEach((ch, x) => ours.set(`${x},${y},${z}`, ch))),
        );
        expect([...ours.keys()].sort()).toEqual([...gt.keys()].sort());
        const wrong = [...ours].filter(([k, ch]) => !sameCell(gtCat(gt.get(k)!, el), ourCat(ch, def)));
        expect(wrong.map(([k, ch]) => `${k}: "${ch}" vs GT "${gt.get(k)}"`)).toEqual([]);
      });
  }
});
