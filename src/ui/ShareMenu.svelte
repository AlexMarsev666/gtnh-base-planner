<script lang="ts">
  import { t } from '../i18n/en';
  import { resetPlan } from './actions';
  import JsonFileInput from './JsonFileInput.svelte';
  import MenuButton, { type MenuApi } from './MenuButton.svelte';
  import { notify } from './notices';
  import { copyShareLink, downloadJson, openJsonFile, shareFallback } from './session';
  import { resetSite } from './siteActions';
  import { undoAction } from './siteHistory';
  import { copySiteLink, downloadSite, openSiteFile, siteShareFallback } from './siteSession';

  /**
   * The Share menu of the top bar: copy a share link, download or open the JSON file, reset. It acts on the
   * machine plan or on the template. The machine reset asks twice (the item turns into "Confirm reset" for 3 s);
   * the template reset can be undone from its notice.
   */
  interface Props {
    kind: 'machine' | 'site';
  }
  let { kind }: Props = $props();

  const site = $derived(kind === 'site');
  /** The link as text, when the clipboard was not available: it is shown in the menu to copy by hand. */
  const fallbackUrl = $derived(site ? $siteShareFallback : $shareFallback);

  async function copy(api: MenuApi) {
    await (site ? copySiteLink() : copyShareLink());
    if (!fallbackUrl) api.close();
  }

  let fileInput = $state<JsonFileInput>();

  let confirmReset = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  function stopConfirm() {
    clearTimeout(resetTimer);
    confirmReset = false;
  }
  function onreset(api: MenuApi) {
    if (site) {
      api.pick(() => {
        resetSite();
        notify(t.site.resetDone, 6000, 'edit', undoAction());
      });
      return;
    }
    if (confirmReset) {
      stopConfirm();
      api.pick(() => {
        resetPlan();
        notify(t.resetDone);
      });
      return;
    }
    confirmReset = true;
    resetTimer = setTimeout(() => (confirmReset = false), 3000);
  }
  $effect(() => () => clearTimeout(resetTimer));
</script>

<MenuButton label={t.shareMenuLabel} testid="share-menu" align="right" onclose={stopConfirm}>
  {#snippet button()}
    {t.shareMenu}
    <svg class="chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"
      ><path
        d="M1 1l4 4 4-4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      /></svg
    >
  {/snippet}
  {#snippet children(api)}
    <button
      class="menu-item"
      role="menuitem"
      data-testid={site ? 'site-share' : 'share'}
      onclick={() => void copy(api)}>{t.shareLink}</button
    >
    {#if fallbackUrl}
      <div class="fallback">
        <span class="hint">{t.linkFallback}</span>
        <input
          class="field url"
          readonly
          value={fallbackUrl}
          aria-label={t.linkFallback}
          data-testid="share-fallback"
          onfocus={(e) => e.currentTarget.select()}
        />
      </div>
    {/if}
    <button class="menu-item" role="menuitem" onclick={() => api.pick(site ? downloadSite : downloadJson)}
      >{t.downloadJson}</button
    >
    <button class="menu-item" role="menuitem" onclick={() => api.pick(() => fileInput?.open())}
      >{t.uploadJson}</button
    >
    <div class="menu-sep" role="separator"></div>
    <button
      class="menu-item danger"
      role="menuitem"
      data-testid={site ? 'site-reset' : 'reset'}
      onclick={() => onreset(api)}>{site ? t.site.reset : confirmReset ? t.resetConfirm : t.reset}</button
    >
  {/snippet}
</MenuButton>
<!-- Outside the menu, which is gone by the time the file dialog answers. -->
<JsonFileInput
  bind:this={fileInput}
  onfile={(file) => void (site ? openSiteFile(file) : openJsonFile(file))}
/>

<style>
  .chevron {
    flex: none;
  }
  .fallback {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 10px 8px;
  }
  .hint {
    font-size: 12px;
    color: var(--muted);
  }
  .url {
    width: 100%;
    min-width: 240px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-align: left;
    text-decoration: none;
    color: var(--text);
  }
  .url:focus {
    border-color: var(--text);
    text-decoration: none;
  }
</style>
