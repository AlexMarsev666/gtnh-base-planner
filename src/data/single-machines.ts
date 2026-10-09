import machines from './single-machines.json' with { type: 'json' };
import registeredTiers from './single-tiers.generated.json' with { type: 'json' };
import { VOLTAGE_TIERS, type VoltageTier } from '../model/tiers';
import type { HatchKind } from '../model/multiblock/types';
import computing from './computation.rc2.generated.json';

/**
 * The GT single-block machines a template can show with their own look (src/data/single-machines.json): the
 * machine hull with the machine's front overlay. A site group of single blocks names its machine by `id`; the
 * atlas has the block `site.machine.<id>` for it (scripts/build-atlas.mjs).
 */
export interface SingleMachine {
  id: string;
  name: string;
  /** Names GTNH Planner calls it by (recipe map names, lower case). */
  names: string[];
}

export const SINGLE_MACHINES: readonly SingleMachine[] = machines;
export const DATA_ACCESS_HATCHES = registeredTiers.dataAccess;
export const DATA_INTERFACES = registeredTiers.dataInterfaces;

const byId = new Map(SINGLE_MACHINES.map((m) => [m.id, m]));
const byName = new Map(SINGLE_MACHINES.flatMap((m) => m.names.map((n) => [n, m] as const)));

/** Block id of a machine look (see `blockInfo`). */
export const singleMachineBlockId = (id: string): string => `site.machine.${id}`;

export function getSingleMachine(id: string): SingleMachine | undefined {
  return byId.get(id);
}

export function singleMachineTiers(id: string): VoltageTier[] {
  const indexes = (registeredTiers.tiers as Record<string, number[]>)[id] ?? [];
  return indexes.map((i) => VOLTAGE_TIERS[i]);
}

export function hatchTiers(kind: HatchKind): VoltageTier[] {
  if (kind === 'uncertainty')
    return computing.registrations.uncertainty.map((variant) => VOLTAGE_TIERS[variant.tier]);
  return ((registeredTiers.hatches as Partial<Record<HatchKind, number[]>>)[kind] ?? []).map(
    (i) => VOLTAGE_TIERS[i],
  );
}

/** The look for a machine type as GTNH Planner names it ("Macerator", "Gas Turbine"), or undefined. */
export function singleMachineForName(name: string): SingleMachine | undefined {
  return byName.get(name.trim().toLowerCase());
}
