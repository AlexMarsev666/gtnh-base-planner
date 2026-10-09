import registrations from '../../data/single-tiers.generated.json';
import type { HatchKind } from './types';
import type { SourceCountRule } from './rules';

export const DATA_INPUT_KINDS: readonly HatchKind[] = [
  'dataAccess',
  'assemblyDataIn',
  'wirelessAssemblyDataIn',
];
export const DATA_OUTPUT_KINDS: readonly HatchKind[] = ['assemblyDataOut', 'wirelessAssemblyDataOut'];
export const DATA_INTERFACES = registrations.dataInterfaces;
export const dataInterfaceBlock = (kind: keyof typeof DATA_INTERFACES) =>
  `gregtech:gt.blockmachines@${DATA_INTERFACES[kind].meta}`;
const RC2_SOURCE =
  'https://github.com/GTNewHorizons/GT5-Unofficial/blob/a3e1e11241a814c9fa0dd0973d5699548428f689/src/main/java/';
const rules: Record<string, SourceCountRule[]> = {
  'data-bank': [
    {
      anyOf: [...DATA_INPUT_KINDS],
      min: 1,
      helper: 'checkMachine: eDataAccessHatches',
      source: RC2_SOURCE + 'tectech/thing/metaTileEntity/multi/MTEDataBank.java',
    },
    {
      anyOf: [...DATA_OUTPUT_KINDS],
      min: 1,
      helper: 'checkMachine: eStacksDataOutputs or eWirelessStacksDataOutputs',
      source: RC2_SOURCE + 'tectech/thing/metaTileEntity/multi/MTEDataBank.java',
    },
  ],
  'assembly-line': [
    {
      anyOf: [...DATA_INPUT_KINDS],
      max: 1,
      helper: 'checkMachine: mDataAccessHatches',
      source: RC2_SOURCE + 'gregtech/common/tileentities/machines/multi/MTEAssemblyLine.java',
    },
  ],
  'advanced-assembly-line': [
    {
      anyOf: [...DATA_INPUT_KINDS],
      max: 1,
      helper: 'checkMachine: mDataAccessHatches',
      source: RC2_SOURCE + 'ggfab/mte/MTEAdvAssLine.java',
    },
  ],
};
export const dataInterfaceCountRules = (id: string): readonly SourceCountRule[] => rules[id] ?? [];
