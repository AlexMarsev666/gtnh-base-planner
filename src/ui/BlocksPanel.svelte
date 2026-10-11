<script lang="ts">
  import { t } from '../i18n/en';
  import { matchesQuery, progress, requiredBlocks, sortBom, tickedLast } from '../model/bom';
  import type { PlanState } from '../model/plan/types';
  import type { SceneModel } from '../model/render/types';
  import { checked, clearChecked, cycleSort, sortMode, toggleChecked } from '../state/checklist';
  import { blockIconFaces } from './catalogView';
  import { blockIcon } from './icons';
  import { planBom } from './pipeline';

  interface Props {
    scene: SceneModel | null;
    /** The machine plan, whose machine and hatch tiers the list shows (the template view passes none). */
    tiers?: Pick<PlanState, 'tier' | 'hatchTiers'>;
    onclose: () => void;
  }
  let { scene, tiers, onclose }: Props = $props();

  const bom = $derived(
    sortBom(
      scene
        ? tiers
          ? planBom(scene, tiers)
          : requiredBlocks(scene)
        : { blocks: [], io: [], totalBlocks: 0 },
      $sortMode,
    ),
  );
  const done = $derived(progress(bom, $checked));
  const hasAnything = $derived(bom.blocks.length > 0);

  let query = $state('');
  const tierName = (row: { label: string; anyTier: boolean }) =>
    row.anyTier ? `${row.label} ${t.bom.anyTier}` : row.label;
  // What is left to gather comes first; ticked rows sink to the bottom of their list.
  const blockRows = $derived(
    tickedLast(
      bom.blocks.filter((r) => matchesQuery(tierName(r), query)),
      $checked,
    ),
  );
  const ioRows = $derived(
    tickedLast(
      bom.io.filter((r) => matchesQuery(t.bom.ioClass[r.io], query)),
      $checked,
    ),
  );
  const searching = $derived(query.trim() !== '');
</script>

<aside class="drawer" aria-label={t.bom.title} data-testid="blocks-panel">
  <div class="top">
    <span class="title">{t.bom.title}</span>
    <button class="link" onclick={onclose}>{t.close}</button>
  </div>

  {#if hasAnything}
    <div class="controls">
      <button
        class="link"
        class:active={$sortMode !== 'grouped'}
        title={t.bom.sortHint}
        data-testid="bom-sort"
        onclick={cycleSort}>{t.bom.sort($sortMode)}</button
      >
      <span class="progress" title={t.bom.gathered(done.done, done.total)} data-testid="bom-progress"
        >{done.done}/{done.total}</span
      >
    </div>
    {#if $checked.size}
      <button class="link clear" data-testid="bom-clear" onclick={clearChecked}>{t.bom.clear}</button>
    {/if}
    <input
      class="field search"
      type="search"
      placeholder={t.bom.search}
      aria-label={t.bom.search}
      autocomplete="off"
      spellcheck="false"
      data-testid="bom-search"
      bind:value={query}
    />

    {#if searching && !blockRows.length && !ioRows.length}
      <p class="hint spaced" data-testid="bom-no-match">{t.bom.noMatches}</p>
    {/if}

    {#if blockRows.length}
      <section>
        <h2>{t.bom.blocks}</h2>
        <ul class="rows">
          {#each blockRows as row (row.key)}
            {@const name = tierName(row)}
            <li>
              <label class="row" class:done={$checked.has(row.key)} data-testid="bom-row">
                <input
                  type="checkbox"
                  aria-label={t.bom.tick(name)}
                  data-testid="bom-check"
                  checked={$checked.has(row.key)}
                  onchange={() => toggleChecked(row.key)}
                />
                <canvas
                  class="cube"
                  aria-hidden="true"
                  use:blockIcon={blockIconFaces(
                    row.blockId,
                    row.hatchKind ? { kind: row.hatchKind, base: row.baseBlockId } : undefined,
                  )}
                ></canvas>
                <span class="count">{row.count}</span>
                <span class="name">{name}</span>
              </label>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if ioRows.length || (!bom.io.length && !searching)}
      <section>
        <h2>{t.bom.io}</h2>
        {#if ioRows.length}
          <ul class="rows">
            {#each ioRows as row (row.key)}
              {@const name = t.bom.ioClass[row.io]}
              <li>
                <label class="row io" class:done={$checked.has(row.key)} data-testid="bom-row">
                  <input
                    type="checkbox"
                    aria-label={t.bom.tick(name)}
                    data-testid="bom-check"
                    checked={$checked.has(row.key)}
                    onchange={() => toggleChecked(row.key)}
                  />
                  <span class="count">{row.count}</span>
                  <span class="name">{name}</span>
                </label>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint" data-testid="bom-io-off">{t.bom.ioOff}</p>
        {/if}
      </section>
    {/if}
  {:else}
    <p class="hint">{t.bom.empty}</p>
  {/if}
</aside>

<style>
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 300px;
    background: var(--bg);
    border-left: 1px solid var(--line);
    z-index: 40;
    overflow-y: auto;
    padding: 0 var(--gutter) 48px;
  }
  .top {
    height: var(--bar-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    color: var(--text);
  }
  .controls {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .progress {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    cursor: default;
  }
  .search {
    display: block;
    width: 100%;
    margin-top: 14px;
    text-align: left;
  }
  .search::-webkit-search-cancel-button {
    display: none;
  }
  .spaced {
    margin-top: 20px;
  }
  .clear {
    display: block;
    margin-top: 10px;
  }
  section {
    margin-top: 28px;
  }
  h2 {
    font: inherit;
    color: var(--text);
    margin: 0 0 10px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 32px;
    cursor: pointer;
  }
  .row input {
    flex: none;
    margin: 0;
    accent-color: var(--text);
    cursor: pointer;
  }
  .cube {
    flex: none;
    width: 28px;
    height: 28px;
  }
  .count {
    flex: none;
    min-width: 2.2em;
    text-align: right;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
    text-transform: none;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  /* Ticked rows recede so what is left to gather stands out. */
  .row.done .count,
  .row.done .name {
    color: var(--faint);
    text-decoration: line-through;
  }
  .row.done .cube {
    opacity: 0.45;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }

  @media (max-width: 640px) {
    .drawer {
      top: auto;
      left: 0;
      width: auto;
      max-height: 62vh;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .top {
      height: 48px;
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    section {
      margin-top: 20px;
    }
  }
</style>
