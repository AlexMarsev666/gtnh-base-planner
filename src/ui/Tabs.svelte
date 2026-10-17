<script lang="ts">
  /**
   * A segmented control that switches between panels. The caller renders the active panel itself, as
   * `role="tabpanel"` with `id="{testid}-panel"` and `aria-labelledby="{testid}-tab-{active}"`.
   */
  interface Tab {
    id: string;
    label: string;
    /** A count (red when above 0) or a short text. */
    badge?: number | string;
  }
  interface Props {
    tabs: Tab[];
    active: string;
    onchange: (id: string) => void;
    /** Accessible name of the tab list. */
    label: string;
    testid: string;
  }
  let { tabs, active, onchange, label, testid }: Props = $props();

  let buttons = $state<HTMLButtonElement[]>([]);

  function onkeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((x) => x.id === active);
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (i + last) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0 || i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onchange(tabs[next].id);
    buttons[next]?.focus();
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="tabs" role="tablist" aria-label={label} data-testid={testid} {onkeydown}>
  {#each tabs as tab, i (tab.id)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="tab"
      id="{testid}-tab-{tab.id}"
      class="tab"
      class:on={tab.id === active}
      aria-selected={tab.id === active}
      aria-controls="{testid}-panel"
      tabindex={tab.id === active ? 0 : -1}
      data-testid="{testid}-{tab.id}"
      onclick={() => onchange(tab.id)}
    >
      {tab.label}
      {#if tab.badge !== undefined && tab.badge !== 0}
        <span class="badge" class:alert={typeof tab.badge === 'number'}>{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 7px;
    background: var(--track);
  }
  .tab {
    flex: 1;
    appearance: none;
    border: 0;
    border-radius: 5px;
    background: none;
    padding: 4px 6px;
    font-size: 13px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.on {
    background: var(--bg);
    color: var(--text);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 14%),
      0 0 0 0.5px rgb(0 0 0 / 6%);
  }
  .tab:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .badge {
    min-width: 16px;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--faint);
    color: var(--bg);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
  }
  .badge.alert {
    background: var(--pick);
  }
</style>
