import { coilById } from '../data/coils';
import type { MultiblockDef } from './multiblock/types';

const memo = new WeakMap<MultiblockDef, Map<string, MultiblockDef>>();

/**
 * `def` with the cells of its heating coil (`def.coils`) drawn with the coil `coil` (an id of `src/data/coils.ts`).
 * Memoised per definition and coil (so the per-def caches keep working); the def itself when `coil` is unset or
 * unknown, or the structure has no heating coil.
 */
export function withCoil(def: MultiblockDef, coil: string | undefined): MultiblockDef {
  const info = coil === undefined ? undefined : coilById(coil);
  if (!info || !def.coils) return def;
  const chars = def.coils.chars;
  if (chars.every((ch) => def.legend[ch]?.blockId === info.blockId)) return def;
  let variants = memo.get(def);
  if (!variants) memo.set(def, (variants = new Map()));
  let out = variants.get(info.id);
  if (!out) {
    const legend = { ...def.legend };
    for (const ch of chars) if (legend[ch]) legend[ch] = { ...legend[ch], blockId: info.blockId };
    variants.set(info.id, (out = { ...def, legend }));
  }
  return out;
}
