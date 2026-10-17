<script lang="ts">
  import { SINGLE_BLOCK_ID, PLACEHOLDER_ID } from '../data/generic';
  import { t } from '../i18n/en';
  import { site, siteGroup, siteLink, siteLinkDraft } from '../state/site';
  import MenuButton from './MenuButton.svelte';
  import ResourceIcon from './ResourceIcon.svelte';
  import { updateSite, withLinkRemoved } from './siteActions';
  import { addGroup } from './siteCommands';
  import { siteBuild } from './sitePipeline';
  import { endName, groupName, resName } from './siteNames';
  import { groupErrorCount } from './validityText';

  interface Props {
    /** Open the multiblock picker to add a group (`add`) or change the selected one (`change`). */
    onpick: (purpose: 'add' | 'change') => void;
    /** Inside the Template panel (narrow screens) instead of docked at the left edge. */
    embedded?: boolean;
    /** A group or link was selected, or the new link form asked for (their inspector lives in the Template panel). */
    onselect?: () => void;
  }
  let { onpick, embedded = false, onselect }: Props = $props();

  const build = $derived($siteBuild.build);

  function selectLink(id: string) {
    const next = id === $siteLink ? null : id;
    siteLink.set(next);
    if (next) onselect?.();
  }
  function openLinkForm() {
    siteLinkDraft.set(true);
    onselect?.();
  }
</script>

{#snippet body()}
  <section>
    <div class="head">
      <h2>{t.site.groupsCount($site.groups.length)}</h2>
      <MenuButton
        label={t.site.addMenuLabel}
        buttonLabel={t.site.addMenuLabel}
        buttonClass="btn small"
        testid="site-add-menu"
      >
        {#snippet button()}{t.site.addMenu}{/snippet}
        {#snippet children({ pick })}
          <button
            class="menu-item"
            role="menuitem"
            data-testid="site-add-group"
            onclick={() => pick(() => onpick('add'))}>{t.site.addGroup}</button
          >
          <button class="menu-item" role="menuitem" onclick={() => pick(() => addGroup(SINGLE_BLOCK_ID))}
            >{t.site.addSingle}</button
          >
          <button class="menu-item" role="menuitem" onclick={() => pick(() => addGroup(PLACEHOLDER_ID))}
            >{t.site.addPlaceholder}</button
          >
        {/snippet}
      </MenuButton>
    </div>
    {#if !$site.groups.length}<p class="hint">{t.site.noGroups}</p>{/if}
    <ul class="rows">
      {#each $site.groups as g (g.id)}
        {@const pg = build?.groups.find((x) => x.group.id === g.id)}
        {@const errors = groupErrorCount(pg)}
        <li class="row">
          <button
            class="link text-left"
            class:active={g.id === $siteGroup}
            data-testid="site-group"
            aria-label="{groupName($site, g.id)} ×{pg?.units.length ?? g.count}"
            onclick={() => {
              const id = g.id === $siteGroup ? null : g.id;
              siteGroup.set(id);
              if (id) onselect?.();
            }}>{groupName($site, g.id)}</button
          >
          {#if errors > 0}
            <span
              class="badge"
              role="img"
              data-testid="site-group-errors"
              title={t.site.groupErrors(errors)}
              aria-label={t.site.groupErrors(errors)}>{errors}</span
            >
          {/if}
          <span class="meta">×{pg?.units.length ?? g.count}</span>
          {#if g.source?.machineCount !== undefined}<span class="meta"
              >{t.site.needed(g.source.machineCount)}</span
            >{/if}
        </li>
      {/each}
    </ul>
  </section>

  <section>
    <div class="head">
      <h2>{t.site.linksCount($site.links.length)}</h2>
      <button
        class="btn small"
        class:primary={$siteLinkDraft}
        aria-pressed={$siteLinkDraft}
        data-testid="site-link-open"
        onclick={openLinkForm}>{t.site.addLinkOpen}</button
      >
    </div>
    {#if !$site.links.length}<p class="hint">{t.site.noLinks}</p>{/if}
    <ul class="rows">
      {#each $site.links as l (l.id)}
        {@const res = $site.resources[l.resource]}
        <li class="row link-row" class:picked={$siteLink === l.id} data-testid="site-link">
          <span class="dot" style:background={res?.color} title={res?.name}></span>
          {#if res}<span class="res-icon"><ResourceIcon {res} size={20} /></span>{/if}
          <button
            class="link text-left"
            class:active={$siteLink === l.id}
            aria-pressed={$siteLink === l.id}
            onclick={() => selectLink(l.id)}
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
    margin: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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
  .meta {
    flex: none;
  }
  .hint {
    margin: 8px 0 0;
  }
  .badge {
    flex: none;
    min-width: 16px;
    padding: 0 4px;
    border: 1px solid var(--pick);
    text-align: center;
    line-height: 1.3;
  }
  .link-row {
    align-items: flex-start;
    /* Room for the outline of the selected link. */
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
  .x {
    color: var(--muted);
  }
  .dot {
    width: 10px;
    height: 10px;
    flex: none;
    margin-top: 8px;
  }
  .res-icon {
    margin-top: 4px;
    flex: none;
  }
  @media (max-width: 640px) {
    section {
      margin-top: 20px;
    }
  }
</style>
