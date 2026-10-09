<script lang="ts">
  import { catalog } from '../data/catalog';
  import type { MultiblockDef } from '../model/multiblock/types';
  import { t } from '../i18n/en';
  import { cachedIconFaces, matchesQuery } from './catalogView';
  import { blockIcon } from './icons';
  import CatalogSupport from './CatalogSupport.svelte';

  interface Props {
    currentId: string;
    onselect: (id: string) => void;
    onclose: () => void;
  }
  let { currentId, onselect, onclose }: Props = $props();

  let query = $state('');
  const items = $derived(catalog.filter((d) => matchesQuery(d, query)));

  /** Tier, wall-share and "converted from the GT sources" tags under a tile's name. */
  function tags(def: MultiblockDef): string[] {
    return [def.tier, def.wallshare ? t.wallshareTag : '', def.generated ? t.generatedTag : ''].filter(
      (x): x is string => !!x,
    );
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && items.length === 1) onselect(items[0].id);
  }
</script>

<div class="picker" role="dialog" aria-label={t.pickerTitle} data-testid="picker">
  <div class="head">
    <input
      class="field search"
      type="search"
      placeholder={t.search}
      aria-label={t.search}
      autocomplete="off"
      spellcheck="false"
      bind:value={query}
      {onkeydown}
    />
    <button class="link" onclick={onclose}>{t.close}</button>
  </div>

  {#if items.length === 0}
    <p class="empty">{t.noMatches}</p>
  {:else}
    <ul class="grid">
      {#each items as def (def.id)}
        <li>
          <button
            class="tile"
            class:current={def.id === currentId}
            aria-current={def.id === currentId ? 'true' : undefined}
            data-testid="picker-item"
            onclick={() => onselect(def.id)}
          >
            <canvas class="cube" aria-hidden="true" use:blockIcon={cachedIconFaces(def)}></canvas>
            <span class="label">{def.name}</span>
            <span class="meta">
              {#each tags(def) as tag, i (tag)}{#if i > 0}<span class="dot">{t.separator}</span
                  >{/if}{tag}{/each}
            </span>
            <CatalogSupport id={def.id} compact />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .picker {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 20;
    overflow-y: auto;
    padding: calc(var(--bar-h) + 24px) var(--gutter) 64px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    max-width: 1080px;
    margin: 0 auto 40px;
  }
  .search {
    text-align: left;
    width: 16em;
  }
  .search::-webkit-search-cancel-button {
    display: none;
  }
  .grid {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    max-width: 1080px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 56px 24px;
  }
  .grid li {
    width: 168px;
  }
  .tile {
    appearance: none;
    background: none;
    border: 0;
    padding: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    color: var(--muted);
  }
  .cube {
    display: block;
    width: 72px;
    height: 72px;
    margin-bottom: 14px;
    transition: transform 0.2s ease;
  }
  .tile:hover .cube {
    transform: translateY(-3px);
  }
  .label {
    color: var(--text);
    text-align: center;
    text-underline-offset: 4px;
    text-decoration-thickness: 1px;
  }
  .tile.current .label,
  .tile:hover .label {
    text-decoration-line: underline;
  }
  .meta {
    min-height: 1.5em;
  }
  .dot {
    margin: 0 6px;
    color: var(--faint);
  }
  .empty {
    text-align: center;
    margin-top: 80px;
  }

  @media (max-width: 640px) {
    .grid {
      gap: 40px 16px;
    }
    .grid li {
      width: calc(50% - 8px);
    }
  }
</style>
