<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A full-width on/off row: label on the left, a switch on the right. */
  interface Props {
    on: boolean;
    label: string;
    title?: string;
    testid?: string;
    ontoggle: () => void;
    /** Unavailable: stays focusable, ignores clicks; `hint` says why. */
    disabled?: boolean;
    hint?: string;
    /** Shown before the label (a colour swatch, say); outside the button. */
    before?: Snippet;
  }
  let { on, label, title, testid, ontoggle, disabled, hint, before }: Props = $props();
  const hintId = $props.id();
</script>

<li class="toggle-row">
  {#if before}{@render before()}{/if}
  <button
    class="toggle"
    class:on
    role="switch"
    aria-checked={on}
    {title}
    aria-disabled={disabled ? 'true' : undefined}
    aria-describedby={disabled && hint ? hintId : undefined}
    data-testid={testid}
    onclick={() => !disabled && ontoggle()}
    ><span>{label}</span><span class="track" aria-hidden="true"></span></button
  >
  {#if disabled && hint}<span class="hint" id={hintId}>{hint}</span>{/if}
</li>

<style>
  .toggle-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 12px;
    min-height: 32px;
  }
  .hint {
    flex-basis: 100%;
    color: var(--muted);
    font-size: 12px;
  }
  .toggle {
    appearance: none;
    background: none;
    border: 0;
    border-radius: 4px;
    margin: 0;
    padding: 4px 0;
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    text-align: left;
    cursor: pointer;
    color: var(--text);
  }
  .toggle:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .toggle[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .track {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: #d4d4d4;
    box-shadow: inset 0 0 0 1px var(--disabled);
    transition: background-color 150ms;
  }
  .track::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg);
    box-shadow:
      0 0 0 1px var(--disabled),
      0 1px 2px rgb(0 0 0 / 25%);
    transition: transform 150ms;
  }
  .on .track {
    background: var(--text);
    box-shadow: none;
  }
  .on .track::after {
    transform: translateX(14px);
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .track::after {
      transition: none;
    }
  }
</style>
