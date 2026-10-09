import { getSiteDef, isSingleBlock, TRANSFORMER_ID } from '../../data/generic';
import type { HatchKind, MultiblockDef } from '../multiblock/types';
import type { Side, SiteWarning } from './buildTypes';
import type { Demand } from './group';
import type { Endpoint, ResourceBinding, ResourceDef, SiteState } from './types';

/** What each group needs: the hatch kind and resource of every link end on it. */

/** The hatch kind that carries `res` into (`in`) or out of a machine of `def`, or null when it has none. */
export function hatchKindFor(
  side: Side,
  key: string,
  res: ResourceDef,
  def: MultiblockDef,
  bindings: readonly ResourceBinding[] = [],
): HatchKind | null {
  if (def.id === TRANSFORMER_ID && res.kind !== 'power') return null;
  const any = isSingleBlock(def);
  const has = (k: HatchKind) => any || def.hatchBlocks[k] !== undefined;
  let kind: HatchKind;
  if (res.kind === 'power') kind = side === 'in' ? 'energy' : 'dynamo';
  else if (res.kind === 'item') {
    kind = side === 'in' ? 'itemIn' : 'itemOut';
    if (side === 'in' && def.lockedItemInputs) {
      const binding = bindings.find(
        (b) => b.resource === key && (b.kind === 'itemIn' || def.lockedItemInputs?.[b.kind]),
      );
      if (binding) {
        const locked = def.lockedItemInputs[binding.kind];
        return !has(binding.kind) || (locked && res.gameId && !locked.includes(res.gameId))
          ? null
          : binding.kind;
      }
      const locked = Object.entries(def.lockedItemInputs).find(
        ([, ids]) => res.gameId && ids.includes(res.gameId),
      );
      if (locked) return locked[0] as HatchKind;
      if (!res.gameId) return null;
    }
  } else if (side === 'out') {
    kind = 'fluidOut';
    const fixed = def.fixedFluidOutputs?.[kind];
    if (
      fixed &&
      (res.gameId
        ? res.gameId !== fixed
        : !bindings.some((b) => b.kind === kind && b.resource === key && b.role === fixed))
    )
      return null;
  } else {
    if (def.lockedFluidInputs) {
      const binding = bindings.find(
        (b) => b.resource === key && (b.kind === 'fluidIn' || def.lockedFluidInputs?.[b.kind]),
      );
      if (binding) {
        const locked = def.lockedFluidInputs[binding.kind];
        // A known different fluid cannot enter the locked interface. Unknown IDs need an explicit choice.
        return !has(binding.kind) || (locked && res.gameId && res.gameId !== locked) ? null : binding.kind;
      }
      const locked = (Object.entries(def.lockedFluidInputs) as [HatchKind, string][]).find(
        ([, fluid]) => res.gameId === fluid,
      );
      if (locked) return locked[0];
      if (!res.gameId) return null;
      if (!has('fluidIn')) return null;
    }
    const steamy = /steam/i.test(key) || /steam/i.test(res.name);
    kind = !any && has('steamIn') && (!has('fluidIn') || steamy) ? 'steamIn' : 'fluidIn';
  }
  return has(kind) ? kind : null;
}

/** A site's resource by key; an unknown key gets a grey item placeholder. */
export function siteResource(site: SiteState, key: string): ResourceDef {
  return site.resources[key] ?? { kind: 'item', name: key, color: '#888888' };
}

export interface SiteDemand {
  /** Per group id, the resources each hatch kind carries. */
  demands: Map<string, Demand>;
  /** Per group and hatch kind, the other ends of its links (where those hatches' pipes go). */
  endsOf: Map<string, Map<HatchKind, Endpoint[]>>;
  /** Link ends on a machine without a hatch for their resource. */
  warnings: SiteWarning[];
}

/** Walks the links: every end on a group asks that group for a hatch of the kind its resource needs. */
export function deriveSiteDemand(site: SiteState): SiteDemand {
  const groupById = new Map(site.groups.map((g) => [g.id, g]));
  const demands = new Map<string, Demand>();
  const endsOf = new Map<string, Map<HatchKind, Endpoint[]>>();
  const warnings: SiteWarning[] = [];
  const unsupported = new Set<string>();
  for (const l of site.links) {
    const res = siteResource(site, l.resource);
    for (const [end, side] of [
      [l.from, 'out'],
      [l.to, 'in'],
    ] as const) {
      if (!('group' in end)) continue;
      const g = groupById.get(end.group);
      const def = g ? getSiteDef(g.multiblockId) : undefined;
      if (!g || !def) continue;
      const kind = hatchKindFor(side, l.resource, res, def, g.resourceBindings);
      if (!kind) {
        const u = `${end.group}\u0000${l.resource}`;
        if (!unsupported.has(u))
          warnings.push({ type: 'unsupported', group: end.group, resource: l.resource });
        unsupported.add(u);
        continue;
      }
      let dem = demands.get(end.group);
      if (!dem) demands.set(end.group, (dem = {}));
      const list = (dem[kind] ??= []);
      if (!list.includes(l.resource)) list.push(l.resource);
      let ends = endsOf.get(end.group);
      if (!ends) endsOf.set(end.group, (ends = new Map()));
      const other = side === 'out' ? l.to : l.from;
      (ends.get(kind) ?? ends.set(kind, []).get(kind)!).push(other);
    }
  }
  return { demands, endsOf, warnings };
}
