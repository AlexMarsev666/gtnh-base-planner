<script lang="ts">
  import { tick } from 'svelte';
  import { TIERS, type Tier } from '../model/core/types';
  import { t } from '../i18n/en';
  import type { SiteGroup } from '../model/site/types';
  import { site, siteHatch } from '../state/site';
  import { hatchTierOptions } from './hatchTierRows';
  import SelectRow from './SelectRow.svelte';
  import { patchGroup } from './siteEditing';
  import type { GroupHatchInfo } from './siteInspect';

  /** The hatch picked in the 3D view: what it is, what it serves, where it sits, and its tier. */
  interface Props {
    group: SiteGroup;
    info: GroupHatchInfo;
  }
  let { group, info }: Props = $props();

  let root = $state<HTMLElement>();
  // A new pick brings the block into view.
  $effect(() => {
    void info.key;
    void tick().then(() => root?.scrollIntoView({ block: 'nearest' }));
  });

  const nameOf = (r: string) => $site.resources[r]?.name ?? r;
  const resourceName = $derived(
    info.resources ? info.resources.map(nameOf).join(', ') : info.resource ? nameOf(info.resource) : '',
  );
  const choices = $derived([
    { value: '', label: t.defaultTier },
    ...hatchTierOptions(info.kind).map((x) => ({ value: x, label: x })),
  ]);

  function setTier(v: string) {
    const tiers = { ...group.hatchTiers };
    const tier: Tier | undefined = TIERS.find((x) => x === v);
    if (tier) tiers[info.key] = tier;
    else delete tiers[info.key];
    patchGroup(group.id, { hatchTiers: tiers });
  }
</script>

<div class="sub" data-testid="group-hatch" bind:this={root}>
  <p class="sub-title">
    <span>{t.site.pickedHatch}</span>
    <button class="link" onclick={() => siteHatch.set(null)}>{t.site.deselect}</button>
  </p>
  <p class="line">
    <span class="value">{t.hatchKinds[info.kind]}{resourceName ? ` · ${resourceName}` : ''}</span>
  </p>
  <p class="line"><span>{t.site.hatchServes(info.units)}</span></p>
  {#if info.zone}
    <p class="line" data-testid="group-hatch-zone">
      <span>{t.site.hatchZone(info.zone.name, info.zone.text)}</span>
    </p>
  {/if}
  {#if info.tiered}
    <ul class="rows">
      <SelectRow
        label={t.site.tier}
        value={group.hatchTiers?.[info.key] ?? ''}
        options={choices}
        testid="group-hatch-tier"
        emphasis
        onchange={setTier}
      />
    </ul>
  {/if}
</div>

<style>
  .sub {
    margin-top: 20px;
  }
  .sub-title {
    margin: 0 0 6px;
    color: var(--text);
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .line {
    margin: 0 0 4px;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
    white-space: pre-line;
  }
  .value {
    color: var(--text);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
