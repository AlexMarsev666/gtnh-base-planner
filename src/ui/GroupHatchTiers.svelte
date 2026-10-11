<script lang="ts">
  import type { PlacedGroup } from '../model/site/buildTypes';
  import type { SiteGroup } from '../model/site/types';
  import { TIERS, type Tier } from '../model/core/types';
  import { t } from '../i18n/en';
  import { site } from '../state/site';
  import { hatchTierOptions } from './hatchTierRows';
  import SelectRow from './SelectRow.svelte';
  import { patchGroup } from './siteEditing';
  import { groupHatchRows, unmatchedGroupTiers } from './siteInspect';

  /** The tier of each single hatch of a group, by the template keys of `SiteGroup.hatchTiers`. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
  }
  let { group, placed }: Props = $props();

  let open = $state(false);
  const rows = $derived(
    placed
      ? groupHatchRows(
          placed.hatches,
          placed.units.map((u) => u.id),
        )
      : [],
  );
  const unmatched = $derived(
    placed
      ? unmatchedGroupTiers(
          group.hatchTiers,
          placed.hatches,
          placed.units.map((u) => u.id),
        )
      : 0,
  );
  const choices = (kind: Parameters<typeof hatchTierOptions>[0]) => [
    { value: '', label: t.defaultTier },
    ...hatchTierOptions(kind).map((x) => ({ value: x, label: x })),
  ];

  function set(key: string, v: string) {
    const tiers = { ...group.hatchTiers };
    const tier: Tier | undefined = TIERS.find((x) => x === v);
    if (tier) tiers[key] = tier;
    else delete tiers[key];
    patchGroup(group.id, { hatchTiers: tiers });
  }
</script>

{#if rows.length}
  <div class="sub">
    <p class="sub-title">{t.site.hatchTiers}</p>
    <button
      class="link"
      class:active={open}
      aria-expanded={open}
      data-testid="group-hatch-tiers-toggle"
      onclick={() => (open = !open)}>{open ? t.hatchTiersHide : t.hatchTiersShow(rows.length)}</button
    >
    {#if open}
      <ul class="rows list" data-testid="group-hatch-tier-list">
        {#each rows as row (row.key)}
          <SelectRow
            label={t.site.hatchTierName(
              t.hatchKinds[row.kind],
              row.resource ? ($site.resources[row.resource]?.name ?? row.resource) : undefined,
              row.unit,
            )}
            value={group.hatchTiers?.[row.key] ?? ''}
            options={choices(row.kind)}
            testid={`group-hatch-tier-${row.key}`}
            onchange={(v) => set(row.key, v)}
          />
        {/each}
      </ul>
      {#if group.hatchTiers}
        {#if unmatched}<p class="hint" data-testid="group-hatch-tiers-unmatched">
            {t.hatchTiersUnmatched(unmatched)}
          </p>{/if}
        <button class="link" onclick={() => patchGroup(group.id, { hatchTiers: null })}
          >{t.resetHatchTiers}</button
        >
      {/if}
    {/if}
  </div>
{/if}

<style>
  .sub {
    margin-top: 20px;
  }
  .sub-title {
    margin: 0 0 6px;
    color: var(--text);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .list {
    max-height: 220px;
    overflow-y: auto;
  }
</style>
