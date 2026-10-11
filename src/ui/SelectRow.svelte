<script lang="ts">
  /** A full-width row with a label on the left and a plain-text dropdown on the right. */
  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string; disabled?: boolean }[];
    title?: string;
    testid?: string;
    /** Id of the element that explains or qualifies the choice. */
    describedby?: string;
    onchange: (value: string) => void;
  }
  let { label, value, options, title, testid, describedby, onchange }: Props = $props();
</script>

<li class="select-row">
  <label {title}>
    <span>{label}</span>
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
</li>

<style>
  .select-row {
    min-height: 26px;
  }
  label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    color: var(--muted);
  }
  label:hover {
    color: var(--text);
  }
  .select {
    flex: none;
    max-width: 160px;
    text-align: right;
    text-align-last: right;
    cursor: pointer;
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 4px;
    text-decoration-thickness: 1px;
  }
</style>
