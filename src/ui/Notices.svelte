<script lang="ts">
  import { t } from '../i18n/en';
  import { dismissNotice, notices } from './notices';
  import { downloadUnreadable, recovery, retryUnreadable, startNew } from './recovery';
  import { answerShared, pendingShared } from './session';
  import { answerSharedSite, pendingSite } from './siteSession';
  import { arrangeProgress } from '../state/site';
  import { cancelArrange } from './sitePipeline';
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
        <button class="btn small primary" onclick={() => downloadUnreadable(kind)}
          >{t.recovery.download}</button
        >
        <button class="btn small" onclick={() => retryUnreadable(kind)}>{t.recovery.retry}</button>
        <button class="btn small" onclick={() => startNew(kind)}>{t.recovery.startNew}</button>
      </p>
    {/if}
  {/each}
  {#if $pendingShared}
    <p class="notice confirm" data-testid="shared-confirm">
      <span>{t.sharedPrompt}</span>
      <button class="btn small primary" onclick={() => answerShared(true)}>{t.sharedOpen}</button>
      <button class="btn small" onclick={() => answerShared(false)}>{t.sharedKeep}</button>
    </p>
  {/if}
  {#if $pendingSite}
    <p class="notice confirm" data-testid="shared-site-confirm">
      <span>{t.site.sharedPrompt}</span>
      <button class="btn small primary" onclick={() => answerSharedSite(true)}>{t.sharedOpen}</button>
      <button class="btn small" onclick={() => answerSharedSite(false)}>{t.sharedKeep}</button>
    </p>
  {/if}
  {#if $arrangeProgress}
    {@const p = $arrangeProgress}
    <p class="notice" data-testid="arrange-progress">
      <span>{p.phase === 'optimize' ? t.site.optimizingPhase : t.site.arranging}</span>
      <progress
        max={p.total || undefined}
        value={p.total ? p.done : undefined}
        aria-label={p.phase === 'optimize' ? t.site.optimizingPhase : t.site.arranging}
      ></progress>
      <button class="btn small" data-testid="arrange-cancel" onclick={cancelArrange}
        >{t.site.arrangeCancel}</button
      >
    </p>
  {/if}
  {#each $notices as n (n.id)}
    <p class="notice">
      <span>{n.text}</span>
      {#if n.action}
        {@const action = n.action}
        <button
          class="btn small"
          onclick={() => {
            dismissNotice(n.id);
            action.run();
          }}>{action.label}</button
        >
      {/if}
      <button class="btn small" aria-label={t.dismiss} onclick={() => dismissNotice(n.id)}>{t.close}</button>
    </p>
  {/each}
</div>

<style>
  .notices {
    position: fixed;
    left: calc(var(--gutter) + var(--outline-w, 0px));
    right: var(--gutter);
    bottom: 96px;
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
    max-width: 640px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px 12px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    letter-spacing: normal;
    text-transform: none;
    pointer-events: auto;
    text-align: center;
  }
  progress {
    width: 160px;
    height: 8px;
    align-self: center;
    accent-color: var(--text);
  }
</style>
