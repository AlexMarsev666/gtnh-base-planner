<script lang="ts">
  import { SINGLE_BLOCK_ID, PLACEHOLDER_ID } from '../data/generic';
  import { t } from '../i18n/en';
  import type { ResourceKind } from '../model/site/types';
  import { isolate, site, siteGroup } from '../state/site';
  import ResourceIcon from './ResourceIcon.svelte';
  import { updateSite, withLinkAdded, withLinkRemoved, withResourceColor, type LinkEnd } from './siteActions';
  import { addGroup } from './siteCommands';
  import { siteBuild } from './sitePipeline';
  import { endName, groupName, menuName, resName } from './siteNames';

  interface Props {
    /** Open the multiblock picker to add a group (`add`) or change the selected one (`change`). */
    onpick: (purpose: 'add' | 'change') => void;
    /** Inside the Template panel (narrow screens) instead of docked at the left edge. */
    embedded?: boolean;
    /** A group was selected from the list (its editor lives in the Template panel). */
    onselect?: () => void;
  }
  let { onpick, embedded = false, onselect }: Props = $props();

  const build = $derived($siteBuild.build);

  // New link form, folded until asked for.
  let linkOpen = $state(false);
  let linkFrom = $state('');
  let linkTo = $state('');
  let linkRes = $state('');
  let newResName = $state('');
  let newResKind = $state<ResourceKind>('item');
  let linkRate = $state('');
  const resourceKeys = $derived(
    Object.keys($site.resources).sort((a, b) => resName($site, a).localeCompare(resName($site, b))),
  );
  function end(v: string): LinkEnd | null {
    if (v === '@port') return { port: true };
    return v ? { group: v } : null;
  }
  function addLink() {
    const from = end(linkFrom);
    const to = end(linkTo);
    if (!from || !to) return;
    const res = linkRes && linkRes !== '@new' ? { key: linkRes } : { name: newResName, kind: newResKind };
    const rate = Number(linkRate);
    const before = $site;
    updateSite((s) => withLinkAdded(s, from, to, res, Number.isFinite(rate) && rate > 0 ? rate : undefined));
    if ($site !== before) {
      newResName = '';
      linkRate = '';
    }
  }
</script>

{#snippet body()}
  <section>
    <h2>{t.site.groups}</h2>
    {#if !$site.groups.length}<p class="hint">{t.site.noGroups}</p>{/if}
    <ul class="rows">
      {#each $site.groups as g (g.id)}
        {@const pg = build?.groups.find((x) => x.group.id === g.id)}
        <li class="row">
          <button
            class="link"
            class:active={g.id === $siteGroup}
            data-testid="site-group"
            onclick={() => {
              const id = g.id === $siteGroup ? null : g.id;
              siteGroup.set(id);
              if (id) onselect?.();
            }}>{groupName($site, g.id)} ×{pg?.units.length ?? g.count}</button
          >
          {#if g.source?.machineCount !== undefined}<span class="meta"
              >{t.site.needed(g.source.machineCount)}</span
            >{/if}
        </li>
      {/each}
    </ul>
    <ul class="rows add">
      <li class="row">
        <button class="link" data-testid="site-add-group" onclick={() => onpick('add')}
          >{t.site.addGroup}</button
        >
      </li>
      <li class="row">
        <button class="link" onclick={() => addGroup(SINGLE_BLOCK_ID)}>{t.site.addSingle}</button>
      </li>
      <li class="row">
        <button class="link" onclick={() => addGroup(PLACEHOLDER_ID)}>{t.site.addPlaceholder}</button>
      </li>
    </ul>
  </section>

  <section>
    <h2>{t.site.links}</h2>
    {#if !$site.links.length}<p class="hint">{t.site.noLinks}</p>{/if}
    <ul class="rows">
      {#each $site.links as l (l.id)}
        {@const res = $site.resources[l.resource]}
        <li class="row link-row" class:picked={$isolate === l.resource} data-testid="site-link">
          <label class="swatch" style:background={res?.color} title={res?.name}>
            <input
              type="color"
              value={res?.color ?? '#888888'}
              aria-label={res?.name}
              onchange={(e) => updateSite((s) => withResourceColor(s, l.resource, e.currentTarget.value))}
            />
          </label>
          {#if res}<span class="res-icon"><ResourceIcon {res} size={20} /></span>{/if}
          <button
            class="link text-left"
            class:active={$isolate === l.resource}
            onclick={() => isolate.set($isolate === l.resource ? null : l.resource)}
            ><span class="res">{resName($site, l.resource)}</span>
            <span class="meta"
              >{endName($site, l.from)} → {endName($site, l.to)}{l.rate !== undefined && res
                ? ` · ${t.site.rateText(l.rate, res.kind)}`
                : ''}</span
            ></button
          >
          <button
            class="link x"
            aria-label={t.site.remove}
            onclick={() => updateSite((s) => withLinkRemoved(s, l.id))}>×</button
          >
        </li>
      {/each}
    </ul>

    {#if linkOpen}
      <div class="form" data-testid="site-link-form">
        <label class="pair wide"
          ><span>{t.site.from}</span>
          <select class="field select" bind:value={linkFrom} aria-label={t.site.from}>
            <option value="">—</option>
            <option value="@port">{t.site.inputPort}</option>
            {#each $site.groups as g (g.id)}<option value={g.id}>{menuName($site, g.id)}</option>{/each}
          </select></label
        >
        <label class="pair wide"
          ><span>{t.site.to}</span>
          <select class="field select" bind:value={linkTo} aria-label={t.site.to}>
            <option value="">—</option>
            <option value="@port">{t.site.outputPort}</option>
            {#each $site.groups as g (g.id)}<option value={g.id}>{menuName($site, g.id)}</option>{/each}
          </select></label
        >
        <label class="pair wide"
          ><span>{t.site.resource}</span>
          <select class="field select" bind:value={linkRes} aria-label={t.site.resource}>
            <option value="@new">{t.site.newResource}</option>
            {#each resourceKeys as k (k)}<option value={k}>{resName($site, k)}</option>{/each}
          </select></label
        >
        {#if !linkRes || linkRes === '@new'}
          <label class="pair wide"
            ><span>{t.site.resourceName}</span><input
              class="field text"
              type="text"
              bind:value={newResName}
              aria-label={t.site.resourceName}
            /></label
          >
          <label class="pair wide"
            ><span>{t.site.kind}</span>
            <select class="field select" bind:value={newResKind} aria-label={t.site.kind}>
              <option value="item">{t.site.kinds.item}</option>
              <option value="fluid">{t.site.kinds.fluid}</option>
              <option value="power">{t.site.kinds.power}</option>
            </select></label
          >
        {/if}
        <label class="pair wide"
          ><span>{t.site.rate}</span><input
            class="field text"
            type="text"
            inputmode="decimal"
            bind:value={linkRate}
            aria-label={t.site.rate}
          /></label
        >
        <div class="row">
          <button class="link active" data-testid="site-add-link" onclick={addLink}>{t.site.addLink}</button>
          <button class="link" onclick={() => (linkOpen = false)}>{t.site.addLinkClose}</button>
        </div>
      </div>
    {:else}
      <ul class="rows add">
        <li class="row">
          <button class="link" data-testid="site-link-open" onclick={() => (linkOpen = true)}
            >{t.site.addLinkOpen}</button
          >
        </li>
      </ul>
    {/if}
  </section>
{/snippet}

{#if embedded}
  <div>{@render body()}</div>
{:else}
  <aside class="outline" aria-label={t.site.outline} data-testid="site-outline">
    {@render body()}
  </aside>
{/if}

<style>
  .outline {
    position: fixed;
    top: var(--bar-h);
    left: 0;
    bottom: 0;
    width: 260px;
    border-right: 1px solid var(--line);
    background: var(--bg);
    overflow-y: auto;
    z-index: 25;
    padding: 16px var(--gutter) 48px;
  }
  .outline section:first-child {
    margin-top: 0;
  }
  section {
    margin-top: 32px;
  }
  h2 {
    color: var(--text);
    font: inherit;
    margin: 0 0 12px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair.wide {
    justify-content: space-between;
    width: 100%;
  }
  .pair.wide > span {
    flex: none;
    white-space: nowrap;
  }
  .text {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    border-bottom: 1px dotted var(--muted);
    padding-bottom: 2px;
  }
  .text:focus {
    border-bottom: 1px solid var(--text);
    text-decoration: none;
  }
  .select {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    max-width: 200px;
    cursor: pointer;
  }
  .hint,
  .meta {
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint {
    margin: 8px 0 0;
  }
  .add {
    margin-top: 10px;
  }
  .link-row {
    align-items: flex-start;
    /* Room for the outline of the isolated resource. */
    margin: 0 -6px;
    padding: 0 6px;
    outline: 1px solid transparent;
  }
  .link-row.picked {
    outline-color: var(--pick);
  }
  .text-left {
    text-align: left;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .res {
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .x {
    color: var(--muted);
  }
  .swatch {
    position: relative;
    width: 10px;
    height: 10px;
    flex: none;
    margin-top: 8px;
    cursor: pointer;
  }
  .res-icon {
    margin-top: 4px;
    flex: none;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }
  .form {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  @media (max-width: 640px) {
    section {
      margin-top: 20px;
    }
  }
</style>
