import source from '../../data/computation.rc2.generated.json';
import type { HatchKind, MultiblockDef } from './types';
import type { SourceCountRule } from './rules';

export const COMPUTATION_HATCHES = source.registrations;
export const COMPUTATION_INPUTS: HatchKind[] = ['computationIn', 'wirelessComputationIn'];
export const COMPUTATION_OUTPUTS: HatchKind[] = ['computationOut', 'wirelessComputationOut'];
const RC2 = 'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/';
const definitions: Record<string, { source: string }> = {
  'dyson-swarm': source.dyson,
  'quantum-computer': source.quantum,
  'weighted-network-switch-with-qos': source.weighted,
  'static-network-switch-with-qos': source.static,
};
const ids = Object.keys(definitions);

export function computationCountRules(id: string): SourceCountRule[] {
  if (!ids.includes(id)) return [];
  return [
    ...(id === 'quantum-computer'
      ? [{ kind: 'uncertainty' as const, min: 1, helper: 'checkOneUncertaintyHatch: nonempty list' }]
      : []),
    ...(id === 'quantum-computer'
      ? []
      : [{ anyOf: COMPUTATION_INPUTS, min: 1, helper: 'checkHasDataInput: eInputData' }]),
    ...(id === 'dyson-swarm'
      ? []
      : [{ anyOf: COMPUTATION_OUTPUTS, min: 1, helper: 'checkHasDataOutput: eOutputData' }]),
  ].map((rule) => ({ ...rule, source: RC2 + definitions[id].source }));
}
const serviceBlocks = Object.fromEntries(
  Object.entries(COMPUTATION_HATCHES).map(([kind, variants]) => [
    kind,
    kind === 'uncertainty' ? 'gt.hatch.uncertainty' : `gregtech:gt.blockmachines@${variants[0].meta}`,
  ]),
) as Partial<Record<HatchKind, string>>;
const compose = (pieces: string[][]): string[][] =>
  Array.from({ length: pieces[0].length }, (_, y) => pieces.map((piece) => piece[y]));
const dataBlocks = Object.fromEntries(
  [...COMPUTATION_INPUTS, ...COMPUTATION_OUTPUTS].map((kind) => [kind, serviceBlocks[kind]]),
);

/** Retain source-distinct casing cells and end caps; identical textures do not imply identical adders. */
export function withComputation(def: MultiblockDef): MultiblockDef {
  if (!ids.includes(def.id)) return def;
  const power: HatchKind[] = ['energy', 'maintenance'];
  const dataKinds = [...COMPUTATION_INPUTS, ...COMPUTATION_OUTPUTS];
  if (def.id === 'dyson-swarm')
    return {
      ...def,
      source: RC2 + source.dyson.source,
      layers: source.dyson.layers,
      legend: { ...def.legend, R: { blockId: def.legend.C.blockId, hatches: COMPUTATION_INPUTS } },
      hatchBlocks: {
        ...def.hatchBlocks,
        computationIn: serviceBlocks.computationIn,
        wirelessComputationIn: serviceBlocks.wirelessComputationIn,
      },
      defaultHatches: [...def.defaultHatches, 'computationIn'],
    };
  if (def.id === 'quantum-computer')
    return {
      ...def,
      source: RC2 + source.quantum.source,
      size: [3, 4, source.quantum.min],
      layers: compose([
        source.quantum.pieces.front,
        source.quantum.pieces.cap,
        source.quantum.pieces.cap,
        source.quantum.pieces.back,
      ]),
      legend: {
        A: { blockId: 'tectech:gt.blockcasingsTT@1', hatches: [...power, ...dataKinds, 'uncertainty'] },
        B: { blockId: 'tectech:gt.blockcasingsTT@1' },
        C: { blockId: 'tectech:gt.blockcasingsTT@2' },
        D: { blockId: 'tectech:gt.blockcasingsTT@3' },
        E: { blockId: 'tectech:gt.blockcasingsTT@3', hatches: ['computerRack'] },
      },
      hatchBlocks: { ...def.hatchBlocks, ...serviceBlocks },
      resize: {
        axis: 'z',
        from: 2,
        to: 3,
        min: source.quantum.min,
        max: source.quantum.max,
        default: 5,
        label: 'length',
        section: { size: [3, 4, 1], layers: compose([source.quantum.pieces.slice]) },
      },
      defaultHatches: [...def.defaultHatches, 'computationOut', 'uncertainty', 'computerRack'],
    };
  if (def.id === 'weighted-network-switch-with-qos')
    return {
      ...def,
      source: RC2 + source.weighted.source,
      layers: source.weighted.layers,
      legend: {
        A: { blockId: 'tectech:gt.blockcasingsTT@3', hatches: [...power, ...dataKinds] },
        B: { blockId: 'tectech:gt.blockcasingsTT@1', hatches: [...power, ...COMPUTATION_OUTPUTS] },
      },
      hatchBlocks: { ...def.hatchBlocks, ...dataBlocks },
      defaultHatches: [...def.defaultHatches, 'computationIn', 'computationOut'],
    };
  return {
    ...def,
    source: RC2 + source.static.source,
    size: [3, 3, source.static.min],
    layers: compose([source.static.pieces.first, source.static.pieces.last]),
    legend: {
      A: { blockId: 'tectech:gt.blockcasingsTT@1', hatches: ['energy', 'dynamo', ...COMPUTATION_OUTPUTS] },
      B: { blockId: 'tectech:gt.blockcasingsTT@3' },
      C: { blockId: 'tectech:gt.blockcasingsTT@3', hatches: ['energy', 'dynamo', ...dataKinds] },
    },
    hatchBlocks: { ...def.hatchBlocks, ...dataBlocks },
    requiredHatches: { energy: { min: 1 } },
    resize: {
      axis: 'z',
      from: 1,
      to: 2,
      min: source.static.min,
      max: source.static.max,
      default: 3,
      label: 'length',
      section: { size: [3, 3, 1], layers: compose([source.static.pieces.middle]) },
    },
    defaultHatches: ['energy', 'computationIn', 'computationOut'],
  };
}
