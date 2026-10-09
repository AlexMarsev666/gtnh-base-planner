<script lang="ts">
  import { t } from '../i18n/en';
  import { optimizationProgress, cancelOptimization } from './sitePipeline';
  import { dismissNotice, notices } from './notices';
  import { answerShared, pendingShared } from './session';
  import { answerSharedSite, pendingSite } from './siteSession';
</script>

<div class="notices" role="status" aria-live="polite">
  {#if $optimizationProgress}
    <p class="notice optimization" data-testid="optimization-progress">
      <span>{t.site.optimizing}</span>
      <progress max="100" value={$optimizationProgress.percent} aria-label={t.site.optimizing}></progress>
      <span
        >{t.site.optimizeProgress(
          Math.floor($optimizationProgress.percent),
          $optimizationProgress.tried,
        )}</span
      >
      <button class="link active" onclick={cancelOptimization}>{t.site.cancelOptimize}</button>
    </p>
  {/if}
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
  .optimization {
    align-items: center;
  }
  .x {
    color: var(--muted);
  }
</style>
