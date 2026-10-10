<script lang="ts">
  import { t } from '../i18n/en';
  import { selectedUnits } from '../state/store';
  import { machineBusy, type BuildResult } from './pipeline';
  import { statsParts } from './statsText';

  interface Props {
    result: BuildResult;
  }
  let { result }: Props = $props();

  const parts = $derived.by(() => {
    const p = statsParts(result, $selectedUnits);
    // Pipes follow the first, unrouted build; a newer build is computing while the old one stays on screen.
    if (result.pending) p.main.push(t.pipesRouting);
    if ($machineBusy) p.main.unshift(t.site.building);
    return p;
  });
</script>

{#if parts.main.length || parts.selected}
  <footer class="stats" data-testid="stats">
    {#each parts.main as part, i (i)}
      {#if i > 0}<span class="dot" aria-hidden="true">{t.separator}</span>{/if}
      <span>{part}</span>
    {/each}
    {#if parts.selected}
      {#if parts.main.length}<span class="dot" aria-hidden="true">{t.separator}</span>{/if}
      <span class="selected" data-testid="selected">{parts.selected}</span>
    {/if}
  </footer>
{/if}

<style>
  .stats {
    position: fixed;
    /* Leaves room for the axis gizmo (bottom-left) and the hatch legend (bottom-right). */
    left: 160px;
    right: 160px;
    bottom: 22px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px 0;
    z-index: 10;
    pointer-events: none;
  }
  .dot {
    margin: 0 10px;
    color: var(--faint);
  }
  .selected {
    color: var(--text);
  }
  @media (max-width: 640px) {
    /* On phones the gizmo owns the bottom-left corner: the stats sit under the top bar instead. */
    .stats {
      left: var(--gutter);
      right: var(--gutter);
      bottom: auto;
      top: calc(var(--bar-h) + 2px);
      justify-content: flex-start;
      column-gap: 14px;
    }
    /* Wrapped lines must not start with a dangling separator. */
    .dot {
      display: none;
    }
  }
</style>
