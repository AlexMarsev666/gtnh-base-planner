<script lang="ts">
  import { t } from '../i18n/en';
  import { flowAnimation } from '../state/site';
</script>

<button
  class="link flow"
  class:active={$flowAnimation}
  aria-pressed={$flowAnimation}
  title={t.site.animationHint}
  data-testid="site-animation"
  onclick={() => flowAnimation.update((v) => !v)}>{t.site.animation}</button
>

<style>
  .flow {
    position: fixed;
    left: calc(var(--gutter) + var(--outline-w, 0px));
    /* Right under the site name and size in the top bar. */
    top: calc(var(--bar-h) - 8px);
    padding: 0;
    z-index: 10;
  }
  /* On phones the bar has two rows and the stats line sits below it: the Template panel has the same switch. */
  @media (max-width: 640px) {
    .flow {
      display: none;
    }
  }
</style>
