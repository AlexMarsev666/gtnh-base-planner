<script lang="ts">
  import { t } from '../i18n/en';
  import type { MultiblockDef } from '../model/multiblock/types';
  import { plan } from '../state/store';
  import { setCount } from './actions';
  import { COUNT_MAX, COUNT_MIN, parseCount } from './fields';
  import ModeSwitch from './ModeSwitch.svelte';
  import NumberStepper from './NumberStepper.svelte';
  import ShareMenu from './ShareMenu.svelte';

  interface Props {
    def: MultiblockDef | undefined;
    pickerOpen: boolean;
    settingsOpen: boolean;
    blocksOpen: boolean;
    ontogglepicker: () => void;
    ontogglesettings: () => void;
    ontoggleblocks: () => void;
  }
  let { def, pickerOpen, settingsOpen, blocksOpen, ontogglepicker, ontogglesettings, ontoggleblocks }: Props =
    $props();

  function commitCount(text: string) {
    const n = parseCount(text);
    if (n !== null) setCount(n);
  }
</script>

<header class="bar">
  <div class="modes"><ModeSwitch /></div>

  <div class="name">
    <button
      class="btn machine"
      class:on={pickerOpen}
      data-testid="multiblock-name"
      aria-expanded={pickerOpen}
      aria-haspopup="dialog"
      onclick={ontogglepicker}
    >
      <strong class="title">{def?.name ?? $plan.multiblockId}</strong>
      {#if def?.tier}<span class="tier">{def.tier}</span>{/if}
      <svg class="chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"
        ><path
          d="M1 1l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        /></svg
      >
    </button>
    {#if def?.generated}<span class="unverified" title={t.generatedHint} data-testid="unverified"
        >{t.generatedTag}</span
      >{/if}
  </div>

  <label class="count">
    <span class="count-label">{t.countShort}</span>
    <NumberStepper
      value={String($plan.count)}
      label={t.countLabel}
      min={COUNT_MIN}
      max={COUNT_MAX}
      width="3em"
      testid="count"
      oncommit={commitCount}
    />
  </label>

  <span class="spacer"></span>

  <div class="right">
    <button
      class="btn"
      class:on={blocksOpen}
      aria-expanded={blocksOpen}
      data-testid="blocks-toggle"
      onclick={ontoggleblocks}>{t.bom.toggle}</button
    >
    <ShareMenu kind="machine" />
    <button
      class="btn"
      class:on={settingsOpen}
      aria-expanded={settingsOpen}
      data-testid="settings-toggle"
      onclick={ontogglesettings}>{t.settings}</button
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
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .machine {
    min-width: 0;
    max-width: 100%;
  }
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tier,
  .unverified {
    color: var(--muted);
    white-space: nowrap;
  }
  .unverified {
    cursor: help;
  }
  .chevron {
    flex: none;
  }
  .count {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .count-label {
    color: var(--muted);
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

  @media (max-width: 900px) {
    .count-label {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .bar {
      gap: 8px;
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
        'name count';
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
    .count {
      grid-area: count;
    }
    .right {
      grid-area: right;
    }
    .spacer {
      display: none;
    }
  }
</style>
