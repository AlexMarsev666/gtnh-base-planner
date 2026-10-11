import { blockInfo } from '../data/blocks';
import type { TextureManifest } from '../render/detailed';
import textureManifest from '../render/textures.json';
import { TIERS, type Tier } from './core/types';
import type { HatchKind } from './multiblock/types';
import type { SceneModel } from './render/types';
import { isCable } from './routing/kinds';
import { hatchTier, planHatchKeys } from './tiers';

const TEXTURES = textureManifest as unknown as TextureManifest;

/**
 * The required-blocks list: what has to be gathered to build what the 3D view shows. Derived from the render
 * model, so shared walls count once, hatches replace casings, and pipes and cables appear only while they are
 * switched on.
 */

/** One line of the block list. */
export interface BomRow {
  /** Stable id for ticking the row off. */
  key: string;
  label: string;
  count: number;
  blockId: string;
  /** Hatch rows: the casing the hatch replaces and the hatch kind, for the icon. */
  baseBlockId?: string;
  hatchKind?: HatchKind;
  /** Hatches and buses come in any voltage tier (unless `tier` says which). */
  anyTier: boolean;
  /** Hatch rows with a chosen voltage tier: the row is for that tier only. */
  tier?: Tier;
}

/**
 * Voltage tiers of the machine's hatches (see `hatchTier`). The energy and dynamo hatches get `machineTier`
 * unless `hatchTiers` names them; other hatches are tiered only by `hatchTiers`. A hatch is found by its key:
 * `keyOf(hatch, index)` for `scene.hatches[index]`, else `hatchKeys[index]`, else the machine view's
 * `<kind>:<ordinal>` in the order of `scene.hatches`.
 */
export interface BomTiers {
  machineTier?: Tier;
  hatchTiers?: Record<string, Tier>;
  /** Keys parallel to `scene.hatches`. */
  hatchKeys?: readonly string[];
  keyOf?: (hatch: SceneModel['hatches'][number], index: number) => string;
}

/** What a pipe or cable network carries. */
export type IoClass = 'item' | 'fluid' | 'steam' | 'energy';

/** One line of the IO list: blocks of pipe or cable of one class. */
export interface IoRow {
  key: string;
  io: IoClass;
  count: number;
}

export interface Bom {
  blocks: BomRow[];
  io: IoRow[];
  /** Blocks in `blocks` (pipes and cables are counted apart). */
  totalBlocks: number;
}

const IO_ORDER: IoClass[] = ['item', 'fluid', 'steam', 'energy'];

/** Class of pipe a hatch kind's network is made of (cables for energy and dynamo). */
export function ioClass(kind: HatchKind): IoClass | null {
  if (isCable(kind)) return 'energy';
  if (kind === 'itemIn' || kind === 'itemOut') return 'item';
  if (kind === 'fluidIn' || kind === 'fluidOut') return 'fluid';
  if (kind === 'steamIn') return 'steam';
  return null;
}

const WORDS_KEPT_UPPER = new Set(['UV', 'LV', 'MV', 'HV', 'EV', 'IV', 'ZPM', 'UHV', 'UEV', 'PTFE', 'PBI']);

function titleCase(words: string[]): string {
  return words
    .filter(Boolean)
    .map((w) =>
      WORDS_KEPT_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ');
}

/** A readable name from an atlas tile name: `DUMP_BLOCK_COPPER` → "Copper Block". */
export function tileLabel(tile: string): string {
  let name = tile
    .replace(/__.*$/, '')
    .replace(/^DUMP_/, '')
    .replace(/^MACHINE_CASING_/, '');
  name = name.replace(/_TOP$/, '');
  // Colour codes (`_C8C8C8`) and a lone `_0` variant number say nothing to a person.
  const words = name.split('_').filter((w) => !(/^[0-9A-F]{6}$/i.test(w) && /\d/.test(w)) && w !== '0');
  if (words[0] === 'BLOCK' && words.length > 1) words.push(words.shift()!);
  return titleCase(words);
}

/** A readable name from a registry name: `gregtech:gt.blockcasings2@0` → "Gt Blockcasings2". */
function registryLabel(id: string): string {
  const tail = id.replace(/@\d+$/, '').split(':').pop() ?? id;
  return titleCase(tail.split(/[._\-\s]+/));
}

function isReadable(name: string, id: string): boolean {
  return name !== id && !/[:@]/.test(name);
}

/**
 * What a block is called in the list: the catalog name when it reads well, otherwise a name made from its
 * texture (the dump names many blocks by their raw registry id), otherwise from the id itself.
 */
export function blockLabel(id: string, manifest: TextureManifest = TEXTURES): string {
  const info = blockInfo(id);
  if (isReadable(info.name, id)) return info.name;
  const faces = manifest.blocks[id];
  const tile = faces?.side ?? faces?.top;
  if (tile) {
    const label = tileLabel(tile);
    if (label) return label;
  }
  return registryLabel(id);
}

/** Whether a block id is a hatch or bus that any voltage tier can stand in for. */
function isTiered(blockId: string): boolean {
  // Single-block machines come in every voltage tier as well.
  if (blockId.startsWith('site.machine.') || blockId === 'site.singleblock') return true;
  return blockId.startsWith('gt.hatch.') && blockId !== 'gt.hatch.maintenance';
}

const tierRank = (tier: Tier | undefined): number => (tier ? TIERS.indexOf(tier) + 1 : 0);

/** Blocks of the scene by kind, and the pipes and cables by class. */
export function requiredBlocks(
  scene: SceneModel,
  manifest: TextureManifest = TEXTURES,
  tiers?: BomTiers,
): Bom {
  interface Group {
    blockId: string;
    tier?: Tier;
    kind: 'controller' | 'casing' | 'hatch';
    count: number;
    baseBlockId?: string;
    hatchKind?: HatchKind;
  }
  // Tier of the hatch in each cell, when tiers are given.
  const cellTiers = new Map<string, Tier>();
  if (tiers) {
    const keys = tiers.hatchKeys ?? planHatchKeys(scene.hatches);
    scene.hatches.forEach((h, i) => {
      const key = tiers.keyOf ? tiers.keyOf(h, i) : keys[i];
      const tier = hatchTier(h.kind, key, tiers.machineTier, tiers.hatchTiers);
      if (tier) cellTiers.set(h.cell.join(','), tier);
      else cellTiers.delete(h.cell.join(','));
    });
  }
  const groups = new Map<string, Group>();
  for (const v of scene.voxels) {
    // Site ports mark where a resource enters or leaves the site; they are not blocks to build.
    if (!v.blockId || v.blockId.startsWith('site.port.')) continue;
    // Only hatches that come in any tier get one (not the maintenance hatch, not steam hatches).
    const tier =
      v.kind === 'hatch' && v.hatchKind !== 'steamIn' && isTiered(v.blockId)
        ? cellTiers.get(v.pos.join(','))
        : undefined;
    const groupKey = tier ? `${v.blockId}|${tier}` : v.blockId;
    const g = groups.get(groupKey);
    if (g) {
      g.count++;
      // A block that is a controller anywhere is listed as one.
      if (v.kind === 'controller') g.kind = 'controller';
    } else
      groups.set(groupKey, {
        blockId: v.blockId,
        tier,
        kind: v.kind,
        count: 1,
        baseBlockId: v.baseBlockId,
        hatchKind: v.hatchKind,
      });
  }

  // Ids sorted first so rows that merge (same name) keep the smallest id's key.
  const merged = new Map<string, BomRow & { kind: Group['kind'] }>();
  const byId = [...groups.values()].sort(
    (a, b) =>
      (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0) || tierRank(a.tier) - tierRank(b.tier),
  );
  for (const g of byId) {
    const name = blockLabel(g.blockId, manifest);
    const label = g.tier ? `${name} (${g.tier})` : name;
    const anyTier = isTiered(g.blockId);
    const id = `${label}|${anyTier}`;
    const row = merged.get(id);
    if (row) {
      row.count += g.count;
      if (g.kind === 'controller') row.kind = 'controller';
    } else
      merged.set(id, {
        key: g.tier ? `block:${g.blockId}@${g.tier}` : `block:${g.blockId}`,
        label,
        count: g.count,
        blockId: g.blockId,
        baseBlockId: g.baseBlockId,
        hatchKind: g.hatchKind,
        anyTier: g.tier ? false : anyTier,
        ...(g.tier ? { tier: g.tier } : {}),
        kind: g.kind,
      });
  }

  const rank = { controller: 0, casing: 1, hatch: 2 } as const;
  const sorted = [...merged.values()].sort(
    (a, b) => rank[a.kind] - rank[b.kind] || b.count - a.count || a.label.localeCompare(b.label),
  );
  const blocks: BomRow[] = sorted.map(({ kind: _kind, ...row }) => row);

  const lengths = new Map<IoClass, number>();
  for (const net of scene.pipes ?? []) {
    const cls = ioClass(net.kind);
    if (cls) lengths.set(cls, (lengths.get(cls) ?? 0) + net.length);
  }
  const io: IoRow[] = IO_ORDER.filter((c) => (lengths.get(c) ?? 0) > 0).map((c) => ({
    key: `io:${c}`,
    io: c,
    count: lengths.get(c)!,
  }));

  return { blocks, io, totalBlocks: blocks.reduce((n, r) => n + r.count, 0) };
}

/** How the list is ordered: by kind, then by amount (`grouped`), or purely by amount. */
export type SortMode = 'grouped' | 'most' | 'fewest';

export const SORT_MODES: readonly SortMode[] = ['grouped', 'most', 'fewest'];

/** The list ordered by `mode`; ties keep the grouped order. `grouped` is the order `requiredBlocks` returns. */
export function sortBom(bom: Bom, mode: SortMode): Bom {
  if (mode === 'grouped') return bom;
  const dir = mode === 'most' ? -1 : 1;
  // Array.prototype.sort is stable, so equal counts stay in the grouped order.
  const byCount = <T extends { count: number }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => dir * (a.count - b.count));
  return { ...bom, blocks: byCount(bom.blocks), io: byCount(bom.io) };
}

/** Whether `name` contains every word of `query`, ignoring case; an empty query matches everything. */
export function matchesQuery(name: string, query: string): boolean {
  const lower = name.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => lower.includes(w));
}

/** Unticked rows first, ticked ones last, each group keeping its order. */
export function tickedLast<T extends { key: string }>(rows: readonly T[], checked: ReadonlySet<string>): T[] {
  return [...rows.filter((r) => !checked.has(r.key)), ...rows.filter((r) => checked.has(r.key))];
}

/** How much of the list is ticked off, counted in blocks (a ticked row counts all of its blocks). */
export function progress(bom: Bom, checked: ReadonlySet<string>): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const r of [...bom.blocks, ...bom.io]) {
    total += r.count;
    if (checked.has(r.key)) done += r.count;
  }
  return { done, total };
}
