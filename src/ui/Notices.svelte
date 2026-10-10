<script lang="ts">
  import { t } from '../i18n/en';
  import { dismissNotice, notices } from './notices';
  import { downloadUnreadable, recovery, retryUnreadable, startNew } from './recovery';
  import { answerShared, pendingShared } from './session';
  import { answerSharedSite, pendingSite } from './siteSession';
</script>

<div class="notices" role="status" aria-live="polite">
  {#each ['plan', 'site'] as const as kind (kind)}
    {@const entry = $recovery[kind]}
    {#if entry}
      <p class="notice confirm" data-testid="recovery-{kind}">
        <span>
          {t.recovery[kind](entry.error)}
          {entry.backupKey ? t.recovery.keptCopy : t.recovery.copyFailed}
          {t.recovery.paused}
        </span>
        <button class="link active" onclick={() => downloadUnreadable(kind)}>{t.recovery.download}</button>
        <button class="link" onclick={() => retryUnreadable(kind)}>{t.recovery.retry}</button>
        <button class="link" onclick={() => startNew(kind)}>{t.recovery.startNew}</button>
      </p>
    {/if}
  {/each}
  {#if $pendingShared}
    <p class="notice confirm" data-testid="shared-confirm">
      <span>{t.sharedPrompt}</span>
      <button class="link active" onclick={() => answerShared(true)}>{t.sharedOpen}</button>
      <button class="link" onclick={() => answerShared(false)}>{t.sharedKeep}</button>
    </p>
  {/if}
  {#if $pendingSite}
    <p class="notice confirm" data-testid="shared-site-confirm">
      <span>{t.site.sharedPrompt}</span>
      <button class="link active" onclick={() => answerSharedSite(true)}>{t.sharedOpen}</button>
      <button class="link" onclick={() => answerSharedSite(false)}>{t.sharedKeep}</button>
    </p>
  {/if}
  {#each $notices as n (n.id)}
    <p class="notice">
      <span>{n.text}</span>
      {#if n.action}
        {@const action = n.action}
        <button
          class="link active"
          onclick={() => {
            dismissNotice(n.id);
            action.run();
          }}>{action.label}</button
        >
      {/if}
      <button class="link x" aria-label={t.dismiss} onclick={() => dismissNotice(n.id)}>{t.close}</button>
    </p>
  {/each}
</div>

<style>
  .notices {
    position: fixed;
    left: var(--gutter);
    right: var(--gutter);
    bottom: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    /* Above the settings drawer / mobile sheet so feedback for drawer actions stays visible. */
    z-index: 45;
    pointer-events: none;
  }
  .notice {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    gap: 4px 16px;
    color: var(--text);
    background: var(--bg);
    padding: 2px 8px;
    pointer-events: auto;
    text-align: center;
  }
  .x {
    color: var(--muted);
  }
</style>
