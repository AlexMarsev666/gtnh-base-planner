<script lang="ts">
  import type { MultiblockDef } from '../model/multiblock/types';
  import type { Demand } from '../model/site/group';
  import type { HatchAssign, SiteGroup } from '../model/site/types';
  import { t } from '../i18n/en';
  import { site } from '../state/site';
  import SelectRow from './SelectRow.svelte';
  import { patchGroup } from './siteEditing';
  import { groupResources, unitChoices, unitValue, zoneChoices } from './siteInspect';

  /**
   * Where the hatch of each resource a group takes or gives goes: onto one unit or all, into a zone.
   * Choices are kept by resource, so the input and output rows of one resource share them.
   */
  interface Props {
    group: SiteGroup;
    def: MultiblockDef;
    demand: Demand;
    /** Units in the group as built (the count may be higher than what fits). */
    units: number;
  }
  let { group, def, demand, units }: Props = $props();

  const resources = $derived(groupResources(demand));
  const count = $derived(Math.max(units, group.count));
  /** Choices for resources the group does not take or give now (the link was removed). */
  const stale = $derived.by(() => {
    const live = new Set(resources.map((r) => r.resource));
    return Object.keys(group.assign ?? {}).filter((k) => !live.has(k));
  });
  function clearStale() {
    const kept = Object.fromEntries(Object.entries(group.assign ?? {}).filter(([k]) => !stale.includes(k)));
    patchGroup(group.id, { assign: kept });
  }

  function assign(resource: string, change: Partial<HatchAssign>) {
    const next: HatchAssign = { ...group.assign?.[resource], ...change };
    if (next.unit === undefined) delete next.unit;
    if (!next.zone) delete next.zone;
    patchGroup(group.id, { assign: { ...group.assign, [resource]: next } });
  }
  function unitOptions(resource: string) {
    const current = group.assign?.[resource]?.unit;
    const out = unitChoices(count).map((c) => ({
      value: c.value,
      label:
        c.value === ''
          ? t.site.auto
          : c.value === 'all'
            ? t.site.allUnits
            : t.site.unitN(Number(c.value) + 1),
    }));
    // A unit the group no longer has stays in the list (and is reported as a problem) until changed.
    if (typeof current === 'number' && current >= count)
      out.push({ value: String(current), label: t.site.unitGone(current + 1) });
    return out;
  }
  function onunit(resource: string, v: string) {
    assign(resource, { unit: v === '' ? undefined : v === 'all' ? 'all' : Number(v) });
  }
</script>

{#if resources.length || stale.length}
  <div class="sub" data-testid="group-resources">
    <p class="sub-title"><span>{t.site.resources}</span></p>
    <ul class="blocks">
      {#each resources as r (r.kind + r.resource)}
        {@const a = group.assign?.[r.resource]}
        {@const zones = zoneChoices(def, r.kind, a?.zone)}
        <li>
          <p class="res">
            <span class="value">{$site.resources[r.resource]?.name ?? r.resource}</span>
            <span class="meta">{t.hatchKinds[r.kind]}</span>
          </p>
          <ul class="rows">
            {#if count > 1 || a?.unit !== undefined}
              <SelectRow
                label={t.site.unit}
                value={unitValue(a)}
                options={unitOptions(r.resource)}
                testid={`assign-unit-${r.resource}`}
                onchange={(v) => onunit(r.resource, v)}
              />
            {/if}
            {#if zones.length}
              <SelectRow
                label={t.site.zone}
                value={a?.zone ?? ''}
                options={[{ value: '', label: t.site.auto }, ...zones]}
                testid={`assign-zone-${r.resource}`}
                onchange={(v) => assign(r.resource, { zone: v || undefined })}
              />
            {/if}
          </ul>
        </li>
      {/each}
    </ul>
    <p class="hint">{t.site.resourcesHint}</p>
    {#if stale.length}
      <p class="hint" data-testid="assign-stale">
        {t.site.staleAssign(stale.length)}
        <button class="link" onclick={clearStale}>{t.site.staleAssignClear}</button>
      </p>
    {/if}
  </div>
{/if}

<style>
  .sub {
    margin-top: 20px;
  }
  .sub-title,
  .value {
    color: var(--text);
  }
  .sub-title {
    margin: 0 0 6px;
  }
  .blocks,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .blocks > li {
    margin-bottom: 6px;
  }
  .res {
    margin: 0;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .meta,
  .hint {
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint {
    margin: 8px 0 0;
  }
</style>
