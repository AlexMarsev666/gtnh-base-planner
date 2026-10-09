<script lang="ts">
  import { catalogSupportReason } from '../data/catalogSupport';
  import { t } from '../i18n/en';

  let { id, compact = false }: { id: string; compact?: boolean } = $props();
  const reason = $derived(catalogSupportReason(id));
</script>

{#if reason}
  <span
    class="support"
    class:compact
    data-testid="catalog-support"
    data-machine={id}
    title={t.catalogSupportReasons[reason]}
  >
    <span class="label">{t.catalogLimited}</span>
    {#if !compact}<span class="reason">{t.catalogSupportReasons[reason]}</span>{/if}
  </span>
{/if}

<style>
  .support {
    display: block;
    color: var(--pick);
    margin: 12px 0;
    font-size: 0.9em;
    line-height: 1.5;
  }
  .label {
    font-weight: 600;
  }
  .reason {
    display: block;
    color: var(--muted);
  }
  .compact {
    margin: 0;
    font-size: 0.8em;
  }
</style>
