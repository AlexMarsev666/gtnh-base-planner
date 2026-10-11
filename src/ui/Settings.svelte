<script lang="ts">
  import { t } from '../i18n/en';
  import type { MultiblockDef, PlanLimits } from '../model/multiblock/types';
  import { WALLSHARE_MODES } from '../model/plan/types';
  import { TIERS, type Tier } from '../model/core/types';
  import { allowedTiers } from '../model/tiers';
  import { tick } from 'svelte';
  import {
    connectBelow,
    plan,
    selectedHatch,
    selectedUnits,
    showCables,
    showPipes,
    xray,
  } from '../state/store';
  import {
    resetColors,
    resetHatchTiers,
    resetPlan,
    setHatchColor,
    setHatchTier,
    setLimit,
    setMirror,
    setSize,
    setTier,
    setWallshare,
    toggleHatch,
  } from './actions';
  import { hatchKindsOf } from './catalogView';
  import { LIMIT_MAX, LIMIT_MIN, formatLimit, parseLimit, parseSize } from './fields';
  import { notify } from './notices';
  import NumberStepper from './NumberStepper.svelte';
  import ToggleRow from './ToggleRow.svelte';
  import { hatchTierOptions, hatchTierRows, unmatchedHatchTiers } from './hatchTierRows';
  import { build, mergeColors } from './pipeline';
  import SelectRow from './SelectRow.svelte';
  import { copyShareLink, downloadJson, openJsonFile, shareFallback } from './session';
  import { addPlanToSite } from './siteCommands';

  interface Props {
    def: MultiblockDef | undefined;
    onclose: () => void;
  }
  let { def, onclose }: Props = $props();

  const axes: { axis: keyof PlanLimits; label: string }[] = [
    { axis: 'x', label: t.limitX },
    { axis: 'y', label: t.limitY },
    { axis: 'z', label: t.limitZ },
  ];

  const kinds = $derived(def ? hatchKindsOf(def) : []);
  const resize = $derived(def?.resize);
  const sizeLabel = $derived(resize?.label === 'length' ? t.length : t.height);

  function commitSize(text: string) {
    const n = parseSize(text);
    if (n !== null) setSize(n);
  }
  const colors = $derived(mergeColors($plan.colors));

  const tiers = $derived(def ? allowedTiers(def) : []);
  const tierOptions = $derived([
    { value: '', label: t.anyTier },
    ...tiers.map((x) => ({ value: x, label: x })),
    // A loaded plan may name a tier this machine cannot take: show it, don't change it.
    ...($plan.tier && !tiers.includes($plan.tier)
      ? [{ value: $plan.tier, label: `${$plan.tier} ${t.notAllowed}` }]
      : []),
  ]);
  const wallshareOptions = WALLSHARE_MODES.map((m) => ({ value: m, label: t.wallshareModes[m] }));
  const fallback = $derived($build.wallshareFallback);

  // Tiers of single hatches, for energy machines only (steam machines have no voltage tiers).
  let hatchTiersOpen = $state(false);
  const tierRows = $derived(hatchTierRows($build.scene?.hatches ?? [], $selectedUnits));
  const unmatched = $derived(unmatchedHatchTiers($plan.hatchTiers, $build.scene?.hatches ?? []));
  const hatchCount = $derived(hatchTierRows($build.scene?.hatches ?? []).length);
  const hatchTierChoices = (kind: Parameters<typeof hatchTierOptions>[0]) => [
    { value: '', label: t.defaultTier },
    ...hatchTierOptions(kind).map((x) => ({ value: x, label: x })),
  ];
  // A hatch picked in the 3D view: open the list and bring its row into view.
  let tierList = $state<HTMLElement>();
  $effect(() => {
    if (!$selectedHatch) return;
    hatchTiersOpen = true;
    void tick().then(() => tierList?.querySelector('[data-emphasis]')?.scrollIntoView({ block: 'nearest' }));
  });
  const asTier = (v: string): Tier | undefined => TIERS.find((x) => x === v);

  function commitLimit(axis: keyof PlanLimits, text: string) {
    const v = parseLimit(text);
    if (v !== undefined) setLimit(axis, v);
  }

  let fileInput = $state<HTMLInputElement>();
  function onfile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void openJsonFile(file);
  }

  let confirmReset = $state(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  function onreset() {
    clearTimeout(resetTimer);
    if (confirmReset) {
      confirmReset = false;
      resetPlan();
      notify(t.resetDone);
      return;
    }
    confirmReset = true;
    resetTimer = setTimeout(() => (confirmReset = false), 3000);
  }
  $effect(() => () => clearTimeout(resetTimer));
</script>

<aside class="drawer" aria-label={t.settings} data-testid="settings">
  <div class="top">
    <span class="title">{t.settings}</span>
    <button class="link" onclick={onclose}>{t.close}</button>
  </div>

  <button class="link active add-to-site" data-testid="add-to-site" onclick={addPlanToSite}
    >{t.site.addToSite}</button
  >

  <section>
    <h2>{t.machine}</h2>
    <ul class="rows">
      {#if tiers.length}
        <SelectRow
          label={t.tier}
          title={t.tierHint}
          value={$plan.tier ?? ''}
          options={tierOptions}
          testid="machine-tier"
          onchange={(v) => setTier(asTier(v))}
        />
      {/if}
      <ToggleRow
        on={!!$plan.mirror}
        label={t.mirror}
        title={t.mirrorHint}
        testid="toggle-mirror"
        ontoggle={() => setMirror(!$plan.mirror)}
      />
      <SelectRow
        label={t.wallshare}
        title={t.wallshareHint}
        value={$plan.wallshare ?? 'auto'}
        options={wallshareOptions}
        testid="wallshare"
        onchange={(v) => {
          const mode = WALLSHARE_MODES.find((m) => m === v);
          if (mode) setWallshare(mode);
        }}
      />
    </ul>
    {#if fallback}
      <p class="hint" data-testid="wallshare-fallback">
        {t.wallshareFallback(fallback.wanted, fallback.used, fallback.reason)}
      </p>
    {/if}
  </section>

  {#if resize}
    <section>
      <h2>{t.size}</h2>
      <label class="limit">
        <span>{sizeLabel}</span>
        <NumberStepper
          value={String($plan.size ?? resize.default)}
          label={sizeLabel}
          min={resize.min}
          max={resize.max}
          testid="size"
          oncommit={commitSize}
        />
      </label>
      <p class="hint">{t.sizeHint(resize.min, resize.max)}</p>
    </section>
  {/if}

  <section>
    <h2>{t.limits}</h2>
    <div class="limits">
      {#each axes as a (a.axis)}
        <label class="limit">
          <span>{a.label}</span>
          <NumberStepper
            value={formatLimit($plan.limits[a.axis])}
            label={a.label}
            min={LIMIT_MIN}
            max={LIMIT_MAX}
            empty
            placeholder={t.unlimited}
            testid={`limit-${a.axis}`}
            oncommit={(text) => commitLimit(a.axis, text)}
          />
        </label>
      {/each}
    </div>
    <p class="hint">{t.limitsHint}</p>
    {#if $plan.manualUnits}<p class="hint">{t.manualNote}</p>{/if}
  </section>

  {#if kinds.length}
    <section>
      <h2>{t.hatches}</h2>
      <ul class="rows">
        {#each kinds as kind (kind)}
          {@const on = $plan.enabledHatches.includes(kind)}
          <ToggleRow
            {on}
            label={t.hatchKinds[kind]}
            testid={`hatch-${kind}`}
            ontoggle={() => toggleHatch(kind)}
          >
            {#snippet before()}
              <label class="swatch" style:background={colors[kind]} title={t.hatchColor(t.hatchKinds[kind])}>
                <input
                  type="color"
                  value={colors[kind]}
                  aria-label={t.hatchColor(t.hatchKinds[kind])}
                  onchange={(e) => setHatchColor(kind, e.currentTarget.value)}
                />
              </label>
            {/snippet}
          </ToggleRow>
        {/each}
      </ul>
      {#if Object.keys($plan.colors).length}
        <button class="link" onclick={resetColors}>{t.resetColors}</button>
      {/if}
    </section>
  {/if}

  {#if tiers.length && hatchCount}
    <section>
      <h2>{t.hatchTiers}</h2>
      <button
        class="link"
        class:active={hatchTiersOpen}
        data-testid="hatch-tiers-toggle"
        onclick={() => (hatchTiersOpen = !hatchTiersOpen)}
        >{hatchTiersOpen ? t.hatchTiersHide : t.hatchTiersShow(tierRows.length)}</button
      >
      {#if hatchTiersOpen}
        {#if $selectedUnits.length}<p class="hint">{t.hatchTiersSelected}</p>{/if}
        {#if !tierRows.length}<p class="hint">{t.hatchTiersEmpty}</p>{/if}
        <ul class="rows tier-list" data-testid="hatch-tier-list" bind:this={tierList}>
          {#each tierRows as row (row.key)}
            <SelectRow
              label={t.hatchTierName(t.hatchKinds[row.kind], row.number)}
              value={$plan.hatchTiers?.[row.key] ?? ''}
              options={hatchTierChoices(row.kind)}
              testid={`hatch-tier-${row.key}`}
              emphasis={row.key === $selectedHatch?.key}
              onchange={(v) => setHatchTier(row.key, asTier(v))}
            />
          {/each}
        </ul>
        {#if $plan.hatchTiers}
          {#if unmatched}<p class="hint" data-testid="hatch-tiers-unmatched">
              {t.hatchTiersUnmatched(unmatched)}
            </p>{/if}
          <button class="link" onclick={resetHatchTiers}>{t.resetHatchTiers}</button>
        {/if}
      {/if}
    </section>
  {/if}

  <section>
    <h2>{t.view}</h2>
    <ul class="rows">
      <ToggleRow
        on={$showPipes}
        label={t.pipes}
        testid="toggle-pipes"
        ontoggle={() => showPipes.update((v) => !v)}
      />
      <ToggleRow
        on={$showCables}
        label={t.cables}
        testid="toggle-cables"
        ontoggle={() => showCables.update((v) => !v)}
      />
      <ToggleRow
        on={$connectBelow}
        label={t.below}
        title={t.belowHint}
        testid="toggle-below"
        ontoggle={() => connectBelow.update((v) => !v)}
      />
      <ToggleRow on={$xray} label={t.xray} testid="toggle-xray" ontoggle={() => xray.update((v) => !v)} />
    </ul>
  </section>

  <section>
    <h2>{t.plan}</h2>
    <ul class="rows">
      <li class="row">
        <button class="link" data-testid="share" onclick={() => void copyShareLink()}>{t.shareLink}</button>
      </li>
      {#if $shareFallback}
        <li class="row col">
          <span>{t.linkFallback}</span>
          <input
            class="field url"
            readonly
            value={$shareFallback}
            aria-label={t.linkFallback}
            onfocus={(e) => e.currentTarget.select()}
          />
        </li>
      {/if}
      <li class="row">
        <button class="link" onclick={downloadJson}>{t.downloadJson}</button>
      </li>
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
        <button class="link" class:danger={confirmReset} data-testid="reset" onclick={onreset}
          >{confirmReset ? t.resetConfirm : t.reset}</button
        >
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
    width: 300px;
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
  }
  .title {
    color: var(--text);
  }
  .add-to-site {
    display: block;
    margin-top: 4px;
  }
  section {
    margin-top: 36px;
  }
  h2 {
    font: inherit;
    color: var(--text);
    margin: 0 0 14px;
  }
  .limits {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
  }
  .limit {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .limit > span {
    white-space: nowrap;
  }
  .limit :global(.field) {
    text-align: left;
  }
  .hint {
    margin: 10px 0 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tier-list {
    max-height: 220px;
    overflow-y: auto;
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
  .url {
    text-align: left;
    width: 100%;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }
  .swatch {
    position: relative;
    width: 10px;
    height: 10px;
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
  .danger {
    color: var(--text);
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
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    section {
      margin-top: 20px;
    }
  }
</style>
