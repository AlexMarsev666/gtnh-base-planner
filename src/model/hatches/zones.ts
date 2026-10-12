import zonesFile from '../../data/hatch-zones.generated.json';
import { key } from '../geometry';
import { flipCells, flipRule } from '../mirror';
import type { Vec3 } from '../core/types';
import type { MultiblockDef, ResizeRule } from '../multiblock/types';
import type { Site, ZonedDef } from './types';

/** Hatch zones of hand-made entries: where GT's hint dots mark which cells take which hatches. */

type Zones = NonNullable<MultiblockDef['zones']>;

const FILE = zonesFile as Record<string, { zones: Zones; cells: Record<string, string> }>;

const cache = new WeakMap<MultiblockDef, ZonedDef>();

/**
 * `cells` (local `x,y,z` of the smallest form) of a def resized to total size `n` along `rule.axis`, as
 * `sizedDef` builds it: cells past the repeating slab move by the inserted length, slab cells repeat in
 * every copy. Pure; a mirrored def can map its own cells with it before mirroring them.
 */
export function resizeZoneCells(
  cells: Readonly<Record<string, string>>,
  rule: ResizeRule,
  n: number,
): Record<string, string> {
  const a = ['x', 'y', 'z'].indexOf(rule.axis);
  const t = rule.to - rule.from;
  const copies = 1 + (n - rule.min) / t;
  const out: Record<string, string> = {};
  for (const [at, zone] of Object.entries(cells)) {
    const p = at.split(',').map(Number);
    const put = (i: number) => {
      const q = [...p];
      q[a] = i;
      out[q.join()] = zone;
    };
    if (p[a] < rule.from) put(p[a]);
    else if (p[a] >= rule.to) put(p[a] + (copies - 1) * t);
    else for (let c = 0; c < copies; c++) put(p[a] + c * t);
  }
  return out;
}

/**
 * The def with the hatch zones of its entry in `hatch-zones.generated.json` (`zones`, and `zoneCells` for
 * the cell of each; mapped through `resizeZoneCells` when the def is a resized form, also when it is a
 * resized copy of a def that already had them; for a mirror image (`ZonedDef.zoneMirrored`) the cells are
 * resized in the unflipped frame, then flipped at the sized size (`zoneFlipped` likewise for Y), so it does
 * not matter whether `sizedDef` or `orientedDef` came first). A def with `zones` and no `zoneCells` (generated entries,
 * whose cells carry `region: "dot<N>"`), one whose `zoneCells` fit its size, and one the file does not list
 * come back unchanged, so applying it twice is harmless. Legend chars and `region`s are left alone: one
 * char holds cells of several zones, and a region may already be in use (`requiredHatches.regions`).
 * Pure; the result is cached per def object.
 */
export function withHatchZones<T extends MultiblockDef>(def: T): T | ZonedDef {
  const zoned = def as ZonedDef;
  if (zoned.zoneCells ? !zoned.zoneSize || def.size.join() === zoned.zoneSize.join() : def.zones) return def;
  const entry = FILE[def.id];
  if (!entry) return def;
  let out = cache.get(def);
  if (!out) {
    // A flipped def's resize rule is seen from the other end; flipping the rule again gives the file's.
    const fx = !!zoned.zoneMirrored;
    const fy = !!zoned.zoneFlipped;
    const rule = def.resize ? flipRule(def.resize, fx, fy) : undefined;
    const n = rule ? def.size[['x', 'y', 'z'].indexOf(rule.axis)] : 0;
    let zoneCells = rule && n !== rule.min ? resizeZoneCells(entry.cells, rule, n) : entry.cells;
    if (fx || fy) zoneCells = flipCells(zoneCells, def.size, fx, fy);
    cache.set(def, (out = { ...def, zones: entry.zones, zoneCells, zoneSize: def.size }));
  }
  return out;
}

/** The zone of a hatch cell of `def` (local position, legend char `char`), if it has one. */
export function zoneOfCell(def: MultiblockDef, local: Vec3, char: string): string | undefined {
  return (def as ZonedDef).zoneCells?.[key(local)] ?? def.legend[char]?.region;
}

/** Marks a request zone that names a legend `region` (it is not a key of `def.zones`), see `resolveZone`. */
const REGION_ZONE = 'region:';

/**
 * A request's zone as placement matches it: a key of `def.zones` stays, any other name falls back to the legend
 * `region` of that name (e.g. a Distillation Tower's `layer1` or `top`).
 */
export function resolveZone(def: MultiblockDef, zone: string): string {
  return def.zones?.[zone] !== undefined ? zone : REGION_ZONE + zone;
}

/** Whether the cell of `site` lies, for unit `id`, in the zone `resolveZone` gave. */
export function inZone(site: Pick<Site, 'zones' | 'regions'>, id: number, zone: string): boolean {
  return zone.startsWith(REGION_ZONE)
    ? site.regions.get(id) === zone.slice(REGION_ZONE.length)
    : site.zones.get(id) === zone;
}
