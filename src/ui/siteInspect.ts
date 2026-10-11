import { PLACEHOLDER_ID, SINGLE_BLOCK_ID } from '../data/generic';
import {
  SINGLE_MACHINES,
  type SingleMachine,
  singleMachineTiers,
  transformerValid,
} from '../data/single-machines';
import { TIERS, type Tier } from '../model/core/types';
import { withHatchZones } from '../model/hatches/zones';
import type { HatchKind, MultiblockDef } from '../model/multiblock/types';
import type { SiteWarning } from '../model/site/buildTypes';
import type { Demand, SiteHatch } from '../model/site/group';
import {
  TRANSFORMER_AMPS,
  type HatchAssign,
  type RoutingDepth,
  type SiteGroup,
  type SiteRouting,
  type SiteState,
  type TransformerAmps,
} from '../model/site/types';
import { groupHatchKeys } from '../model/site/siteScene';
import { allowedTiers, hasNoResource } from '../model/tiers';
import { effectiveRouting } from '../share/siteCodec';

/* Pure helpers behind the template panel's routing block and the group editor. */

export const ROUTING_DEPTHS: readonly RoutingDepth[] = [0, 1, 2, 3];

/**
 * What the Routing block shows: the routing in effect and, for a template saved before routing was a setting
 * of the template (no `routing`), the offer to switch to neat routing at the depth it has now (at least 1).
 */
export function routingView(
  site: Pick<SiteState, 'routing'>,
  connectBelow: boolean,
): { routing: SiteRouting; legacy: boolean; neatOffer: SiteRouting } {
  const routing = effectiveRouting(site, connectBelow);
  return {
    routing,
    legacy: site.routing === undefined,
    neatOffer: { style: 'neat', depth: (routing.depth || 1) as RoutingDepth },
  };
}

/** Whether the build used less underground depth than asked (the grid would have been too big). */
export const depthReduced = (asked: number, used: number): boolean => used < asked;

/** Tiers the group's machine can be set to (single blocks: those of their machine type), empty without any. */
export function groupTiers(group: Pick<SiteGroup, 'machine'>, def: MultiblockDef | undefined): Tier[] {
  return def ? allowedTiers(def, group.machine) : [];
}

/** Whether mirroring and wall sharing mean something for the group (real multiblocks only). */
export const hasStructure = (def: MultiblockDef | undefined): boolean =>
  !!def && def.id !== SINGLE_BLOCK_ID && def.id !== PLACEHOLDER_ID;

/** Single-block machines whose name or any GTNH Planner name contains `query` (case-insensitive), by name. */
export function matchMachines(
  query: string,
  machines: readonly SingleMachine[] = SINGLE_MACHINES,
): SingleMachine[] {
  const q = query.trim().toLowerCase();
  const out = q
    ? machines.filter((m) => m.name.toLowerCase().includes(q) || m.names.some((n) => n.includes(q)))
    : [...machines];
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Choices for a transformer's low-side amperage; Hi-Amp (16) does not exist below a UEV high side. */
export function ampOptions(high: Tier | undefined): { amps: TransformerAmps; disabled: boolean }[] {
  return TRANSFORMER_AMPS.map((amps) => ({ amps, disabled: !!high && !transformerValid(high, amps) }));
}

/** Tiers a transformer's high side can take. */
export function transformerTiers(machine: string): Tier[] {
  return singleMachineTiers(machine).filter((x) => TIERS.indexOf(x) >= TIERS.indexOf('LV'));
}

/** Choices for a resource's unit: Auto, All units, then Unit 1..N (N = the group's count). */
export function unitChoices(count: number): { value: string; unit: HatchAssign['unit'] }[] {
  return [
    { value: '', unit: undefined },
    { value: 'all', unit: 'all' },
    ...Array.from({ length: count }, (_, i) => ({ value: String(i), unit: i })),
  ];
}

/** The select value of an assigned unit; one past the group's units still shows (it is reported as a problem). */
export const unitValue = (a: HatchAssign | undefined): string =>
  a?.unit === undefined ? '' : String(a.unit);

/** First line of a zone's tooltip, cut to `max` characters. */
function zoneTitle(text: string | undefined, max = 44): string {
  const line = (text ?? '').split('\n')[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Zones a resource's hatch can be put into: the zones of the multiblock that take its kind (with the first
 * line of their tooltip), then the legend regions that are no zone (the required regions, such as a
 * Distillation Tower's `layer1`). `current` is kept in the list so a chosen zone never disappears.
 */
export function zoneChoices(
  def: MultiblockDef,
  kind: HatchKind,
  current?: string,
): { value: string; label: string }[] {
  const zoned = withHatchZones(def);
  const out: { value: string; label: string }[] = [];
  for (const [zone, z] of Object.entries(zoned.zones ?? {})) {
    if (!z.kinds.includes(kind)) continue;
    const title = zoneTitle(z.text);
    out.push({ value: zone, label: title ? `${zone}: ${title}` : zone });
  }
  const regions = new Set<string>();
  for (const e of Object.values(zoned.legend))
    if (e.region && zoned.zones?.[e.region] === undefined) regions.add(e.region);
  for (const r of [...regions].sort()) out.push({ value: r, label: r });
  if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: current });
  return out;
}

/** A resource the group takes or gives, with the hatch kind that carries it. */
export interface GroupResource {
  kind: HatchKind;
  resource: string;
}

/** The group's demanded resources in demand order (kinds in their order, resources sorted by the build). */
export function groupResources(demand: Demand): GroupResource[] {
  return (Object.entries(demand) as [HatchKind, string[] | undefined][]).flatMap(([kind, list]) =>
    (list ?? []).map((resource) => ({ kind, resource })),
  );
}

/** One hatch of a group in the tier list, with its `SiteGroup.hatchTiers` key. */
export interface GroupHatchRow {
  key: string;
  kind: HatchKind;
  resource?: string;
  /** Unit index in the group, or `shared` for a hatch serving several. */
  unit: number | 'shared';
}

/**
 * The hatches of a group that can have a tier, keyed as `groupHatchKeys` says. `unitIds` are the group's unit
 * ids in order. Duplicates (a resource split over hatches of one unit) share a key and one row.
 */
export function groupHatchRows(
  hatches: readonly Pick<SiteHatch, 'kind' | 'resource' | 'unitIds'>[],
  unitIds: readonly number[],
): GroupHatchRow[] {
  const keys = groupHatchKeys(hatches, unitIds);
  const rows = new Map<string, GroupHatchRow>();
  hatches.forEach((h, i) => {
    if (h.kind === 'maintenance' || h.kind === 'steamIn' || rows.has(keys[i])) return;
    const shared = h.unitIds.length > 1 || unitIds.indexOf(h.unitIds[0]) < 0;
    rows.set(keys[i], {
      key: keys[i],
      kind: h.kind,
      ...(h.resource !== undefined && !hasNoResource(h.kind) ? { resource: h.resource } : {}),
      unit: shared ? 'shared' : unitIds.indexOf(h.unitIds[0]),
    });
  });
  return [...rows.values()];
}

/** How many entries of `SiteGroup.hatchTiers` name no hatch of the group (e.g. after the count was lowered). */
export function unmatchedGroupTiers(
  hatchTiers: Readonly<Record<string, unknown>> | undefined,
  hatches: readonly Pick<SiteHatch, 'kind' | 'resource' | 'unitIds'>[],
  unitIds: readonly number[],
): number {
  const keys = new Set(groupHatchKeys(hatches, unitIds));
  return Object.keys(hatchTiers ?? {}).filter((k) => !keys.has(k)).length;
}

/** Warnings that only inform: a net whose voltage is unknown is not wrong. */
const INFO_WARNINGS: ReadonlySet<SiteWarning['type']> = new Set(['powerUnknownTier']);

/** The build's warnings split into problems and information (the notes of the groups are information too). */
export function splitWarnings(warnings: readonly SiteWarning[]): {
  problems: SiteWarning[];
  info: SiteWarning[];
} {
  return {
    problems: warnings.filter((w) => !INFO_WARNINGS.has(w.type)),
    info: warnings.filter((w) => INFO_WARNINGS.has(w.type)),
  };
}

/** Choices for a machine tier: Any, the allowed tiers, and a current tier that is not allowed, marked as such. */
export function tierChoices(
  allowed: readonly Tier[],
  current: Tier | undefined,
  labels: { any: string; notAllowed: string },
): { value: string; label: string }[] {
  return [
    { value: '', label: labels.any },
    ...allowed.map((x) => ({ value: x, label: x })),
    ...(current && !allowed.includes(current)
      ? [{ value: current, label: `${current} ${labels.notAllowed}` }]
      : []),
  ];
}
