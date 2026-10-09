<script lang="ts">
  import { catalogSupportReason, catalogSupportStatus } from '../data/catalogSupport';
  import { t } from '../i18n/en';

  let { id, compact = false }: { id: string; compact?: boolean } = $props();
  const reason = $derived(catalogSupportReason(id));
  const status = $derived(catalogSupportStatus(id));
</script>

{#if reason}
  <span
    class="support"
    class:compact
    class:neutral={status === 'unverified'}
    data-testid="catalog-support"
    data-machine={id}
    data-status={status}
    title={t.catalogSupportReasons[reason]}
  >
    <span class="label"
      >{status === 'unverified'
        ? t.catalogUnverified
        : status === 'known-problem'
          ? t.catalogKnownProblem
          : t.catalogLimited}</span
    >
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
  .neutral {
    color: var(--muted);
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
