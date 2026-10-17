<script lang="ts">
  import { blockInfo } from '../data/blocks';
  import { FLOOR_BLOCKS } from '../data/floor';
  import { t } from '../i18n/en';
  import { MAX_CORRIDOR, SITE_MAX_SIZE, SITE_MIN_SIZE } from '../share/siteCodec';
  import { ROUTING_STYLES } from '../model/site/types';
  import {
    flowAnimation,
    showIcons,
    site,
    siteCables,
    siteGroup,
    siteLink,
    siteLinkDraft,
    sitePipes,
  } from '../state/site';
  import { connectBelow, xray } from '../state/store';
  import GroupInspector from './GroupInspector.svelte';
  import LinkForm from './LinkForm.svelte';
  import LinkInspector from './LinkInspector.svelte';
  import { notify } from './notices';
  import { narrow } from './narrow';
  import NumberStepper from './NumberStepper.svelte';
  import {
    resetSite,
    updateSite,
    withCorridor,
    withFloor,
    withName,
    withRouting,
    withSiteSize,
  } from './siteActions';
  import { arrange, neatArrange } from './siteCommands';
  import { canRedo, canUndo, redoSite, undoAction, undoSite } from './siteHistory';
  import { ROUTING_DEPTHS, depthReduced, routingView, splitWarnings } from './siteInspect';
  import { siteBuild, siteRouteInfo } from './sitePipeline';
  import SelectRow from './SelectRow.svelte';
  import { groupName as siteGroupName, resName as siteResName } from './siteNames';
  import SiteOutline from './SiteOutline.svelte';
  import { copySiteLink, downloadSite, openSiteFile, siteShareFallback } from './siteSession';
  import ToggleRow from './ToggleRow.svelte';
  import { groupErrorCount } from './validityText';

  interface Props {
    onclose: () => void;
    onimport: () => void;
    /** Open the multiblock picker to add a group (`add`) or change the selected one (`change`). */
    onpick: (purpose: 'add' | 'change') => void;
  }
  let { onclose, onimport, onpick }: Props = $props();

  const build = $derived($siteBuild.build);
  const selected = $derived($site.groups.find((g) => g.id === $siteGroup) ?? null);
  const placed = $derived(build?.groups.find((g) => g.group.id === $siteGroup));
  const selectedLink = $derived($site.links.find((l) => l.id === $siteLink) ?? null);

  const groupName = (id: string) => siteGroupName($site, id);
  const resName = (key: string) => siteResName($site, key);

  const warnings = $derived(splitWarnings(build?.warnings ?? []));
  const notes = $derived(build?.notes ?? []);
  /** Groups GT would not form, with their number of problems. */
  const wontForm = $derived(
    (build?.groups ?? []).map((g) => ({ id: g.group.id, n: groupErrorCount(g) })).filter((g) => g.n > 0),
  );

  const routingState = $derived(routingView($site, $connectBelow));
  const routing = $derived(routingState.routing);
  const routingStyles = ROUTING_STYLES.map((v) => ({ value: v, label: t.site.routingStyles[v] }));
  const routingDepths = ROUTING_DEPTHS.map((d) => ({ value: String(d), label: String(d) }));
  function setStyle(v: string) {
    const style = ROUTING_STYLES.find((x) => x === v);
    if (style) updateSite((s) => withRouting(s, { ...routing, style }));
  }
  function setDepth(v: string) {
    const depth = ROUTING_DEPTHS.find((x) => String(x) === v);
    if (depth !== undefined) updateSite((s) => withRouting(s, { ...routing, depth }));
  }
  const floorOptions = [
    { value: '', label: t.site.floorNone },
    ...FLOOR_BLOCKS.map((id) => ({ value: id, label: blockInfo(id).name })),
  ];
  const routeStats = $derived($siteRouteInfo?.routeStats);

  // The inspector is at the top: bring it into view when a group or link gets selected (from the scene too).
  let drawer = $state<HTMLElement>();
  $effect(() => {
    if (($siteGroup || $siteLink || $siteLinkDraft) && drawer)
      drawer.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Numeric fields
  function commitSize(axis: 0 | 1, text: string) {
    const n = Number(text.trim());
    if (text.trim() === '' || !Number.isFinite(n)) return;
    const size: [number, number] = [...$site.size];
    size[axis] = n;
    updateSite((s) => withSiteSize(s, size[0], size[1]));
  }
  function commitCorridor(text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) updateSite((s) => withCorridor(s, n));
  }

  function onreset() {
    resetSite();
    notify(t.site.resetDone, 6000, 'edit', undoAction());
  }

  let fileInput = $state<HTMLInputElement>();
  function onfile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openSiteFile(file);
  }
</script>

<aside class="drawer" aria-label={t.site.panel} data-testid="site-panel" bind:this={drawer}>
  <div class="top">
    <span class="title">{t.site.panel}</span>
    <span class="top-acts">
      <button class="link" disabled={!$canUndo} data-testid="site-undo" onclick={undoSite}
        >{t.site.undo}</button
      >
      <button class="link" disabled={!$canRedo} data-testid="site-redo" onclick={redoSite}
        >{t.site.redo}</button
      >
      <button class="link" onclick={onclose}>{t.close}</button>
    </span>
  </div>

  {#if selected}
    <GroupInspector group={selected} {placed} onreplace={() => onpick('change')} />
  {:else if selectedLink}
    <LinkInspector link={selectedLink} />
  {:else if $siteLinkDraft}
    <LinkForm />
  {/if}

  {#if $narrow}
    <SiteOutline embedded {onpick} />
  {/if}

  {#if warnings.problems.length || wontForm.length}
    <section>
      <h2>{t.site.problems}</h2>
      <ul class="rows problems" data-testid="site-problem-list">
        {#each warnings.problems as w, i (i)}
          <li>{t.site.warning(w, groupName, resName)}</li>
        {/each}
        {#each wontForm as g (g.id)}
          <li data-testid="site-wont-form">{t.validity.groupProblem(groupName(g.id), g.n)}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if notes.length || warnings.info.length}
    <section>
      <h2>{t.site.notes}</h2>
      <ul class="rows problems info" data-testid="site-note-list">
        {#each notes as n, i (i)}
          <li>{t.site.note(n, groupName, resName)}</li>
        {/each}
        {#each warnings.info as w, i (i)}
          <li>{t.site.warning(w, groupName, resName)}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <section>
    <h2>{t.site.size}</h2>
    <label class="row">
      <span>{t.site.name}</span>
      <input
        class="field text"
        type="text"
        value={$site.name ?? ''}
        placeholder={t.site.unnamed}
        aria-label={t.site.name}
        onchange={(e) => updateSite((s) => withName(s, e.currentTarget.value))}
      />
    </label>
    <div class="fields">
      <label class="pair"
        ><span>{t.site.width}</span><NumberStepper
          value={String($site.size[0])}
          label={t.site.width}
          min={SITE_MIN_SIZE}
          max={SITE_MAX_SIZE}
          width="2.8em"
          testid="site-width"
          oncommit={(v) => commitSize(0, v)}
        /></label
      >
      <label class="pair"
        ><span>{t.site.depth}</span><NumberStepper
          value={String($site.size[1])}
          label={t.site.depth}
          min={SITE_MIN_SIZE}
          max={SITE_MAX_SIZE}
          width="2.8em"
          testid="site-depth"
          oncommit={(v) => commitSize(1, v)}
        /></label
      >
      <label class="pair"
        ><span>{t.site.corridor}</span><NumberStepper
          value={String($site.corridor)}
          label={t.site.corridor}
          min={0}
          max={MAX_CORRIDOR}
          width="2em"
          oncommit={commitCorridor}
        /></label
      >
    </div>
    <p class="hint">{t.site.sizeHint(SITE_MIN_SIZE, SITE_MAX_SIZE)}</p>
    <ul class="rows">
      <li class="row">
        <button
          class="link"
          data-testid="site-arrange"
          disabled={!$site.groups.length}
          onclick={() => arrange()}>{t.site.arrange}</button
        >
      </li>
      <li class="row">
        <button
          class="link"
          data-testid="site-optimize"
          title={t.site.optimizeHint}
          disabled={!$site.groups.length}
          onclick={() => arrange(true)}>{t.site.optimize}</button
        >
      </li>
      <li class="row">
        <button
          class="link"
          data-testid="site-neat"
          title={t.site.neatHint}
          disabled={!$site.groups.length}
          onclick={() => neatArrange()}>{t.site.neat}</button
        >
      </li>
      <!-- In the top bar on wide screens; here only when the bar has no room for it. -->
      <li class="row narrow-only"><button class="link" onclick={onimport}>{t.site.importOpen}</button></li>
    </ul>
  </section>

  <section data-testid="site-routing">
    <h2>{t.site.routing}</h2>
    <ul class="rows">
      <SelectRow
        label={t.site.routingStyle}
        value={routing.style}
        options={routingStyles}
        testid="site-routing-style"
        onchange={setStyle}
      />
      <SelectRow
        label={t.site.routingDepth}
        value={String(routing.depth)}
        options={routingDepths}
        testid="site-routing-depth"
        onchange={setDepth}
      />
      <SelectRow
        label={t.site.floor}
        value={$site.floor ?? ''}
        options={floorOptions}
        testid="site-floor"
        onchange={(v) => updateSite((s) => withFloor(s, v || undefined))}
      />
      <ToggleRow
        on={$xray}
        label={t.site.undergroundView}
        title={t.site.undergroundViewHint}
        testid="site-xray"
        ontoggle={() => xray.update((v) => !v)}
      />
    </ul>
    <p class="hint">{t.site.routingDepthHint}</p>
    {#if $site.floor}<p class="hint">{t.site.floorHint}</p>{/if}
    {#if $siteRouteInfo && depthReduced($siteRouteInfo.routing.depth, $siteRouteInfo.depthUsed)}
      <p class="hint warn" data-testid="site-depth-reduced">
        {t.site.routingDepthUsed($siteRouteInfo.routing.depth, $siteRouteInfo.depthUsed)}
      </p>
    {/if}
    {#if routeStats}
      <p class="hint" data-testid="site-route-stats">
        {t.site.routeStats(
          routeStats.length,
          routeStats.bends,
          routeStats.underground.reduce((a, b) => a + b, 0),
        )}
      </p>
      {#if routeStats.underground.length > 1}
        <p class="hint" data-testid="site-route-levels">{t.site.routeStatsLevels(routeStats.underground)}</p>
      {/if}
      {#if routeStats.surfaceTrunk + routeStats.surfaceStub > 0}
        <p class="hint" data-testid="site-route-surface">
          {t.site.routeStatsSurface(routeStats.surfaceTrunk, routeStats.surfaceStub)}
        </p>
      {/if}
    {/if}
    {#if routingState.legacy}
      <p class="hint" data-testid="site-routing-legacy">{t.site.routingLegacy(routing.depth)}</p>
      <button
        class="link active"
        data-testid="site-use-neat"
        onclick={() => updateSite((s) => withRouting(s, routingState.neatOffer))}>{t.site.useNeat}</button
      >
    {/if}
  </section>

  <section>
    <h2>{t.view}</h2>
    <ul class="rows">
      <ToggleRow on={$sitePipes} label={t.pipes} ontoggle={() => sitePipes.update((v) => !v)} />
      <ToggleRow on={$siteCables} label={t.cables} ontoggle={() => siteCables.update((v) => !v)} />
      <ToggleRow on={$flowAnimation} label={t.site.flow} ontoggle={() => flowAnimation.update((v) => !v)} />
      <ToggleRow
        on={$showIcons}
        label={t.site.icons}
        testid="site-icons"
        ontoggle={() => showIcons.update((v) => !v)}
      />
    </ul>
  </section>

  <section>
    <h2>{t.plan}</h2>
    <ul class="rows">
      <li class="row">
        <button class="link" data-testid="site-share" onclick={() => void copySiteLink()}
          >{t.shareLink}</button
        >
      </li>
      {#if $siteShareFallback}
        <li class="row col">
          <span>{t.linkFallback}</span>
          <input
            class="field url"
            readonly
            value={$siteShareFallback}
            aria-label={t.linkFallback}
            onfocus={(e) => e.currentTarget.select()}
          />
        </li>
      {/if}
      <li class="row"><button class="link" onclick={downloadSite}>{t.downloadJson}</button></li>
      <li class="row">
        <button class="link" onclick={() => fileInput?.click()}>{t.uploadJson}</button>
        <input
          bind:this={fileInput}
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          tabindex="-1"
          aria-hidden="true"
          onchange={onfile}
        />
      </li>
      <li class="row">
        <button class="link" onclick={onreset}>{t.site.reset}</button>
      </li>
    </ul>
  </section>
</aside>

<style>
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 340px;
    background: var(--bg);
    border-left: 1px solid var(--line);
    z-index: 40;
    overflow-y: auto;
    padding: 0 var(--gutter) 48px;
  }
  .top {
    height: var(--bar-h);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
  }
  .top-acts {
    display: flex;
    gap: 14px;
  }
  .title,
  h2 {
    color: var(--text);
  }
  section {
    margin-top: 32px;
  }
  h2 {
    font: inherit;
    margin: 0 0 12px;
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
  .row.col {
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 18px;
    margin: 6px 0;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair > span {
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
  .hint {
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
    margin: 8px 0 0;
  }
  .problems li {
    color: var(--text);
    text-transform: none;
    letter-spacing: 0.02em;
    margin-bottom: 4px;
  }
  .hint.warn,
  .info li {
    color: var(--muted);
  }
  .hint.warn {
    color: var(--text);
    border-left: 2px solid var(--pick);
    padding-left: 8px;
  }
  .url {
    text-align: left;
    width: 100%;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }
  @media (min-width: 761px) {
    .narrow-only {
      display: none;
    }
    /* Below the top bar, so its buttons stay reachable while the drawer is open. */
    .drawer {
      top: var(--bar-h);
      z-index: 28;
    }
  }
  @media (max-width: 640px) {
    .drawer {
      top: auto;
      left: 0;
      width: auto;
      max-height: 62vh;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .top {
      height: 48px;
    }
    section {
      margin-top: 20px;
    }
  }
</style>
