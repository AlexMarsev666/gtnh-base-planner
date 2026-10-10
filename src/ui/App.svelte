<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n/en';
  import { groupIndexOfUnit, portIndexOfUnit } from '../model/site/ids';
  import { portIdForUnit, portUnitFor } from './siteSelection';
  import { appMode, flowAnimation, isolate, site, siteGroup, siteNet, sitePort } from '../state/site';
  import { plan, selectedUnits, viewMode, xray } from '../state/store';
  import { selectMultiblock } from './actions';
  import { startSessions } from './appSession';
  import BlocksPanel from './BlocksPanel.svelte';
  import { clearOtherViewWarnings, createBuildWarnings } from './buildWarnings';
  import { watchDrawerInset, type Inset } from './drawerInset';
  import FlowToggle from './FlowToggle.svelte';
  import Footer from './Footer.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import Legend from './Legend.svelte';
  import Notices from './Notices.svelte';
  import { notify } from './notices';
  import Picker from './Picker.svelte';
  import { build } from './pipeline';
  import Scene from './Scene.svelte';
  import { isTyping, siteKeyAction } from './keys';
  import MoveHint from './MoveHint.svelte';
  import Settings from './Settings.svelte';
  import { updateSite, withGroupPatched } from './siteActions';
  import {
    autoPlaceSelectedPort,
    frameRequest,
    frameSelected,
    liftSelectedStep,
    moveSelected,
    moveSelectedBy,
    removeSelected,
    rotateSelected,
    shiftHeld,
    viewTheta,
  } from './siteEditing';
  import { redoSite, undoSite } from './siteHistory';
  import SiteBar from './SiteBar.svelte';
  import { addGroup } from './siteCommands';
  import SiteLegend from './SiteLegend.svelte';
  import SitePanel from './SitePanel.svelte';
  import { siteBuildInView, siteSceneInView } from './sitePipeline';
  import SiteStats from './SiteStats.svelte';
  import StatsLine from './StatsLine.svelte';
  import TopBar from './TopBar.svelte';

  let pickerOpen = $state(false);
  let settingsOpen = $state(false);
  let rendererFailed = $state(false);
  let sitePanelOpen = $state(false);
  /** The required-blocks drawer (both views); it shares the right edge with Settings and the Template panel. */
  let blocksOpen = $state(false);
  let importOpen = $state(false);
  /** Site view: what the multiblock picker is open for. */
  let sitePicker = $state<'add' | 'change' | null>(null);

  const def = $derived($build.def);
  const siteMode = $derived($appMode === 'site');

  onMount(startSessions);

  const warnBuild = createBuildWarnings();
  $effect(() => {
    const result = $build;
    if (!siteMode) warnBuild(result);
  });
  $effect(() => clearOtherViewWarnings(siteMode));

  /** Unit ids of the selected site group or port (highlighted like selected units). */
  const siteSelected = $derived.by(() => {
    // Only the site view needs the site built.
    if (!siteMode) return [];
    const pu = $sitePort ? portUnitFor($siteBuildInView, $sitePort) : null;
    if (pu !== null) return [pu];
    const g = $siteBuildInView.build?.groups.find((x) => x.group.id === $siteGroup);
    return g ? g.units.map((u) => u.id) : [];
  });

  function onpick(ids: number[]) {
    if (!siteMode) {
      selectedUnits.set(ids);
      return;
    }
    const portId = ids.length ? portIdForUnit($siteBuildInView, ids[0]) : null;
    const g =
      ids.length && portIndexOfUnit(ids[0]) < 0
        ? $siteBuildInView.build?.groups[groupIndexOfUnit(ids[0])]
        : undefined;
    // Selecting one clears the other (see `sitePort`); nothing picked clears both.
    if (portId !== null) sitePort.set(portId);
    else if (g) siteGroup.set(g.group.id);
    else {
      siteGroup.set(null);
      sitePort.set(null);
    }
  }

  function onpicknet(id: number | null) {
    if (!siteMode) return;
    siteNet.set(id);
    const n = id === null ? undefined : $siteBuildInView.build?.nets.find((x) => x.id === id);
    isolate.set(n?.resource ?? null);
  }

  function onselect(id: string) {
    selectMultiblock(id);
    pickerOpen = false;
  }

  function onsitepick(id: string) {
    const purpose = sitePicker;
    sitePicker = null;
    if (purpose === 'add') addGroup(id);
    else if (purpose === 'change' && $siteGroup) {
      const gid = $siteGroup;
      updateSite((s) => withGroupPatched(s, gid, { multiblockId: id }));
    }
    blocksOpen = false;
    sitePanelOpen = true;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Shift') shiftHeld.set(true);
    if (e.key === 'Escape') {
      if (siteMode) {
        if (importOpen) importOpen = false;
        else if (sitePicker) sitePicker = null;
        else if (sitePanelOpen) sitePanelOpen = false;
        else if (blocksOpen) blocksOpen = false;
        else {
          siteGroup.set(null);
          sitePort.set(null);
          siteNet.set(null);
          isolate.set(null);
        }
      } else if (pickerOpen) pickerOpen = false;
      else if (settingsOpen) settingsOpen = false;
      else if (blocksOpen) blocksOpen = false;
      return;
    }
    if (!siteMode || importOpen || sitePicker || isTyping(e)) return;
    // Site view: undo and redo anything, then move and turn the selected group from the keyboard.
    const action = siteKeyAction(e);
    if (!action) return;
    if (action.type === 'undo' || action.type === 'redo') {
      e.preventDefault();
      if (action.type === 'redo') redoSite();
      else undoSite();
      return;
    }
    const gid = $siteGroup;
    const pid = $sitePort;
    if (!$site.groups.some((g) => g.id === gid) && !$site.ports.some((p) => p.id === pid)) return;
    e.preventDefault();
    if (action.type === 'move') moveSelected(action.key, action.far);
    else if (action.type === 'rotate') rotateSelected(action.turns);
    else if (action.type === 'lift') liftSelectedStep(action.dy, action.far);
    else if (action.type === 'auto') autoPlaceSelectedPort();
    else if (action.type === 'frame') frameSelected();
    else removeSelected();
  }

  function onkeyup(e: KeyboardEvent) {
    if (e.key === 'Shift') shiftHeld.set(false);
  }

  /** Canvas pixels the open drawer covers: the view centres the model in the rest. */
  let inset = $state<Inset>({ right: 0, bottom: 0 });
  $effect(() => {
    // Re-measure whenever a drawer opens or closes.
    void sitePanelOpen;
    void settingsOpen;
    void blocksOpen;
    void siteMode;
    return watchDrawerInset((next) => (inset = next));
  });
</script>

<svelte:window {onkeydown} {onkeyup} onblur={() => shiftHeld.set(false)} />

<main>
  <Scene
    scene={siteMode ? $siteSceneInView : $build.scene}
    mode={$viewMode}
    xray={$xray}
    selected={siteMode ? siteSelected : $selectedUnits}
    flow={$flowAnimation}
    onview={(theta) => viewTheta.set(theta)}
    onmove={siteMode ? (dx, dz) => moveSelectedBy(dx, dz, false) : undefined}
    frame={siteMode ? $frameRequest : null}
    {inset}
    {onpick}
    {onpicknet}
    onfail={() => (rendererFailed = true)}
    onviewfallback={() => {
      viewMode.set('simple');
      notify(t.texturesUnavailable);
    }}
  />

  {#if siteMode}
    {#if rendererFailed || !$siteSceneInView}
      <div class="placeholder" data-testid="preview-notice">
        <!-- Before the first build arrives from the worker there is simply nothing to show yet. -->
        <span
          >{$siteSceneInView
            ? t.viewUnavailable
            : $siteBuildInView.error || $siteBuildInView.build
              ? t.previewUnavailable
              : t.site.building}</span
        >
        {#if $siteBuildInView.error}<span class="detail">{$siteBuildInView.error}</span>{/if}
      </div>
    {/if}

    <SiteBar
      panelOpen={sitePanelOpen}
      {blocksOpen}
      ontogglepanel={() => {
        sitePanelOpen = !sitePanelOpen;
        if (sitePanelOpen) blocksOpen = false;
      }}
      ontoggleblocks={() => {
        blocksOpen = !blocksOpen;
        if (blocksOpen) sitePanelOpen = false;
      }}
      onimport={() => (importOpen = true)}
    />

    {#if sitePicker}
      <Picker
        currentId={$site.groups.find((g) => g.id === $siteGroup)?.multiblockId ?? ''}
        onselect={onsitepick}
        onclose={() => (sitePicker = null)}
      />
    {:else}
      <SiteLegend />
      <FlowToggle />
      <SiteStats
        onproblems={() => {
          blocksOpen = false;
          sitePanelOpen = true;
        }}
      />
      {#if ($siteGroup || $sitePort) && !importOpen}<MoveHint port={!!$sitePort} />{/if}
      {#if blocksOpen}
        <BlocksPanel scene={$siteSceneInView} onclose={() => (blocksOpen = false)} />
      {/if}
      {#if sitePanelOpen}
        <SitePanel
          onclose={() => (sitePanelOpen = false)}
          onimport={() => (importOpen = true)}
          onpick={(purpose) => {
            sitePicker = purpose;
            sitePanelOpen = false;
          }}
        />
      {/if}
    {/if}

    {#if importOpen}
      <ImportDialog onclose={() => (importOpen = false)} />
    {/if}
  {:else}
    {#if !$build.scene || rendererFailed}
      <div class="placeholder" data-testid="preview-notice">
        <span>{$build.scene ? t.viewUnavailable : t.previewUnavailable}</span>
        {#if $build.error}<span class="detail">{$build.error}</span>{/if}
      </div>
    {/if}

    <TopBar
      {def}
      {pickerOpen}
      {settingsOpen}
      {blocksOpen}
      ontogglepicker={() => {
        pickerOpen = !pickerOpen;
        if (pickerOpen) {
          settingsOpen = false;
          blocksOpen = false;
        }
      }}
      ontogglesettings={() => {
        settingsOpen = !settingsOpen;
        if (settingsOpen) {
          pickerOpen = false;
          blocksOpen = false;
        }
      }}
      ontoggleblocks={() => {
        blocksOpen = !blocksOpen;
        if (blocksOpen) {
          pickerOpen = false;
          settingsOpen = false;
        }
      }}
    />

    {#if pickerOpen}
      <Picker currentId={$plan.multiblockId} {onselect} onclose={() => (pickerOpen = false)} />
    {:else}
      <Legend enabled={$plan.enabledHatches} colors={$plan.colors} />
      <StatsLine result={$build} />
    {/if}

    {#if blocksOpen && !pickerOpen}
      <BlocksPanel scene={$build.scene} onclose={() => (blocksOpen = false)} />
    {/if}

    {#if settingsOpen}
      <Settings {def} onclose={() => (settingsOpen = false)} />
    {/if}
  {/if}

  <Footer />
  <Notices />
</main>

<style>
  main {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .placeholder {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    pointer-events: none;
    padding: 0 var(--gutter);
    text-align: center;
  }
  .detail {
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
</style>
