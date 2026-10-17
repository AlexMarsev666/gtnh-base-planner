<script lang="ts">
  import { t } from '../i18n/en';
  import { site } from '../state/site';
  import ModeSwitch from './ModeSwitch.svelte';
  import ShareMenu from './ShareMenu.svelte';
  import { canRedo, canUndo, redoSite, undoSite } from './siteHistory';

  interface Props {
    panelOpen: boolean;
    blocksOpen: boolean;
    ontogglepanel: () => void;
    ontoggleblocks: () => void;
    onimport: () => void;
  }
  let { panelOpen, blocksOpen, ontogglepanel, ontoggleblocks, onimport }: Props = $props();
</script>

<header class="bar">
  <div class="modes"><ModeSwitch /></div>

  <div class="name">
    <span class="title" data-testid="site-name">{$site.name ?? t.site.unnamed}</span>
    <span class="size">{$site.size[0]} × {$site.size[1]}</span>
  </div>

  <div class="history">
    <button
      class="btn icon"
      disabled={!$canUndo}
      aria-label={t.site.undoLabel}
      title={t.site.undoLabel}
      data-testid="site-undo"
      onclick={undoSite}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M6 3L2.5 6.5 6 10M2.5 6.5H9.5a3.5 3.5 0 0 1 0 7H7"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </button>
    <button
      class="btn icon"
      disabled={!$canRedo}
      aria-label={t.site.redoLabel}
      title={t.site.redoLabel}
      data-testid="site-redo"
      onclick={redoSite}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M10 3l3.5 3.5L10 10M13.5 6.5H6.5a3.5 3.5 0 0 0 0 7H9"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </button>
  </div>

  <span class="spacer"></span>

  <div class="right">
    <!-- Too narrow to fit: the action stays in the Inspector's Layout tab instead. -->
    <button class="btn import" data-testid="site-import" title={t.site.importOpen} onclick={onimport}
      ><span class="long">{t.site.importOpen}</span><span class="short">{t.site.importShort}</span></button
    >
    <button
      class="btn"
      class:on={blocksOpen}
      aria-expanded={blocksOpen}
      data-testid="blocks-toggle"
      onclick={ontoggleblocks}>{t.bom.toggle}</button
    >
    <ShareMenu kind="site" />
    <button
      class="btn"
      class:on={panelOpen}
      aria-expanded={panelOpen}
      data-testid="site-panel-toggle"
      onclick={ontogglepanel}>{t.site.panel}</button
    >
  </div>
</header>

<style>
  .bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--bar-h);
    padding: 0 var(--gutter);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    z-index: 30;
    color: var(--text);
  }
  .name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .title {
    font-weight: bold;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    color: var(--muted);
    white-space: nowrap;
  }
  .history {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .spacer {
    flex: 1;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .short {
    display: none;
  }
  @media (max-width: 1279px) {
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
  }
  @media (max-width: 760px) {
    .bar {
      gap: 8px;
    }
    .import {
      display: none;
    }
    .right {
      gap: 4px;
    }
    .right :global(.btn) {
      padding: 0 8px;
    }
  }
  @media (max-width: 640px) {
    .bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: 1fr 1fr;
      grid-template-areas:
        'modes right'
        'name history';
      align-items: center;
      padding: 4px 10px;
      gap: 4px 8px;
    }
    .modes {
      grid-area: modes;
    }
    .name {
      grid-area: name;
    }
    .history {
      grid-area: history;
    }
    .right {
      grid-area: right;
    }
    .spacer {
      display: none;
    }
  }
</style>
