<script lang="ts">
  /**
   * A hidden file input for "open JSON": `open()` (through `bind:this`) shows the file dialog, and `onfile` gets
   * the chosen file. It lives outside any menu, which is gone by the time the dialog answers.
   */
  let { onfile }: { onfile: (file: File) => void } = $props();

  let input = $state<HTMLInputElement>();

  export function open(): void {
    input?.click();
  }

  function onchange(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) onfile(file);
  }
</script>

<input
  bind:this={input}
  class="visually-hidden"
  type="file"
  accept="application/json,.json"
  tabindex="-1"
  aria-hidden="true"
  {onchange}
/>
