<script lang="ts">
  /**
   * A full-width row with a label on the left and the choice on the right: a dropdown, or with `segmented`
   * a segmented control. Segment only a fixed list of up to three options: a list that changes while the
   * panel is open must stay a dropdown.
   */
  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    title?: string;
    testid?: string;
    /** Id of the element that explains or qualifies the choice. */
    describedby?: string;
    /** Draw the row as the one picked in the 3D view (marked `data-emphasis` so the page can scroll to it). */
    emphasis?: boolean;
    segmented?: boolean;
    onchange: (value: string) => void;
  }
  let {
    label,
    value,
    options,
    title,
    testid,
    describedby,
    emphasis = false,
    segmented = false,
    onchange,
  }: Props = $props();

  let buttons = $state<HTMLButtonElement[]>([]);
  /** The option that takes Tab: the checked one, or the first enabled one when none is. */
  const stop = $derived.by(() => {
    const checked = options.findIndex((o) => o.value === value && !o.disabled);
    return checked >= 0 ? checked : options.findIndex((o) => !o.disabled);
  });

  function choose(v: string) {
    if (v !== value) onchange(v);
  }

  /** Arrows, Home and End only move focus; click, Space or Enter picks. */
  function onkeydown(e: KeyboardEvent) {
    const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
    const at = enabled.indexOf(buttons.indexOf(e.target as HTMLButtonElement));
    const last = enabled.length - 1;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? at < 0
          ? 0
          : (at + 1) % enabled.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? at < 0
            ? last
            : (at + last) % enabled.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (to < 0 || !enabled.length) return;
    e.preventDefault();
    e.stopPropagation();
    buttons[enabled[to]]?.focus();
  }
</script>

<li class="select-row" class:emphasis data-emphasis={emphasis || undefined}>
  {#if segmented}
    <div class="line" {title}>
      <span class="name">{label}</span>
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        class="seg"
        role="radiogroup"
        aria-label={label}
        aria-describedby={describedby}
        data-testid={testid}
        {onkeydown}
      >
        {#each options as o, i (o.value)}
          <button
            bind:this={buttons[i]}
            type="button"
            role="radio"
            class="opt"
            class:on={o.value === value}
            aria-checked={o.value === value}
            tabindex={i === stop ? 0 : -1}
            disabled={o.disabled}
            data-testid={testid ? `${testid}-${o.value}` : undefined}
            onclick={() => choose(o.value)}>{o.label}</button
          >
        {/each}
      </div>
    </div>
  {:else}
    <label class="line" {title}>
      <span class="name">{label}</span>
      <select
        class="field select"
        {value}
        aria-label={label}
        aria-describedby={describedby}
        data-testid={testid}
        onchange={(e) => onchange(e.currentTarget.value)}
      >
        {#each options as o (o.value)}
          <option value={o.value} selected={o.value === value} disabled={o.disabled}>{o.label}</option>
        {/each}
      </select>
    </label>
  {/if}
</li>

<style>
  .select-row {
    min-height: 32px;
    padding: 1px 0;
  }
  .emphasis {
    margin: 0 -6px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--line);
    outline: 1px solid var(--faint);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 4px 12px;
    min-height: 30px;
    color: var(--text);
  }
  .name {
    min-width: 0;
  }
  .select {
    flex: none;
    max-width: 170px;
  }
  .seg {
    display: flex;
    gap: 2px;
    padding: 3px;
    margin-left: auto;
    border-radius: 7px;
    background: var(--track);
  }
  .opt {
    appearance: none;
    border: 0;
    border-radius: 5px;
    background: none;
    padding: 3px 10px;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
    white-space: nowrap;
    color: var(--segment-text);
    cursor: pointer;
  }
  .opt:hover:not(:disabled) {
    color: var(--text);
  }
  .opt.on {
    background: var(--bg);
    color: var(--text);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 14%),
      0 0 0 0.5px rgb(0 0 0 / 6%);
  }
  .opt:disabled {
    color: var(--disabled);
    cursor: default;
  }
  .opt:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
</style>
