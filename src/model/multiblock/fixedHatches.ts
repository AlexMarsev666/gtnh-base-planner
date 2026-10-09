import type { HatchKind, LegendEntry, MultiblockDef } from './types';

/** Multi-kind mandatory cells need an explicit source review; dump placeholders alone are ambiguous. */
export function fixedHatchKinds(def: MultiblockDef, cell: LegendEntry | undefined): readonly HatchKind[] {
  if (cell?.requiredHatch) return cell.hatches ?? [];
  const kind = fixedHatchKind(def, cell);
  return kind ? [kind] : [];
}

export function hasAlternativeHatchCells(def: MultiblockDef, enabled?: readonly HatchKind[]): boolean {
  return Object.values(def.legend).some((cell) => {
    const kinds = fixedHatchKinds(def, cell);
    return kinds.length > 1 && (!enabled || kinds.some((kind) => enabled.includes(kind)));
  });
}

/** A hatch-only cell has a hatch placeholder as its block, not a casing fallback. */
export function fixedHatchKind(def: MultiblockDef, cell: LegendEntry | undefined): HatchKind | undefined {
  if (cell?.requiredHatch && cell.hatches?.length === 1) return cell.hatches[0];
  if (
    !cell ||
    cell.hatches?.length !== 1 ||
    !/^gt\.hatch\./.test(cell.blockId) ||
    cell.blockId === 'gt.hatch.special'
  )
    return undefined;
  return cell.hatches?.find((kind) => def.hatchBlocks[kind] === cell.blockId);
}

const cache = new WeakMap<MultiblockDef, Partial<Record<HatchKind, number>>>();
/** Count actual cells, so repeated sections and resized forms acquire the correct number of interfaces. */
export function fixedHatchCounts(def: MultiblockDef): Partial<Record<HatchKind, number>> {
  let counts = cache.get(def);
  if (!counts) {
    counts = {};
    for (const layer of def.layers)
      for (const row of layer)
        for (const char of row) {
          const kind = fixedHatchKind(def, def.legend[char]);
          if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
        }
    cache.set(def, counts);
  }
  return counts;
}
