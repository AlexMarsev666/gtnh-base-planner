<script lang="ts">
  import { PLACEHOLDER_ID, SINGLE_BLOCK_ID, getSiteDef, isSingleBlock } from '../data/generic';
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import { TIERS } from '../model/core/types';
  import { WALLSHARE_MODES } from '../model/plan/types';
  import type { SiteGroup } from '../model/site/types';
  import { siteHatch } from '../state/site';
  import { hatchKindsOf } from './catalogView';
  import Buildability from './Buildability.svelte';
  import GroupHatch from './GroupHatch.svelte';
  import GroupHatchTiers from './GroupHatchTiers.svelte';
  import GroupResources from './GroupResources.svelte';
  import MachineTypeEditor from './MachineTypeEditor.svelte';
  import { mirrorDisabled } from './orientationText';
  import { patchGroup } from './siteEditing';
  import SelectRow from './SelectRow.svelte';
  import { groupHatchInfo, groupTiers, hasStructure, tierChoices } from './siteInspect';
  import ToggleRow from './ToggleRow.svelte';
  import { coilChoices, glassChoices, type validityLines } from './validityText';

  /** The Machine tab of the group inspector: the machine and its options, buildability, resources, hatch tiers. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
    lines: ReturnType<typeof validityLines> | undefined;
    /** Open the multiblock picker to replace the machine. */
    onreplace: () => void;
  }
  let { group, placed, lines, onreplace }: Props = $props();

  const def = $derived(getSiteDef(group.multiblockId));
  const mirrorLocked = $derived(mirrorDisabled(def, !!group.mirror));
  const tiers = $derived(groupTiers(group, def));
  const tierOptions = $derived(
    tierChoices(tiers, group.tier, { any: t.site.tierAny, notAllowed: t.notAllowed }),
  );
  const wallshareOptions = WALLSHARE_MODES.map((m) => ({ value: m, label: t.wallshareModes[m] }));

  /** The hatch picked in the 3D view, when it is one of this group's. */
  const hatchInfo = $derived(
    placed && $siteHatch?.group === group.id ? groupHatchInfo(placed, $siteHatch.key) : undefined,
  );

  let replacing = $state(false);
  $effect(() => {
    void group.id;
    replacing = false;
  });

  /** Changes that can make the group bigger grow the site once the group is rebuilt. */
  function patch(p: Parameters<typeof patchGroup>[1]) {
    patchGroup(group.id, p);
  }
  function replaceWith(id: string) {
    replacing = false;
    patch({ multiblockId: id });
  }
</script>

{#if hatchInfo}<GroupHatch {group} info={hatchInfo} />{/if}

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
  {#if def && isSingleBlock(def)}<MachineTypeEditor {group} />{/if}
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
  <ul class="rows opts">
    {#if tiers.length}
      <SelectRow
        label={t.site.tier}
        title={t.site.tierHint}
        value={group.tier ?? ''}
        options={tierOptions}
        testid="site-group-tier"
        onchange={(v) => patch({ tier: TIERS.find((x) => x === v) ?? null })}
      />
    {/if}
    {#if def?.glassTierLimits}
      <SelectRow
        label={t.validity.glass}
        title={t.validity.glassHint}
        value={group.glassTier ?? ''}
        options={glassChoices(def, group.glassTier)}
        testid="site-group-glass"
        onchange={(v) => patch({ glassTier: TIERS.find((x) => x === v) ?? null })}
      />
    {/if}
    {#if def?.coils}
      <SelectRow
        label={t.coil}
        title={t.coilHint}
        value={group.coil ?? ''}
        options={coilChoices(def)}
        testid="site-group-coil"
        onchange={(v) => patch({ coil: v || null })}
      />
    {/if}
    {#if def && hatchKindsOf(def).includes('fluidIn')}
      <ToggleRow
        on={group.quadFluid !== false}
        label={t.quadFluid}
        title={t.quadFluidHint}
        testid="site-group-quad-fluid"
        ontoggle={() => patch({ quadFluid: group.quadFluid === false })}
      />
    {/if}
    {#if hasStructure(def)}
      <ToggleRow
        on={!!group.mirror}
        label={t.mirror}
        title={t.mirrorHint}
        disabled={mirrorLocked}
        hint={t.mirrorForbidden}
        testid="site-group-mirror"
        ontoggle={() => patch({ mirror: !group.mirror })}
      />
      <SelectRow
        label={t.wallshare}
        title={t.wallshareHint}
        value={group.wallshare ?? 'auto'}
        options={wallshareOptions}
        testid="site-group-wallshare"
        onchange={(v) => {
          const mode = WALLSHARE_MODES.find((m) => m === v);
          if (mode) patch({ wallshare: mode });
        }}
      />
      {#if def?.wallshare}
        <ToggleRow
          on={!!group.shareMaintenance}
          label={t.shareMaintenance}
          title={t.shareMaintenanceHint}
          testid="site-group-share-maintenance"
          ontoggle={() => patch({ shareMaintenance: !group.shareMaintenance })}
        />
        <ToggleRow
          on={!!group.shareEnergy}
          label={t.shareEnergy}
          title={t.shareEnergyHint}
          testid="site-group-share-energy"
          ontoggle={() => patch({ shareEnergy: !group.shareEnergy })}
        />
      {/if}
    {/if}
  </ul>
</div>

{#if lines}
  <div class="sub">
    <p class="sub-title"><span>{t.validity.title}</span></p>
    <Buildability errors={lines.errors} hints={lines.hints} testid="site-group-buildability" />
  </div>
{/if}

{#if def}
  <GroupResources
    {group}
    {def}
    demand={placed?.demand ?? {}}
    units={placed?.units.length ?? group.count}
    focus={hatchInfo?.resource ? { kind: hatchInfo.kind, resource: hatchInfo.resource } : undefined}
  />
{/if}
<GroupHatchTiers {group} {placed} />

<style>
  .value,
  .sub-title {
    color: var(--text);
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
  .opts {
    margin-top: 6px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
