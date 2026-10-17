<script lang="ts">
  import { getSiteDef } from '../data/generic';
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import type { SiteGroup } from '../model/site/types';
  import { groupTab, siteGroup, type GroupTab } from '../state/site';
  import GroupMachineTab from './GroupMachineTab.svelte';
  import GroupPackingTab from './GroupPackingTab.svelte';
  import GroupPlacementTab from './GroupPlacementTab.svelte';
  import { duplicateSelected, frameSelected, removeSelected } from './siteEditing';
  import Tabs from './Tabs.svelte';
  import { groupValidity, validityLines } from './validityText';

  /** The editor of the selected template group: Machine, Packing and Placement tabs. */
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

  const lines = $derived(
    placed
      ? validityLines(
          groupValidity(placed),
          placed.units.map((u) => u.id),
          def,
        )
      : undefined,
  );

  const tabs = $derived([
    { id: 'machine', label: t.site.tabs.machine, badge: lines?.errors.length },
    { id: 'packing', label: t.site.tabs.packing },
    { id: 'placement', label: t.site.tabs.placement },
  ]);
  function setTab(id: string) {
    const tab: GroupTab | undefined = (['machine', 'packing', 'placement'] as const).find((x) => x === id);
    if (tab) groupTab.set(tab);
  }
</script>

<div class="inspector" data-testid="site-group-editor" aria-label={name}>
  <div class="head">
    <span class="name"
      >{name} ×{units}{#if lines?.errors.length}
        <span class="badge" title={t.validity.badgeHint} data-testid="site-group-badge"
          >{t.validity.badge}</span
        >{/if}</span
    >
    <span class="acts">
      <button class="btn small" onclick={frameSelected}>{t.site.frame}</button>
      <button class="btn small" onclick={() => siteGroup.set(null)}>{t.site.deselect}</button>
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

  <div class="tabbar">
    <Tabs {tabs} active={$groupTab} onchange={setTab} label={t.site.tabs.group} testid="site-group-tabs" />
  </div>
  <div role="tabpanel" id="site-group-tabs-panel" aria-labelledby="site-group-tabs-tab-{$groupTab}">
    {#if $groupTab === 'machine'}
      <GroupMachineTab {group} {placed} {lines} {onreplace} />
    {:else if $groupTab === 'packing'}
      <GroupPackingTab {group} {placed} />
    {:else}
      <GroupPlacementTab {group} {placed} />
    {/if}
  </div>

  <div class="row foot">
    <button class="btn" data-testid="site-group-duplicate" onclick={duplicateSelected}
      >{t.site.duplicate}</button
    >
    <button class="btn danger" data-testid="site-group-remove" onclick={removeSelected}
      >{t.site.removeGroup}</button
    >
  </div>
</div>

<style>
  .badge {
    margin-left: 6px;
    padding: 0 4px;
    border: 1px solid var(--pick);
    color: var(--pick);
  }
  .unverified {
    color: var(--pick);
  }
  .inspector {
    padding: 4px 0 20px;
    border-bottom: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text);
  }
  .acts {
    display: flex;
    gap: 6px;
    flex: none;
  }
  .tabbar {
    margin-top: 16px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .hint {
    margin: 8px 0 0;
  }
  .foot {
    margin-top: 16px;
    justify-content: flex-start;
  }
</style>
