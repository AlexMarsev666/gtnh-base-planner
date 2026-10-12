<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/en';

  /** A full-width on/off row: label on the left, its state written out on the right. */
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
    aria-pressed={on}
    {title}
    aria-disabled={disabled ? 'true' : undefined}
    aria-describedby={disabled && hint ? hintId : undefined}
    data-testid={testid}
    onclick={() => !disabled && ontoggle()}
    ><span>{label}</span><span class="state">{on ? t.on : t.off}</span></button
  >
  {#if disabled && hint}<span class="hint" id={hintId}>{hint}</span>{/if}
</li>

<style>
  .toggle-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 12px;
    min-height: 26px;
  }
  .hint {
    flex-basis: 100%;
    color: var(--faint);
    font-size: 0.9em;
  }
  .toggle {
    appearance: none;
    background: none;
    border: 0;
    border-radius: 0;
    margin: 0;
    padding: 4px 0;
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    text-align: left;
    cursor: pointer;
    color: var(--muted);
  }
  .toggle[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .toggle:hover:not([aria-disabled='true']),
  .toggle.on {
    color: var(--text);
  }
  .state {
    flex: none;
    color: var(--muted);
  }
  .on .state {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 4px;
    text-decoration-thickness: 1px;
  }
</style>
