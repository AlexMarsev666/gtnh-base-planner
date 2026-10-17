<script lang="ts">
  import { t } from '../i18n/en';

  /** A port is selected: no turning or raising, but it can go back to automatic placement. */
  let { port = false }: { port?: boolean } = $props();

  const KEY = 'gtnh-planner:move-hint';

  function storedOpen(): boolean {
    try {
      return globalThis.localStorage?.getItem(KEY) !== '0';
    } catch {
      return true;
    }
  }

  /** Folded to a small "Controls" link once closed; remembered per browser. */
  let open = $state(storedOpen());

  function setOpen(on: boolean) {
    open = on;
    try {
      globalThis.localStorage?.setItem(KEY, on ? '1' : '0');
    } catch {
      // Not important enough to report.
    }
  }

  const rows: [string[], string][] = $derived(
    port
      ? [
          [['Drag'], t.site.hint.dragPort],
          [['←', '↑', '→', '↓'], t.site.hint.move],
          [['Shift', '+', '↑'], t.site.hint.fast],
          [['A'], t.site.hint.autoPort],
          [['F'], t.site.hint.frame],
          [['Ctrl', '+', 'Z'], t.site.hint.undo],
          [['Esc'], t.site.hint.deselect],
        ]
      : [
          [['Drag'], t.site.hint.drag],
          [['←', '↑', '→', '↓'], t.site.hint.move],
          [['Shift', '+', '↑'], t.site.hint.fast],
          [['PgUp', '/', 'PgDn'], t.site.hint.lift],
          [['R'], t.site.hint.rotate],
          [['F'], t.site.hint.frame],
          [['Ctrl', '+', 'Z'], t.site.hint.undo],
          [['Del'], t.site.hint.remove],
          [['Esc'], t.site.hint.deselect],
        ],
  );
</script>

{#if open}
  <div class="card" role="dialog" aria-label={t.site.hint.title} data-testid="move-hint">
    <div class="top">
      <span class="title">{port ? t.site.hint.titlePort : t.site.hint.title}</span>
      <button class="link x" aria-label={t.close} onclick={() => setOpen(false)}>×</button>
    </div>
    <ul>
      {#each rows as [keys, text] (text)}
        <li>
          <span class="keys"
            >{#each keys as k, i (i)}{#if k === '+' || k === '/'}<span class="plus">{k}</span>{:else}<kbd
                  >{k}</kbd
                >{/if}{/each}</span
          >
          <span class="text">{text}</span>
        </li>
      {/each}
    </ul>
    <p class="note">{t.site.hint.camera}</p>
  </div>
{:else}
  <button class="link chip" data-testid="move-hint-open" onclick={() => setOpen(true)}
    >{t.site.hint.open}</button
  >
{/if}

<style>
  .card,
  .chip {
    position: fixed;
    left: calc(var(--gutter) + var(--outline-w, 0px));
    /* Above the axis gizmo in the bottom-left corner. */
    bottom: 128px;
    z-index: 20;
  }
  .card {
    width: 250px;
    padding: 10px 12px 12px;
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.07);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .title {
    color: var(--text);
  }
  .x {
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 24px;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 96px;
    flex: none;
  }
  kbd {
    min-width: 18px;
    padding: 1px 4px;
    border: 1px solid var(--faint);
    border-bottom-width: 2px;
    color: var(--text);
    font: inherit;
    font-size: 10px;
    text-align: center;
    letter-spacing: 0;
    text-transform: none;
  }
  .plus {
    color: var(--muted);
  }
  .text,
  .note {
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .text {
    color: var(--text);
  }
  .note {
    margin: 8px 0 0;
    color: var(--muted);
  }
  /* Phones have no arrow keys: the nudge pad in the Template panel does the same. */
  @media (max-width: 640px), (pointer: coarse) {
    .card,
    .chip {
      display: none;
    }
  }
</style>
