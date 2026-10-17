<script lang="ts">
  import { t } from '../i18n/en';
  import type { SiteLink } from '../model/site/types';
  import { site, siteLink } from '../state/site';
  import ResourceIcon from './ResourceIcon.svelte';
  import { updateSite, withLinkRemoved, withResourceColor } from './siteActions';
  import { endName, resName } from './siteNames';

  /** The selected link: what flows where, its colour, and removing it. */
  interface Props {
    link: SiteLink;
  }
  let { link }: Props = $props();

  const res = $derived($site.resources[link.resource]);
</script>

<section data-testid="site-link-inspector">
  <h2>{t.site.linkInspector}</h2>
  <div class="head">
    {#if res}<span class="res-icon"><ResourceIcon {res} size={20} /></span>{/if}
    <span class="name">{resName($site, link.resource)}</span>
    {#if res}<span class="meta">{t.site.kinds[res.kind]}</span>{/if}
  </div>
  <p class="route">{endName($site, link.from)} → {endName($site, link.to)}</p>
  {#if link.rate !== undefined && res}<p class="meta">{t.site.rateText(link.rate, res.kind)}</p>{/if}
  {#if res}
    <label class="row">
      <span>{t.site.linkColor}</span>
      <span class="swatch" style:background={res.color}>
        <input
          type="color"
          value={res.color}
          aria-label={t.site.linkColor}
          data-testid="site-link-color"
          onchange={(e) => updateSite((s) => withResourceColor(s, link.resource, e.currentTarget.value))}
        />
      </span>
    </label>
  {/if}
  <ul class="rows">
    <li class="row">
      <button
        class="btn danger"
        data-testid="site-link-remove"
        onclick={() => {
          updateSite((s) => withLinkRemoved(s, link.id));
          siteLink.set(null);
        }}>{t.site.removeLink}</button
      >
    </li>
  </ul>
</section>

<style>
  section {
    margin-top: 32px;
  }
  h2 {
    margin: 0 0 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .route {
    margin: 6px 0 0;
  }
  p.meta {
    margin: 4px 0 0;
  }
  .res-icon {
    flex: none;
    display: flex;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .swatch {
    position: relative;
    width: 14px;
    height: 14px;
    flex: none;
    cursor: pointer;
  }
  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: 0;
    padding: 0;
  }
  @media (max-width: 640px) {
    section {
      margin-top: 20px;
    }
  }
</style>
