<script lang="ts">
  import { t } from '../i18n/en';
  import { isolate, site } from '../state/site';
  import ResourceIcon from './ResourceIcon.svelte';
  import { siteBuild } from './sitePipeline';

  /** Resources carried by the site's nets, with how many terminals each net reached. */
  const entries = $derived.by(() => {
    const nets = $siteBuild.build?.nets ?? [];
    const by = new Map<string, { connected: number; total: number; routed: boolean }>();
    for (const n of nets) {
      const e = by.get(n.resource) ?? { connected: 0, total: 0, routed: false };
      if (n.route) {
        e.connected += n.route.connected;
        e.total += n.route.total;
        e.routed = true;
      }
      by.set(n.resource, e);
    }
    return [...by.entries()]
      .map(([key, e]) => ({ key, res: $site.resources[key], ...e }))
      .filter((e) => e.res)
      .sort((a, b) => a.res.name.localeCompare(b.res.name));
  });
</script>

{#if entries.length}
  <ul class="legend" data-testid="site-legend">
    {#each entries as e (e.key)}
      <li>
        <button
          class:active={$isolate === e.key}
          aria-pressed={$isolate === e.key}
          title={e.routed ? t.site.connected(e.connected, e.total) : t.site.kinds[e.res.kind]}
          onclick={() => isolate.set($isolate === e.key ? null : e.key)}
        >
          <span class="name">{e.res.name}</span>
          {#if e.routed && e.connected < e.total}<span class="warn">{e.connected}/{e.total}</span>{/if}
          <ResourceIcon res={e.res} size={18} />
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .legend {
    position: fixed;
    right: var(--gutter);
    bottom: 30px;
    max-height: calc(100vh - var(--bar-h) - 100px);
    overflow-y: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0;
    z-index: 10;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
  }
  button {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 3px 8px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface);
  }
  button.active {
    background: var(--surface);
    outline: 1px solid var(--pick);
    outline-offset: -1px;
  }
  .name {
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--text);
  }
  @media (max-width: 640px) {
    .legend {
      display: none;
    }
  }
</style>
