import { getMultiblock } from '../../data/catalog';
import { emptySite } from '../../share/siteCodec';
import { minimumGlassTier } from '../multiblock/glass';
import { hasLayeredFluidOutputs, isOilCracker } from '../multiblock/structureAdapters';
import type { HatchKind } from '../multiblock/types';
import { effectiveSize, sizedDef } from '../resize';
import { defaultGroupHatches } from './group';
import { hatchAssignmentKey } from './resourcePlacement';
import type { ResourceBinding, ResourceRole, SiteState } from './types';

/** Fixed scope approved for stage 4; adding a catalog entry does not broaden these properties. */
export const ROLE_MACHINES = [
  'high-temperature-gas-cooled-reactor',
  'large-heat-exchanger',
  'target-chamber',
  'extreme-heat-exchanger',
  'ph-neutralization-purification-unit',
  'extreme-temperature-fluctuation-purification-unit',
  'oil-cracking-unit',
  'mega-oil-cracker',
  'distillation-tower',
  'mega-distillation-tower',
  'sparge-tower-controller',
  'dangote-distillus',
  'cryogenic-freezer',
  'volcanus',
  'industrial-arc-furnace',
  'water-pump',
] as const;
export const TYPICAL_MACHINES = [
  'coke-oven',
  'pyrolyse-oven',
  'electric-blast-furnace',
  'vacuum-freezer',
  'large-chemical-reactor',
  'mega-chemical-reactor',
  'assembly-line',
  'circuit-assembly-line',
  'industrial-maceration-stack',
  'industrial-mixing-machine',
  'industrial-centrifuge',
  'industrial-electrolyzer',
  'industrial-cutting-factory',
  'industrial-extrusion-machine',
  'industrial-precision-lathe',
  'industrial-wire-factory',
  'industrial-forming-press',
  'industrial-autoclave',
  'implosion-compressor',
  'large-steam-turbine',
] as const;
export const PROPERTY_MACHINES = [...ROLE_MACHINES, ...TYPICAL_MACHINES];
export const PROPERTY_SEEDS = [19, 73] as const;

export function layoutFixture(id: string, seed: number): SiteState {
  const raw = getMultiblock(id)!;
  const def = sizedDef(raw, effectiveSize(raw, undefined));
  const count = seed === 19 ? 1 : 2;
  let hash = seed;
  for (const char of id) hash = Math.imul(hash, 31) + char.charCodeAt(0);
  const s: SiteState = {
    ...emptySite(),
    size: [
      Math.max(48, Math.max(def.size[0], def.size[2]) * count + 30),
      Math.max(48, Math.max(def.size[0], def.size[2]) * count + 30),
    ],
    groups: [
      {
        id: 'machine',
        multiblockId: id,
        count,
        origin: [20 + ((hash >>> 3) % 11), 20 + ((hash >>> 8) % 13)],
        rotation: ((hash >>> 0) % 4) as 0 | 1 | 2 | 3,
        elevation: seed === 19 ? 0 : 3,
        limits: { x: null, y: null, z: null },
        enabledHatches: defaultGroupHatches(def),
        voltageTier: def.minimumVoltageTier ?? 'HV',
        structureGlassTier: minimumGlassTier(def) ?? (def.selectableGlass ? 'HV' : undefined),
        resourceBindings: [],
      },
    ],
  };
  const g = s.groups[0];
  const add = (kind: HatchKind, role?: ResourceRole, outputSlot?: number, gameId?: string) => {
    const resource = `${kind}_${role ?? 'common'}${outputSlot === undefined ? '' : `_${outputSlot}`}`;
    const dir = ['itemOut', 'fluidOut', 'dynamo'].includes(kind) ? 'out' : 'in';
    s.resources[resource] = {
      kind:
        kind === 'energy' || kind === 'dynamo'
          ? 'power'
          : kind.startsWith('item') || kind.startsWith('electrode')
            ? 'item'
            : 'fluid',
      name: resource,
      color: '#abcdef',
      ...(gameId ? { gameId } : {}),
    };
    const port = `p${s.ports.length}`;
    s.ports.push({ id: port, dir, resource });
    s.links.push({
      id: `l${s.links.length}`,
      resource,
      from: dir === 'in' ? { port } : { group: g.id },
      to: dir === 'in' ? { group: g.id } : { port },
    });
    const binding: ResourceBinding = {
      kind,
      resource,
      unitId: (s.links.length - 1) % count,
      ...(role ? { role } : {}),
      ...(outputSlot === undefined ? {} : { outputSlot }),
    };
    g.resourceBindings!.push(binding);
    return resource;
  };
  for (const kind of ['itemIn', 'itemOut', 'fluidIn', 'fluidOut', 'energy', 'dynamo', 'steamIn'] as const) {
    if (!def.hatchBlocks[kind]) continue;
    const roles = def.resourceHatchRegions?.[kind];
    if (roles) for (const role of Object.keys(roles)) add(kind, role as ResourceRole);
    else if (kind === 'fluidIn' && isOilCracker(def)) {
      add(kind, 'feed');
      add(kind, 'catalyst');
    } else if (kind === 'fluidOut' && hasLayeredFluidOutputs(def)) {
      const slots = def.fluidOutputRegions ?? def.requiredHatches?.fluidOut?.regions ?? [];
      for (let slot = 0; slot < Math.min(2, slots.length); slot++) add(kind, 'product', slot);
    } else {
      const resource = add(
        kind,
        def.fixedFluidOutputs?.[kind] as ResourceRole | undefined,
        undefined,
        def.lockedFluidInputs?.[kind],
      );
      if (kind === 'energy') g.hatchTiers = { [hatchAssignmentKey(0, kind, resource)]: g.voltageTier! };
    }
  }
  for (const [kind, fluid] of Object.entries(def.lockedFluidInputs ?? {}))
    if (kind !== 'steamIn') add(kind as HatchKind, undefined, undefined, fluid);
  for (const [kind, items] of Object.entries(def.lockedItemInputs ?? {}))
    if (kind === 'electrodeIn') add(kind as HatchKind, undefined, undefined, items[0]);
  return s;
}
