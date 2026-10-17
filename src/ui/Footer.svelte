<script lang="ts">
  import { t } from '../i18n/en';
</script>

<footer class="footer" data-testid="footer">
  <span>{t.appName}</span>
  <span class="dot" aria-hidden="true">{t.separator}</span>
  <a class="link" href={t.repoUrl} target="_blank" rel="noopener noreferrer" data-testid="repo-link"
    >{t.repo}</a
  >
</footer>

<style>
  /* A quiet line under the stats, centred between the axis gizmo and the legend. */
  .footer {
    position: fixed;
    left: calc(50% + var(--outline-w, 0px) / 2);
    bottom: 4px;
    transform: translateX(-50%);
    display: flex;
    align-items: baseline;
    white-space: nowrap;
    font-size: 9px;
    color: var(--muted);
    z-index: 10;
  }
  .dot {
    margin: 0 8px;
  }
  .link {
    padding: 0;
    color: var(--muted);
  }
  /* Phones: the gizmo takes the bottom-left corner, so keep to the right. */
  @media (max-width: 640px) {
    .footer {
      left: auto;
      right: var(--gutter);
      transform: none;
    }
  }
</style>
