<script lang="ts">
  import { PLACEHOLDER_ID, SINGLE_BLOCK_ID } from '../data/generic';
  import { t } from '../i18n/en';
  import { plan } from '../state/store';
  import { machineDef } from './pipeline';
  import { addGroup, addPlanToSite } from './siteCommands';
  import JsonFileInput from './JsonFileInput.svelte';
  import { openSiteFile } from './siteSession';

  /**
   * What an empty Template offers instead of a blank scene: the card sits in the free area of the canvas
   * (between the outline, the open drawer and the bars), and only the card takes pointer events.
   */
  interface Props {
    /** Open the multiblock picker to add a group. */
    onadd: () => void;
    onimport: () => void;
  }
  let { onadd, onimport }: Props = $props();

  const name = $derived($machineDef?.name ?? $plan.multiblockId);

  let fileInput = $state<JsonFileInput>();
</script>

<div class="area">
  <section class="card" aria-labelledby="site-empty-title" data-testid="site-empty">
    <h2 id="site-empty-title">{t.site.empty.title}</h2>
    <p class="lead">{t.site.empty.lead}</p>
    <div class="options">
      <button class="option primary" data-testid="site-empty-add" onclick={onadd}>
        <span class="icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16"
            ><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" /></svg
          >
        </span>
        <span class="words"><b>{t.site.empty.add}</b><span class="note">{t.site.empty.addNote}</span></span>
      </button>
      <button class="option" data-testid="site-empty-current" onclick={addPlanToSite}>
        <span class="icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16"
            ><path
              d="M8 2l5 2.5v7L8 14l-5-2.5v-7zM3 4.5l5 2.5 5-2.5M8 7v7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            /></svg
          >
        </span>
        <span class="words"
          ><b>{t.site.empty.current(name, $plan.count)}</b><span class="note">{t.site.empty.currentNote}</span
          ></span
        >
      </button>
      <button class="option" data-testid="site-empty-import" onclick={onimport}>
        <span class="icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16"
            ><path
              d="M8 2v8M5 7l3 3 3-3M3 13h10"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            /></svg
          >
        </span>
        <span class="words"
          ><b>{t.site.empty.import}</b><span class="note">{t.site.empty.importNote}</span></span
        >
      </button>
    </div>
    <p class="also">
      {t.site.empty.also}
      <button class="link" onclick={() => addGroup(SINGLE_BLOCK_ID)}>{t.site.empty.single}</button>
      ·
      <button class="link" onclick={() => addGroup(PLACEHOLDER_ID)}>{t.site.empty.placeholder}</button>
      ·
      <button class="link" onclick={() => fileInput?.open()}>{t.site.empty.openJson}</button>
    </p>
  </section>
  <JsonFileInput bind:this={fileInput} onfile={(file) => void openSiteFile(file)} />
</div>

<style>
  .area {
    position: fixed;
    top: calc(var(--bar-h) + 56px);
    bottom: 64px;
    left: calc(var(--gutter) + var(--outline-w, 0px));
    right: calc(var(--gutter) + var(--drawer-w, 0px));
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .card {
    pointer-events: auto;
    width: 440px;
    max-width: 100%;
    max-height: 100%;
    overflow-y: auto;
    padding: 24px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgb(0 0 0 / 10%);
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
    color: var(--text);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: normal;
    text-transform: none;
    color: var(--text);
  }
  .lead {
    margin: 0 0 16px;
    color: var(--muted);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .option {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    margin: 0;
    padding: 8px 12px 8px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    text-align: left;
    cursor: pointer;
  }
  .option:hover {
    background: var(--surface);
  }
  .option:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .option.primary {
    border-color: var(--text);
  }
  .icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
  }
  .primary .icon {
    border-color: var(--text);
    color: var(--text);
  }
  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  b {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .note {
    font-size: 12px;
    color: var(--muted);
  }
  .also {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--muted);
  }
  .also .link {
    padding: 0;
    text-decoration: underline;
  }
</style>
