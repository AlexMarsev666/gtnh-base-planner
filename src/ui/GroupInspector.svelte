<script lang="ts">
  import {
    PLACEHOLDER_ID,
    SINGLE_BLOCK_ID,
    TRANSFORMER_ID,
    getSiteDef,
    isSingleBlock,
  } from '../data/generic';
  import {
    SINGLE_MACHINES,
    singleMachineBlockId,
    singleMachineTiers,
    hatchTiers,
  } from '../data/single-machines';
  import { VOLTAGE_TIERS, TRANSFORMER_TIERS, isVoltageTier } from '../model/tiers';
  import { blockIconFaces } from './catalogView';
  import { blockIcon } from './icons';
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import { IO_KINDS } from '../model/site/group';
  import { hatchKindFor } from '../model/site/demand';
  import type { ResourceBinding, ResourceRole, SiteGroup } from '../model/site/types';
  import type { HatchKind } from '../model/multiblock/types';
  import { hasLayeredFluidOutputs, isOilCracker } from '../model/multiblock/structureAdapters';
  import { defaultHatchTier, supportsHatchTier } from '../model/hatches/tiers';
  import { BOROSILICATE_GLASS_TIERS } from '../model/multiblock/glass';
  import { SITE_MAX_ELEVATION, SITE_MAX_SIZE } from '../share/siteCodec';
  import { site, siteGroup, siteHatch } from '../state/site';
  import { hatchKindsOf } from './catalogView';
  import {
    COUNT_MAX,
    COUNT_MIN,
    LIMIT_MAX,
    LIMIT_MIN,
    formatLimit,
    parseCount,
    parseLimit,
    parseSize,
  } from './fields';
  import NudgePad from './NudgePad.svelte';
  import NumberStepper from './NumberStepper.svelte';
  import { groupLimitAxis, updateSite, withGroupPatched, type GroupPatch } from './siteActions';
  import {
    duplicateSelected,
    frameSelected,
    growAfterBuild,
    removeSelected,
    rotateSelected,
    setSelectedOrigin,
  } from './siteEditing';
  import ToggleRow from './ToggleRow.svelte';

  /** The editor of the selected template group: Machine, Packing and Placement. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
    /** Open the multiblock picker to replace the machine. */
    onreplace: () => void;
  }
  let { group, placed, onreplace }: Props = $props();

  const def = $derived(getSiteDef(group.multiblockId));
  const name = $derived(group.label ?? def?.name ?? group.multiblockId);
  const units = $derived(placed?.units.length ?? group.count);
  const extraKinds = $derived(def ? hatchKindsOf(def).filter((k) => !IO_KINDS.includes(k)) : []);
  /** Multiblocks along x, layers, z as packed (from the placed units). */
  const grid = $derived.by(() => {
    const us = placed?.units ?? [];
    if (!us.length) return null;
    const axis = (i: 0 | 1 | 2) => new Set(us.map((u) => u.origin[i])).size;
    return [axis(0), axis(1), axis(2)] as const;
  });
  const footprint = $derived(
    placed ? ([placed.max[0] - placed.min[0], placed.max[2] - placed.min[2]] as const) : null,
  );

  let replacing = $state(false);
  let machineQuery = $state('');
  const machineChoices = $derived(
    SINGLE_MACHINES.filter((m) => (m.name + ' ' + m.id).toLowerCase().includes(machineQuery.toLowerCase())),
  );
  const voltageChoices = $derived(
    group.multiblockId === SINGLE_BLOCK_ID && group.machine && singleMachineTiers(group.machine).length
      ? singleMachineTiers(group.machine)
      : VOLTAGE_TIERS,
  );
  const ioHatches = $derived(
    placed?.hatches
      .filter((h) => def && !isSingleBlock(def) && supportsHatchTier(def, h.kind))
      .sort((a, b) => Number(!IO_KINDS.includes(a.kind)) - Number(!IO_KINDS.includes(b.kind))) ?? [],
  );
  const resourceRoles = $derived(placed?.def?.resourceHatchRegions ?? def?.resourceHatchRegions ?? {});
  const lockedInputKinds = $derived(Object.keys(def?.lockedFluidInputs ?? {}) as HatchKind[]);
  const lockedItemKinds = $derived(Object.keys(def?.lockedItemInputs ?? {}) as HatchKind[]);
  const lockedItemResources = $derived(
    lockedItemKinds.length
      ? [
          ...new Set(
            $site.links
              .filter(
                (link) =>
                  'group' in link.to &&
                  link.to.group === group.id &&
                  $site.resources[link.resource]?.kind === 'item',
              )
              .map((link) => link.resource),
          ),
        ]
      : [],
  );
  const fixedOutputResources = $derived(
    def?.fixedFluidOutputs?.fluidOut
      ? [
          ...new Set(
            $site.links
              .filter(
                (link) =>
                  'group' in link.from &&
                  link.from.group === group.id &&
                  $site.resources[link.resource]?.kind === 'fluid',
              )
              .map((link) => link.resource),
          ),
        ]
      : [],
  );
  const lockedInputResources = $derived(
    lockedInputKinds.length
      ? [
          ...new Set(
            $site.links
              .filter(
                (link) =>
                  'group' in link.to &&
                  link.to.group === group.id &&
                  $site.resources[link.resource]?.kind === 'fluid',
              )
              .map((link) => link.resource),
          ),
        ]
      : [],
  );
  const roleKinds = $derived(
    isOilCracker(def)
      ? ['fluidIn' as const]
      : hasLayeredFluidOutputs(def)
        ? ['fluidOut' as const]
        : (Object.keys(resourceRoles) as HatchKind[]),
  );
  const outputSlotCount = $derived(
    (
      placed?.def?.fluidOutputRegions ??
      placed?.def?.requiredHatches?.fluidOut?.regions ??
      def?.fluidOutputRegions
    )?.length ?? (placed?.def?.size[1] ?? 3) - 1,
  );
  const roleResources = $derived(placed?.demand.fluidOut ?? []);
  const roleAssignments = $derived(
    roleKinds.flatMap((kind) =>
      (placed?.demand[kind] ?? []).flatMap<{
        kind: HatchKind;
        resource: string;
        binding: ResourceBinding | undefined;
        index: number;
      }>((resource) => {
        const matches = (group.resourceBindings ?? [])
          .map((binding, index) => ({ kind, resource, binding, index }))
          .filter(({ binding }) => binding.kind === kind && binding.resource === resource);
        return matches.length ? matches : [{ kind, resource, binding: undefined, index: -1 }];
      }),
    ),
  );
  const machineAssignments = $derived(
    Object.entries(placed?.demand ?? {}).flatMap(([kind, resources]) =>
      (resources ?? []).flatMap((resource) => {
        const matches = (group.resourceBindings ?? [])
          .map((binding, index) => ({ binding, index }))
          .filter(({ binding }) => binding.kind === kind && binding.resource === resource);
        return (matches.length ? matches : [{ binding: undefined, index: -1 }]).map((match) => ({
          ...match,
          kind: kind as HatchKind,
          resource,
        }));
      }),
    ),
  );
  function setBindingMachine(kind: HatchKind, resource: string, index: number, value: string) {
    const resourceBindings = (group.resourceBindings ?? []).map((b) => ({ ...b }));
    const binding = index < 0 ? ({ kind, resource } as ResourceBinding) : resourceBindings[index];
    if (value === '') delete binding.unitId;
    else binding.unitId = Number(value);
    if (index < 0) resourceBindings.push(binding);
    patch({ resourceBindings });
  }
  const roleLabels: Partial<Record<ResourceRole, string>> = {
    hotFluid: 'Hot fluid',
    helium: 'Helium',
    mask: 'Photolithographic mask',
    coldFluid: 'Cooled fluid',
    water: 'Water',
    steam: 'Steam',
    acid: 'Hydrochloric acid',
    alkaline: 'Sodium hydroxide',
    coolant: 'Coolant',
    plasma: 'Plasma',
    product: 'Product',
  };
  $effect(() => {
    void group.id;
    replacing = false;
  });

  /** Changes that can make the group bigger grow the site once the group is rebuilt. */
  function patch(p: GroupPatch) {
    const id = group.id;
    growAfterBuild(id);
    updateSite((s) => withGroupPatched(s, id, p));
  }
  function commitOrigin(axis: 0 | 1, text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) setSelectedOrigin(axis, n);
  }
  function commitElevation(text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) patch({ elevation: n });
  }
  /** `axis` is a site axis (the field's label); the group stores its limits unturned. */
  function commitLimit(axis: 'x' | 'y' | 'z', text: string) {
    const v = parseLimit(text);
    if (v !== undefined) patch({ limits: { ...group.limits, [groupLimitAxis(axis, group.rotation)]: v } });
  }
  function toggleHatch(kind: HatchKind) {
    const on = group.enabledHatches.includes(kind);
    patch({
      enabledHatches: on ? group.enabledHatches.filter((k) => k !== kind) : [...group.enabledHatches, kind],
    });
  }
  function replaceWith(id: string) {
    replacing = false;
    patch({ multiblockId: id });
  }
  function setHatchTier(assignments: string[], value: string) {
    const hatchTiers = { ...group.hatchTiers };
    for (const key of assignments) {
      if (isVoltageTier(value)) hatchTiers[key] = value;
      else delete hatchTiers[key];
    }
    patch({ hatchTiers });
  }
  function setBinding(kind: HatchKind, resource: string, value: string, index: number) {
    const old = group.resourceBindings ?? [];
    const resourceBindings = [...old];
    const unitId = old[index]?.unitId;
    if (index >= 0) resourceBindings.splice(index, 1);
    if (value) {
      resourceBindings.splice(
        index < 0 ? resourceBindings.length : index,
        0,
        isOilCracker(def) || resourceRoles[kind]
          ? { kind, resource, role: value as ResourceRole, ...(unitId === undefined ? {} : { unitId }) }
          : {
              kind,
              resource,
              role: 'product',
              outputSlot: Number(value),
              ...(unitId === undefined ? {} : { unitId }),
            },
      );
    }
    if (!value && unitId !== undefined) resourceBindings.push({ kind, resource, unitId });
    patch({ resourceBindings });
  }
  function addOutputSlot(resource: string) {
    patch({
      resourceBindings: [...(group.resourceBindings ?? []), { kind: 'fluidOut', resource, role: 'product' }],
    });
  }
  function setFluidInputKind(resource: string, value: string) {
    const resourceBindings = (group.resourceBindings ?? []).filter(
      (b) => b.resource !== resource || (b.kind !== 'fluidIn' && !lockedInputKinds.includes(b.kind)),
    );
    const unitId = group.resourceBindings?.find((b) => b.resource === resource)?.unitId;
    if (value)
      resourceBindings.push({
        kind: value as HatchKind,
        resource,
        ...(unitId === undefined ? {} : { unitId }),
      });
    patch({ resourceBindings });
  }
  function setItemInputKind(resource: string, value: string) {
    const resourceBindings = (group.resourceBindings ?? []).filter(
      (b) => b.resource !== resource || (b.kind !== 'itemIn' && !lockedItemKinds.includes(b.kind)),
    );
    const unitId = group.resourceBindings?.find((b) => b.resource === resource)?.unitId;
    if (value)
      resourceBindings.push({
        kind: value as HatchKind,
        resource,
        ...(unitId === undefined ? {} : { unitId }),
      });
    patch({ resourceBindings });
  }
  function setFixedOutputRole(resource: string, value: string) {
    const bindings = (group.resourceBindings ?? []).filter(
      (b) => !(b.kind === 'fluidOut' && b.resource === resource),
    );
    const unitId = group.resourceBindings?.find(
      (b) => b.kind === 'fluidOut' && b.resource === resource,
    )?.unitId;
    if (value === 'water')
      bindings.push({
        kind: 'fluidOut',
        resource,
        role: 'water',
        ...(unitId === undefined ? {} : { unitId }),
      });
    else if (unitId !== undefined) bindings.push({ kind: 'fluidOut', resource, unitId });
    patch({ resourceBindings: bindings });
  }
</script>

<div class="inspector" data-testid="site-group-editor" aria-label={name}>
  <div class="head">
    <span class="name">{name} ×{units}</span>
    <span class="acts">
      <button class="link" onclick={frameSelected}>{t.site.frame}</button>
      <button class="link" onclick={() => siteGroup.set(null)}>{t.site.deselect}</button>
    </span>
  </div>
  {#if group.source}<p class="hint">
      {group.source.name}{group.source.tier ? ` · ${group.source.tier}` : ''}{group.source.machineCount !==
      undefined
        ? ` · ${t.site.needed(group.source.machineCount)}`
        : ''}
    </p>{/if}

  {#if def?.generated}<p class="hint unverified" data-testid="unverified">
      {t.generatedTag}: {t.generatedHint}
    </p>{/if}

  <div class="sub">
    <p class="sub-title"><span>{t.site.machine}</span></p>
    <label class="col">
      <span>{t.site.label}</span>
      <input
        class="field text"
        type="text"
        value={group.label ?? ''}
        placeholder={def?.name ?? ''}
        aria-label={t.site.label}
        data-testid="site-group-label"
        onchange={(e) => patch({ label: e.currentTarget.value.trim() || null })}
      />
    </label>
    <div class="row">
      <span class="value">{def?.name ?? group.multiblockId}</span>
      <button class="link" aria-expanded={replacing} onclick={() => (replacing = !replacing)}
        >{t.site.replace}</button
      >
    </div>
    {#if replacing}
      <div class="row wrap replace">
        <span>{t.site.replaceWith}</span>
        <button class="link" onclick={onreplace}>{t.site.replaceCatalog}</button>
        {#if group.multiblockId !== SINGLE_BLOCK_ID}
          <button class="link" onclick={() => replaceWith(SINGLE_BLOCK_ID)}>{t.importer.single}</button>
        {/if}
        {#if group.multiblockId !== PLACEHOLDER_ID}
          <button class="link" onclick={() => replaceWith(PLACEHOLDER_ID)}>{t.importer.placeholder}</button>
        {/if}
      </div>
    {/if}
    {#if group.multiblockId === SINGLE_BLOCK_ID}
      <label class="col"
        ><span>{t.site.searchMachines}</span><input
          class="field text"
          type="search"
          bind:value={machineQuery}
          data-testid="single-machine-search"
        /></label
      >
      <label class="col"
        ><span>{t.site.machineLook}</span><select
          class="field"
          value={group.machine ?? ''}
          data-testid="single-machine-select"
          onchange={(e) => patch({ machine: e.currentTarget.value || null })}
        >
          <option value="">{t.site.unspecifiedTier}</option>
          {#each machineChoices as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
        </select></label
      >
      {#if group.machine}<canvas
          style="width:72px;height:72px"
          aria-label={group.machine}
          use:blockIcon={blockIconFaces(
            singleMachineBlockId(group.machine) + (group.voltageTier ? `.${group.voltageTier}` : ''),
          )}
        ></canvas>{/if}
    {/if}
    {#if group.multiblockId !== TRANSFORMER_ID}
      <label class="col"
        ><span
          >{group.multiblockId === 'manual-transformer'
            ? t.site.transformerInputTier
            : group.multiblockId === 'water-pump'
              ? t.site.outputHatchTier
              : t.site.voltageTier}</span
        ><select
          class="field"
          value={group.voltageTier ?? ''}
          data-testid="machine-voltage-tier"
          onchange={(e) =>
            patch({ voltageTier: isVoltageTier(e.currentTarget.value) ? e.currentTarget.value : null })}
        >
          <option value="">{t.site.unspecifiedTier}</option>{#each voltageChoices as tier}<option value={tier}
              >{tier}</option
            >{/each}
        </select></label
      >
    {:else}
      {@const tr = group.transformer ?? ({ lowTier: 'LV', facing: 'north', mode: 'down' } as const)}
      <label class="col"
        ><span>{t.site.voltageTier}</span><select
          class="field"
          value={tr.lowTier}
          data-testid="transformer-tier"
          onchange={(e) => {
            if (isVoltageTier(e.currentTarget.value))
              patch({ transformer: { ...tr, lowTier: e.currentTarget.value } });
          }}
          >{#each TRANSFORMER_TIERS as tier}<option value={tier}
              >{tier} → {VOLTAGE_TIERS[VOLTAGE_TIERS.indexOf(tier) + 1]}</option
            >{/each}</select
        ></label
      >
      <label class="col"
        ><span>{t.site.transformerMode}</span><select
          class="field"
          value={tr.mode}
          data-testid="transformer-mode"
          onchange={(e) => patch({ transformer: { ...tr, mode: e.currentTarget.value as 'down' | 'up' } })}
          ><option value="down">{t.site.transformerDown}</option><option value="up"
            >{t.site.transformerUp}</option
          ></select
        ></label
      >
      <label class="col"
        ><span>{t.site.transformerFacing}</span><select
          class="field"
          value={tr.facing}
          data-testid="transformer-facing"
          onchange={(e) =>
            patch({ transformer: { ...tr, facing: e.currentTarget.value as typeof tr.facing } })}
          >{#each ['north', 'east', 'south', 'west', 'up', 'down'] as face}<option value={face}>{face}</option
            >{/each}</select
        ></label
      >
    {/if}
    {#if group.multiblockId === 'manual-transformer'}
      <label class="col"
        ><span>{t.site.transformerMode}</span><select
          class="field"
          data-testid="manual-transformer-mode"
          value={group.manualTransformerMode ?? 'up'}
          onchange={(e) => patch({ manualTransformerMode: e.currentTarget.value as 'up' | 'down' })}
        >
          <option value="up">{t.site.transformerUp}</option><option value="down"
            >{t.site.transformerDown}</option
          >
        </select></label
      >
      <p class="hint">{t.site.manualTransformerHint}</p>
    {/if}
    {#if group.multiblockId === 'circuit-assembly-line'}
      <label class="pair"
        ><span>{t.site.assemblyGrowth}</span><select
          class="field"
          data-testid="assembly-growth"
          value={group.assemblyGrowth ?? 'left'}
          onchange={(e) => patch({ assemblyGrowth: e.currentTarget.value as 'left' | 'right' })}
        >
          <option value="left">{t.site.assemblyGrowthLeft}</option>
          <option value="right">{t.site.assemblyGrowthRight}</option>
        </select></label
      >
    {/if}
    {#if group.multiblockId === 'data-bank'}
      <ul class="rows">
        <ToggleRow
          on={group.dataBankWireless ?? false}
          label={t.site.dataBankWireless}
          title={t.site.dataBankWirelessHint}
          testid="data-bank-wireless"
          ontoggle={() => patch({ dataBankWireless: !group.dataBankWireless })}
        />
      </ul>
    {/if}
    {#if group.multiblockId === 'water-pump'}
      <label class="pair"
        ><span>{t.site.steamFrameTier}</span><select
          class="field"
          data-testid="steam-frame-tier"
          value={group.steamFrameTier ?? 'bronze'}
          onchange={(e) => patch({ steamFrameTier: e.currentTarget.value as 'bronze' | 'steel' })}
        >
          <option value="bronze">{t.site.steamFrameBronze}</option><option value="steel"
            >{t.site.steamFrameSteel}</option
          >
        </select></label
      >
    {/if}
    {#if def?.selectableGlass}
      <label class="col"
        ><span>{t.site.structureGlassTier}</span><select
          class="field"
          data-testid="structure-glass-tier"
          value={group.structureGlassTier ?? ''}
          onchange={(e) =>
            patch({
              structureGlassTier:
                e.currentTarget.value === ''
                  ? null
                  : (e.currentTarget.value as SiteGroup['structureGlassTier']),
            })}
        >
          <option value="">{t.site.catalogGlass}</option>
          {#if group.structureGlassTier && !BOROSILICATE_GLASS_TIERS.includes(group.structureGlassTier)}
            <option value={group.structureGlassTier}
              >{group.structureGlassTier} · {t.site.unavailableTier}</option
            >
          {/if}
          {#each BOROSILICATE_GLASS_TIERS as tier}<option value={tier}>{tier}</option>{/each}
        </select></label
      >
    {/if}
    {#each lockedItemResources as resource (resource)}
      {@const binding = group.resourceBindings?.find(
        (b) => b.resource === resource && (b.kind === 'itemIn' || lockedItemKinds.includes(b.kind)),
      )}
      {@const automatic = def && hatchKindFor('in', resource, $site.resources[resource], def)}
      <label class="col"
        ><span>{$site.resources[resource]?.name ?? resource} · {t.site.resourceRole}</span>
        <select
          class="field"
          data-testid="locked-item-input"
          value={binding?.kind ?? ''}
          onchange={(e) => setItemInputKind(resource, e.currentTarget.value)}
        >
          <option value="">{automatic ? `Automatic · ${t.hatchKinds[automatic]}` : t.site.roleNeeded}</option>
          {#if def?.hatchBlocks.itemIn}<option value="itemIn">Recipe item input</option>{/if}
          {#each lockedItemKinds as kind}<option value={kind}>{t.hatchKinds[kind]}</option>{/each}
        </select>
      </label>
    {/each}
    {#each lockedInputResources as resource (resource)}
      {@const binding = group.resourceBindings?.find(
        (b) => b.resource === resource && (b.kind === 'fluidIn' || lockedInputKinds.includes(b.kind)),
      )}
      {@const automatic = def && hatchKindFor('in', resource, $site.resources[resource], def)}
      <label class="col"
        ><span>{$site.resources[resource]?.name ?? resource} · {t.site.resourceRole}</span>
        <select
          class="field"
          data-testid="locked-fluid-input"
          value={binding?.kind ?? ''}
          onchange={(e) => setFluidInputKind(resource, e.currentTarget.value)}
        >
          <option value="">{automatic ? `Automatic · ${t.hatchKinds[automatic]}` : t.site.roleNeeded}</option>
          {#if def?.hatchBlocks.fluidIn}<option value="fluidIn">Recipe fluid input</option>{/if}
          {#each lockedInputKinds as kind}<option value={kind}>{t.hatchKinds[kind]}</option>{/each}
        </select>
      </label>
    {/each}
    {#each fixedOutputResources as resource (resource)}
      {@const binding = group.resourceBindings?.find((b) => b.kind === 'fluidOut' && b.resource === resource)}
      {@const automatic = def && hatchKindFor('out', resource, $site.resources[resource], def)}
      <label class="col"
        ><span>{$site.resources[resource]?.name ?? resource} · {t.site.resourceRole}</span>
        <select
          class="field"
          data-testid="fixed-fluid-output-role"
          value={binding?.role ?? ''}
          onchange={(e) => setFixedOutputRole(resource, e.currentTarget.value)}
        >
          <option value="">{automatic ? 'Automatic · Water' : t.site.roleNeeded}</option>
          <option value="water">Water</option>
        </select>
      </label>
    {/each}
    {#each roleAssignments as assignment (`${assignment.kind}:${assignment.resource}:${assignment.index}`)}
      {@const resource = assignment.resource}
      {@const binding = assignment.binding}
      <label class="col"
        ><span
          >{$site.resources[resource]?.name ?? resource} · {isOilCracker(def) ||
          resourceRoles[assignment.kind]
            ? t.site.resourceRole
            : t.site.outputSlot}</span
        >
        <select
          class="field"
          value={isOilCracker(def) || resourceRoles[assignment.kind]
            ? (binding?.role ?? '')
            : (binding?.outputSlot?.toString() ?? '')}
          data-testid="resource-structural-role"
          onchange={(e) => setBinding(assignment.kind, resource, e.currentTarget.value, assignment.index)}
        >
          <option value="">{t.site.roleNeeded}</option>
          {#if isOilCracker(def)}<option value="feed">Hydrocarbon feed</option><option value="catalyst"
              >Cracking agent</option
            >
          {:else if resourceRoles[assignment.kind]}{#each Object.keys(resourceRoles[assignment.kind]!) as role}<option
                value={role}>{roleLabels[role as ResourceRole] ?? role}</option
              >{/each}
          {:else}{#each Array.from({ length: outputSlotCount }, (_, i) => i) as slot}<option
                value={String(slot)}>{slot + 1}</option
              >{/each}{/if}
        </select>
      </label>
    {/each}
    {#each machineAssignments as assignment (`${assignment.kind}:${assignment.resource}:${assignment.index}`)}
      <label class="col"
        ><span
          >{$site.resources[assignment.resource]?.name ?? assignment.resource} · {t.site
            .resourceMachine}</span
        >
        <select
          class="field"
          data-testid="resource-machine"
          value={assignment.binding?.unitId?.toString() ?? ''}
          onchange={(e) =>
            setBindingMachine(assignment.kind, assignment.resource, assignment.index, e.currentTarget.value)}
        >
          <option value="">Automatic</option>
          {#if assignment.binding?.unitId !== undefined && assignment.binding.unitId >= group.count}
            <option value={String(assignment.binding.unitId)}
              >Machine {assignment.binding.unitId + 1} · unavailable (automatic)</option
            >
          {/if}
          {#each Array.from({ length: group.count }, (_, id) => id) as id}
            <option value={String(id)}>Machine {id + 1}</option>
          {/each}
        </select>
      </label>
    {/each}
    {#if hasLayeredFluidOutputs(def)}
      {#each roleResources as resource}<button class="link" onclick={() => addOutputSlot(resource)}
          >{t.site.addOutputSlot} · {$site.resources[resource]?.name ?? resource}</button
        >{/each}
    {/if}
    {#if isOilCracker(def)}<label class="col"
        ><span>{t.site.crackingFeedSide}</span><select
          class="field"
          value={group.crackingFeedSide ?? 'right'}
          data-testid="cracking-feed-side"
          onchange={(e) => patch({ crackingFeedSide: e.currentTarget.value as 'left' | 'right' })}
          ><option value="left">−X</option><option value="right">+X</option></select
        ></label
      >{/if}
  </div>

  {#if ioHatches.length}
    <div class="sub" data-testid="individual-hatches">
      <p class="sub-title">{t.site.individualHatches}</p>
      {#each ioHatches as hatch (JSON.stringify(hatch.assignments ?? [hatch.cell, hatch.kind]))}
        <label
          class="col"
          style:background={$siteHatch?.group === group.id &&
          hatch.assignments?.some((a) => $siteHatch?.assignments.includes(a))
            ? 'var(--line)'
            : 'transparent'}
        >
          <span
            >{t.hatchKinds[hatch.kind]} · {hatch.resource
              ? ($site.resources[hatch.resource]?.name ?? hatch.resource)
              : ''} · ({hatch.cell.join(', ')}){hatch.unitIds.length > 1
              ? ` · ${hatch.unitIds.length} controllers`
              : ''}</span
          >
          <select
            class="field"
            value={hatch.assignments?.some((key) => group.hatchTiers?.[key]) ? (hatch.tier ?? '') : ''}
            data-testid="individual-hatch-tier"
            onchange={(e) => setHatchTier(hatch.assignments ?? [], e.currentTarget.value)}
            ><option value=""
              >{hatch.kind === 'dataAccess' || hatch.kind === 'uncertainty'
                ? t.site.defaultHatchTier
                : t.site.followMachineTier} ({placed?.def
                ? (defaultHatchTier(placed.def, hatch.kind, group) ?? t.site.unspecifiedTier)
                : t.site.unspecifiedTier})</option
            >{#if hatch.tier && !hatchTiers(hatch.kind).includes(hatch.tier)}<option value={hatch.tier}
                >{hatch.tier} ({t.site.unavailableTier})</option
              >{/if}{#each hatchTiers(hatch.kind) as tier}<option value={tier}>{tier}</option>{/each}</select
          >
        </label>
      {/each}
    </div>
  {/if}

  <div class="sub">
    <p class="sub-title">
      <span>{t.site.packing}</span>{#if grid}<span class="meta">{t.site.grid(grid[0], grid[1], grid[2])}</span
        >{/if}
    </p>
    <div class="fields">
      <label class="pair"
        ><span>{t.site.count}</span><NumberStepper
          value={String(group.count)}
          label={t.site.count}
          min={COUNT_MIN}
          max={COUNT_MAX}
          width="3.2em"
          testid="site-group-count"
          oncommit={(v) => {
            const n = parseCount(v);
            if (n !== null) patch({ count: n });
          }}
        /></label
      >
      {#if def?.resize}
        {@const r = def.resize}
        <label class="pair"
          ><span>{r.label === 'length' ? t.length : t.height}</span><NumberStepper
            value={String(group.size ?? r.default)}
            label={r.label === 'length' ? t.length : t.height}
            min={r.min}
            max={r.max}
            oncommit={(v) => {
              const n = parseSize(v);
              if (n !== null) patch({ size: n });
            }}
          /></label
        >
      {/if}
    </div>
    <div class="grid3">
      {#each [['x', t.site.maxX], ['y', t.limitY], ['z', t.site.maxZ]] as const as [axis, label] (axis)}
        <label class="col"
          ><span>{label}</span><NumberStepper
            value={formatLimit(group.limits[groupLimitAxis(axis, group.rotation)])}
            {label}
            min={LIMIT_MIN}
            max={LIMIT_MAX}
            empty
            placeholder={t.unlimited}
            oncommit={(v) => commitLimit(axis, v)}
          /></label
        >
      {/each}
    </div>
    <p class="hint">{t.site.packingHint}</p>
    <ul class="rows">
      <ToggleRow
        on={!!group.limitsLocked}
        label={t.site.lockLimits}
        testid="site-lock-limits"
        ontoggle={() => patch({ limitsLocked: !group.limitsLocked })}
      />
    </ul>
    <p class="hint">{t.site.lockLimitsHint}</p>
    {#if extraKinds.length}
      <p class="sub-label">{t.site.hatches}</p>
      <ul class="rows">
        {#each extraKinds as kind (kind)}
          <ToggleRow
            on={group.enabledHatches.includes(kind)}
            label={t.hatchKinds[kind]}
            testid={`site-hatch-${kind}`}
            ontoggle={() => toggleHatch(kind)}
          />
        {/each}
      </ul>
    {/if}
    {#if placed?.build?.unplaced.length}<p class="hint warn">
        {t.unplacedHatches(placed.build.unplaced.length)}
      </p>{/if}
  </div>

  <div class="sub">
    <p class="sub-title">
      <span>{t.site.placement}</span>{#if footprint}<span class="meta"
          >{t.site.footprint(footprint[0], footprint[1])}</span
        >{/if}
    </p>
    <div class="placement">
      <NudgePad />
      <div class="coords">
        <label class="pair"
          ><span class="axis-x">{t.site.x}</span><NumberStepper
            value={String(group.origin[0])}
            label={t.site.x}
            min={-SITE_MAX_SIZE}
            max={2 * SITE_MAX_SIZE}
            testid="site-group-x"
            oncommit={(v) => commitOrigin(0, v)}
          /></label
        >
        <label class="pair"
          ><span class="axis-z">{t.site.z}</span><NumberStepper
            value={String(group.origin[1])}
            label={t.site.z}
            min={-SITE_MAX_SIZE}
            max={2 * SITE_MAX_SIZE}
            testid="site-group-z"
            oncommit={(v) => commitOrigin(1, v)}
          /></label
        >
        <label class="pair"
          ><span>{t.site.elevation}</span><NumberStepper
            value={String(group.elevation ?? 0)}
            label={t.site.elevation}
            min={0}
            max={SITE_MAX_ELEVATION}
            testid="site-group-elevation"
            oncommit={(v) => commitElevation(v)}
          /></label
        >
        <div class="row">
          <span>{t.site.turn} <span class="value">{t.site.rotation(group.rotation)}</span></span>
          <button class="link" data-testid="site-group-rotate" onclick={() => rotateSelected(1)}
            >{t.site.rotate}</button
          >
        </div>
      </div>
    </div>
    <p class="hint">{t.site.placementHint}</p>
  </div>

  <div class="row foot">
    <button class="link" data-testid="site-group-duplicate" onclick={duplicateSelected}
      >{t.site.duplicate}</button
    >
    <button class="link" data-testid="site-group-remove" onclick={removeSelected}>{t.site.removeGroup}</button
    >
  </div>
</div>

<style>
  .unverified {
    color: var(--pick);
  }
  .inspector {
    padding: 4px 0 20px;
    border-bottom: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .name,
  .value,
  .sub-title {
    color: var(--text);
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    gap: 12px;
    flex: none;
  }
  .sub {
    margin-top: 20px;
  }
  .sub-title {
    margin: 0 0 6px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .meta {
    color: var(--muted);
  }
  .sub-label {
    margin: 12px 0 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .row.wrap {
    flex-wrap: wrap;
    row-gap: 0;
  }
  .replace > span {
    color: var(--muted);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 18px;
    margin: 2px 0 6px;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair > span {
    white-space: nowrap;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .col .text {
    width: 100%;
  }
  .text {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    border-bottom: 1px dotted var(--muted);
    padding-bottom: 2px;
  }
  .text:focus {
    border-bottom: 1px solid var(--text);
    text-decoration: none;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    gap: 6px 12px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .placement {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .coords {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .axis-x {
    color: var(--axis-x);
  }
  .axis-z {
    color: var(--axis-z);
  }
  .hint {
    margin: 8px 0 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint.warn {
    color: var(--text);
  }
  .foot {
    margin-top: 16px;
    justify-content: space-between;
  }
</style>
