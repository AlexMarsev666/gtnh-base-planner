import { TIERS, type Tier } from '../model/core/types';
import type { TransformerAmps } from '../model/site/types';
import machines from './single-machines.json' with { type: 'json' };

/**
 * The GT single-block machines a template can show with their own look (src/data/single-machines.json): the
 * machine hull with the machine's front overlay. A site group of single blocks names its machine by `id`; the
 * atlas has the block `site.machine.<id>` for it (scripts/build-atlas.mjs). Ids are saved in plans and links:
 * never rename or remove one.
 */
export interface SingleMachine {
  id: string;
  name: string;
  /** Names GTNH Planner calls it by (recipe map names, lower case). */
  names: string[];
  /** The lowest and highest tier GT registers the machine in (a transformer: its high side). */
  tiers: readonly [Tier, Tier];
  /** A transformer: the hull is the low side's tier and the overlays show both sides (see `transformerLook`). */
  transformer?: boolean;
}

export const SINGLE_MACHINES: readonly SingleMachine[] = machines as unknown as SingleMachine[];

const byId = new Map(SINGLE_MACHINES.map((m) => [m.id, m]));
const byName = new Map(SINGLE_MACHINES.flatMap((m) => m.names.map((n) => [n, m] as const)));

/** Block id of a machine look (see `blockInfo`). */
export const singleMachineBlockId = (id: string): string => `site.machine.${id}`;

export function getSingleMachine(id: string): SingleMachine | undefined {
  return byId.get(id);
}

/** The look for a machine type as GTNH Planner names it ("Macerator", "Gas Turbine"), or undefined. */
export function singleMachineForName(name: string): SingleMachine | undefined {
  return byName.get(name.trim().toLowerCase());
}

/** The tiers a machine exists in, lowest first; empty for an unknown id. */
export function singleMachineTiers(id: string): Tier[] {
  const m = byId.get(id);
  return m ? TIERS.slice(TIERS.indexOf(m.tiers[0]), TIERS.indexOf(m.tiers[1]) + 1) : [];
}

/** Tile-name part of a tier (`LuV` -> `LUV`), as in the files of tools/texture-sources. */
const tierTag = (tier: Tier): string => tier.toUpperCase();

/**
 * The hull tiles of a tier, named as in GT (`MACHINE_LuV_SIDE`). Every tier has them, ULV to MAX; the machine
 * overlay goes on the front.
 */
export function hullTiles(tier: Tier): { side: string; top: string; bottom: string } {
  return { side: `MACHINE_${tier}_SIDE`, top: `MACHINE_${tier}_TOP`, bottom: `MACHINE_${tier}_BOTTOM` };
}

/** Whether GT has a transformer of this high-side tier and low-side amperage: Hi-Amp (16) starts at UEV. */
export function transformerValid(high: Tier, amps: TransformerAmps): boolean {
  const i = TIERS.indexOf(high);
  return i >= TIERS.indexOf('LV') && (amps !== 16 || i >= TIERS.indexOf('UEV'));
}

/**
 * How a transformer looks, as GT draws it. `high` is the machine tier (its high side, LV to MAX); the hull is
 * the low side's tier (one below). `amps` is the low side's amperage, which picks the family: 4 plain (the
 * high side shows a single-amp hatch), 16 Hi-Amp (4-amp high side), 64 Power (16-amp high side). A step-down
 * transformer shows the high side's energy input on its front and the output of the low side on its other
 * faces; a step-up one shows the reverse. The tile names `SINGLE_TRANSFORMER_<IN|OUT>[_<n>A]_<TIER>` are the
 * files tools/game-dump/single-machines.mjs writes to tools/texture-sources.
 */
export function transformerLook(
  high: Tier,
  step: 'up' | 'down',
  amps: TransformerAmps = 4,
): { hull: Tier; front: string; sides: string } {
  const low = TIERS[Math.max(0, TIERS.indexOf(high) - 1)];
  const [front, sides] = step === 'down' ? ['IN', 'OUT'] : ['OUT', 'IN'];
  const highAmps = amps === 4 ? '' : `_${amps / 4}A`;
  return {
    hull: low,
    front: `SINGLE_TRANSFORMER_${front}${highAmps}_${tierTag(high)}`,
    sides: `SINGLE_TRANSFORMER_${sides}_${amps}A_${tierTag(low)}`,
  };
}
