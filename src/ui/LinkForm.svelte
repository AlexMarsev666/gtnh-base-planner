<script lang="ts">
  import { t } from '../i18n/en';
  import type { ResourceKind } from '../model/site/types';
  import { site, siteLink, siteLinkDraft } from '../state/site';
  import { updateSite, withLinkAdded, type LinkEnd } from './siteActions';
  import { menuName, resName } from './siteNames';

  /** The form for a new link, at the top of the inspector while the draft is on. */
  let linkFrom = $state('');
  let linkTo = $state('');
  let linkRes = $state('');
  let newResName = $state('');
  let newResKind = $state<ResourceKind>('item');
  let linkRate = $state('');
  const resourceKeys = $derived(
    Object.keys($site.resources).sort((a, b) => resName($site, a).localeCompare(resName($site, b))),
  );
  function end(v: string): LinkEnd | null {
    if (v === '@port') return { port: true };
    return v ? { group: v } : null;
  }
  function addLink() {
    const from = end(linkFrom);
    const to = end(linkTo);
    if (!from || !to) return;
    const res = linkRes && linkRes !== '@new' ? { key: linkRes } : { name: newResName, kind: newResKind };
    const rate = Number(linkRate);
    const before = $site;
    updateSite((s) => withLinkAdded(s, from, to, res, Number.isFinite(rate) && rate > 0 ? rate : undefined));
    if ($site === before) return;
    newResName = '';
    linkRate = '';
    // The new link is the one the old list did not have; selecting it ends the draft.
    const added = $site.links.find((l) => !before.links.some((b) => b.id === l.id));
    if (added) siteLink.set(added.id);
    else siteLinkDraft.set(false);
  }
</script>

<section>
  <h2>{t.site.newLink}</h2>
  <div class="form" data-testid="site-link-form">
    <label class="pair wide"
      ><span>{t.site.from}</span>
      <select class="field select" bind:value={linkFrom} aria-label={t.site.from}>
        <option value="">—</option>
        <option value="@port">{t.site.inputPort}</option>
        {#each $site.groups as g (g.id)}<option value={g.id}>{menuName($site, g.id)}</option>{/each}
      </select></label
    >
    <label class="pair wide"
      ><span>{t.site.to}</span>
      <select class="field select" bind:value={linkTo} aria-label={t.site.to}>
        <option value="">—</option>
        <option value="@port">{t.site.outputPort}</option>
        {#each $site.groups as g (g.id)}<option value={g.id}>{menuName($site, g.id)}</option>{/each}
      </select></label
    >
    <label class="pair wide"
      ><span>{t.site.resource}</span>
      <select class="field select" bind:value={linkRes} aria-label={t.site.resource}>
        <option value="@new">{t.site.newResource}</option>
        {#each resourceKeys as k (k)}<option value={k}>{resName($site, k)}</option>{/each}
      </select></label
    >
    {#if !linkRes || linkRes === '@new'}
      <label class="pair wide"
        ><span>{t.site.resourceName}</span><input
          class="field text"
          type="text"
          bind:value={newResName}
          aria-label={t.site.resourceName}
        /></label
      >
      <label class="pair wide"
        ><span>{t.site.kind}</span>
        <select class="field select" bind:value={newResKind} aria-label={t.site.kind}>
          <option value="item">{t.site.kinds.item}</option>
          <option value="fluid">{t.site.kinds.fluid}</option>
          <option value="power">{t.site.kinds.power}</option>
        </select></label
      >
    {/if}
    <label class="pair wide"
      ><span>{t.site.rate}</span><input
        class="field text"
        type="text"
        inputmode="decimal"
        bind:value={linkRate}
        aria-label={t.site.rate}
      /></label
    >
    <div class="row">
      <button class="link active" data-testid="site-add-link" onclick={addLink}>{t.site.addLink}</button>
      <button class="link" onclick={() => siteLinkDraft.set(false)}>{t.site.addLinkClose}</button>
    </div>
  </div>
</section>

<style>
  section {
    margin-top: 32px;
  }
  h2 {
    color: var(--text);
    font: inherit;
    margin: 0 0 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair.wide {
    justify-content: space-between;
    width: 100%;
  }
  .pair.wide > span {
    flex: none;
    white-space: nowrap;
  }
  .text {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    border-bottom: 1px dotted var(--muted);
    padding-bottom: 2px;
  }
  .text:focus {
    border-bottom: 1px solid var(--text);
    text-decoration: none;
  }
  .select {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    max-width: 200px;
    cursor: pointer;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  @media (max-width: 640px) {
    section {
      margin-top: 20px;
    }
  }
</style>
