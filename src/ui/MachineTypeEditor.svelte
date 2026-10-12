<script lang="ts">
  import { getSingleMachine, transformerValid } from '../data/single-machines';
  import { t } from '../i18n/en';
  import { TRANSFORMER_AMPS, type SiteGroup } from '../model/site/types';
  import SelectRow from './SelectRow.svelte';
  import { patchGroup } from './siteEditing';
  import { ampOptions, matchMachines } from './siteInspect';

  /** The type of a single-block machine (its look and tiers), and a transformer's direction and amperage. */
  interface Props {
    group: SiteGroup;
  }
  let { group }: Props = $props();

  const machine = $derived(group.machine ? getSingleMachine(group.machine) : undefined);
  let picking = $state(false);
  let query = $state('');
  const matches = $derived(matchMachines(query));

  const steps = [
    { value: 'down', label: t.site.stepDown },
    { value: 'up', label: t.site.stepUp },
  ];
  const ampChoices = $derived(ampOptions(group.tier));
  // A tier change can leave a transformer GT does not make (ULV): the value stays and the problem is stated here.
  const invalid = $derived(!!group.tier && !transformerValid(group.tier, group.amps ?? 4));
  const amps = $derived(
    ampChoices.map((o) => ({
      value: String(o.amps),
      label: t.site.ampsOption(o.amps),
      disabled: o.disabled,
    })),
  );

  function choose(id: string | null) {
    picking = false;
    query = '';
    patchGroup(group.id, { machine: id });
  }
</script>

<div class="type" data-testid="machine-type">
  <div class="row">
    <span>{t.site.machineType} <span class="value">{machine?.name ?? t.site.machineTypeAny}</span></span>
    <button
      class="link"
      aria-expanded={picking}
      data-testid="machine-type-toggle"
      onclick={() => (picking = !picking)}>{t.site.replace}</button
    >
  </div>
  {#if picking}
    <input
      class="field search"
      type="search"
      placeholder={t.site.machineSearch}
      aria-label={t.site.machineSearch}
      autocomplete="off"
      spellcheck="false"
      data-testid="machine-type-search"
      bind:value={query}
    />
    <ul class="list" data-testid="machine-type-list">
      {#if !query.trim()}
        <li>
          <button class="link" class:active={!group.machine} onclick={() => choose(null)}
            >{t.site.machineTypeAny}</button
          >
        </li>
      {/if}
      {#each matches as m (m.id)}
        <li>
          <button class="link" class:active={m.id === group.machine} onclick={() => choose(m.id)}
            >{m.name}</button
          >
        </li>
      {:else}
        <li class="hint">{t.site.machineNone}</li>
      {/each}
    </ul>
  {/if}
  {#if machine?.transformer}
    <ul class="rows">
      <SelectRow
        label={t.site.step}
        value={group.step ?? 'down'}
        options={steps}
        testid="transformer-step"
        onchange={(v) => patchGroup(group.id, { step: v === 'up' ? 'up' : 'down' })}
      />
      <SelectRow
        label={t.site.amps}
        value={String(group.amps ?? 4)}
        options={amps}
        testid="transformer-amps"
        describedby={invalid ? 'amps-error' : undefined}
        onchange={(v) => {
          const a = TRANSFORMER_AMPS.find((x) => String(x) === v);
          if (a) patchGroup(group.id, { amps: a });
        }}
      />
    </ul>
    {#if invalid && group.tier}<p class="hint error" id="amps-error" role="alert" data-testid="amps-error">
        {t.site.ampsInvalid(group.tier, group.amps ?? 4)}
      </p>{/if}
  {/if}
</div>

<style>
  .type {
    margin-top: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 26px;
  }
  .value {
    color: var(--text);
  }
  .search {
    width: 100%;
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    border-bottom: 1px dotted var(--muted);
    margin: 4px 0;
  }
  .list,
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list {
    max-height: 180px;
    overflow-y: auto;
  }
  .error {
    color: var(--text);
    border-left: 2px solid var(--pick);
    padding-left: 8px;
  }
  .hint {
    margin: 8px 0 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
