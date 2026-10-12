<script lang="ts">
  import { t } from '../i18n/en';
  import type { ValidityLine } from './validityText';

  /** What GT's structure check would say about the placed units: a verdict, the errors, then the hints. */
  interface Props {
    errors: ValidityLine[];
    hints: ValidityLine[];
    /** Called with the clicked line; without it the lines are plain text. */
    onpick?: (line: ValidityLine) => void;
    testid?: string;
  }
  let { errors, hints, onpick, testid = 'buildability' }: Props = $props();
</script>

<div class="build" data-testid={testid}>
  <p
    class="verdict"
    role="status"
    aria-live="polite"
    class:bad={errors.length > 0}
    data-testid="{testid}-verdict"
  >
    {errors.length ? t.validity.wontForm(errors.length) : t.validity.forms}
  </p>
  {#if errors.length}
    <ul class="lines" data-testid="{testid}-errors">
      {#each errors as line, i (i)}
        <li>
          {#if onpick}<button type="button" class="link" onclick={() => onpick(line)}>{line.text}</button>
          {:else}{line.text}{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if hints.length}
    <p class="sub">{t.validity.hints}</p>
    <ul class="lines hints" data-testid="{testid}-hints">
      {#each hints as line, i (i)}
        <li>
          {#if onpick}<button type="button" class="link" onclick={() => onpick(line)}>{line.text}</button>
          {:else}{line.text}{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .build {
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .verdict {
    margin: 0 0 4px;
    color: var(--muted);
  }
  .verdict.bad {
    color: var(--text);
  }
  .sub {
    margin: 8px 0 2px;
    color: var(--muted);
  }
  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
    color: var(--text);
  }
  .lines li {
    margin: 2px 0;
    overflow-wrap: anywhere;
  }
  .lines button {
    text-align: left;
    padding: 0;
    text-transform: none;
    letter-spacing: inherit;
  }
  .hints,
  .hints button {
    color: var(--muted);
  }
</style>
