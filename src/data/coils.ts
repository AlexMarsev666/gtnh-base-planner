import table from './coils.generated.json' with { type: 'json' };

/**
 * The heating coils GT registers (`HeatingCoilLevel`, the blocks that `implements IHeatingCoil`; read by
 * tools/gt-source/coils.mjs from GT5-Unofficial 5.09.54.205). A multiblock whose structure uses `ofCoil`
 * (`MultiblockDef.coils`) forms with any of them as long as all its coils are the same.
 */
export interface CoilInfo {
  /** Stable id (`kanthal`), what a plan or template group stores in `coil`. */
  id: string;
  /** Block of the coil in the catalog (`gregtech:gt.blockcasings5@1`). */
  blockId: string;
  /** Name GT shows for the coil level (`Kanthal`). */
  name: string;
  /** `HeatingCoilLevel.getHeat`; data only, the planner shows no heat. */
  heat: number;
}

/**
 * In GT's meta order, which share links index (append only). `table` is read-only data of the tool.
 */
export const COILS: readonly CoilInfo[] = table.map(({ id, blockId, name, heat }) => ({
  id,
  blockId,
  name,
  heat,
}));

/** The coils from the weakest to the strongest, for pickers. */
export const COILS_BY_HEAT: readonly CoilInfo[] = [...COILS].sort((a, b) => a.heat - b.heat);

/** The planner's own stand-in for a heating coil in a hand-made entry (see `src/data/blocks.ts`). */
const STAND_INS: readonly string[] = ['gt.coil.cupronickel'];

const BY_ID = new Map(COILS.map((c) => [c.id, c]));
const BLOCK_IDS = new Set([...COILS.map((c) => c.blockId), ...STAND_INS]);

/** The coil with this id, or undefined. */
export function coilById(id: string): CoilInfo | undefined {
  return BY_ID.get(id);
}

/** Whether a catalog block is a heating coil (one of the table or a stand-in). */
export function isCoilBlock(blockId: string): boolean {
  return BLOCK_IDS.has(blockId);
}
