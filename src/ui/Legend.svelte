<script lang="ts">
  import { t } from '../i18n/en';
  import type { HatchKind } from '../model/multiblock/types';
  import type { PlanState } from '../model/plan/types';
  import { mergeColors } from './pipeline';

  interface Props {
    enabled: HatchKind[];
    colors: PlanState['colors'];
  }
  let { enabled, colors }: Props = $props();

  const merged = $derived(mergeColors(colors));
</script>

{#if enabled.length}
  <ul class="legend" data-testid="legend">
    {#each enabled as kind (kind)}
      <li><i style:background={merged[kind]}></i>{t.hatchKinds[kind]}</li>
    {/each}
  </ul>
{/if}

<style>
  .legend {
    position: fixed;
    /* Bottom-right: the renderer draws its axis gizmo bottom-left. */
    right: var(--gutter);
    bottom: 30px;
    margin: 0;
    padding: 8px 12px;
    list-style: none;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    z-index: 10;
    pointer-events: none;
    max-height: calc(100vh - var(--bar-h) - 90px);
    overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
    color: var(--text);
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  i {
    width: 10px;
    height: 10px;
    display: block;
  }
  @media (max-width: 640px) {
    .legend {
      display: none;
    }
  }
</style>
