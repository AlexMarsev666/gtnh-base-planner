<script lang="ts">
  import { t } from '../i18n/en';
  import type { MultiblockDef, PlanLimits } from '../model/multiblock/types';
  import { WALLSHARE_MODES } from '../model/plan/types';
  import { TIERS, type Tier } from '../model/core/types';
  import { allowedTiers } from '../model/tiers';
  import Buildability from './Buildability.svelte';
  import { coilChoices, glassChoices, validityLines, type ValidityLine } from './validityText';
  import { tick } from 'svelte';
  import { plan, selectedHatch, selectedUnits } from '../state/store';
  import {
    resetColors,
    resetHatchTiers,
    setCoil,
    setHatchColor,
    setHatchTier,
    setLimit,
    setMirror,
    setShareEnergy,
    setShareMaintenance,
    setGlassTier,
    setSize,
    setTier,
    setWallshare,
    toggleHatch,
  } from './actions';
  import { hatchKindsOf } from './catalogView';
  import { LIMIT_MAX, LIMIT_MIN, formatLimit, parseLimit, parseSize } from './fields';
  import NumberStepper from './NumberStepper.svelte';
  import { mirrorDisabled } from './orientationText';
  import ToggleRow from './ToggleRow.svelte';
  import { hatchKeyAt, hatchTierOptions, hatchTierRows, unmatchedHatchTiers } from './hatchTierRows';
  import { build, mergeColors } from './pipeline';
  import SelectRow from './SelectRow.svelte';
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

  const mirrorLocked = $derived(mirrorDisabled(def, !!$plan.mirror));
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
  const lines = $derived(
    validityLines(
      $build.validity,
      ($build.pack?.units ?? []).map((u) => u.id),
      $build.def,
    ),
  );
  /** Select the unit of a problem, and its hatch when it names one. */
  function pickProblem(line: ValidityLine) {
    selectedUnits.set([line.unitId]);
    const key = line.cell ? hatchKeyAt($build.scene?.hatches ?? [], line.cell) : null;
    selectedHatch.set(line.cell && key ? { key, cell: line.cell } : null);
  }
  const asTier = (v: string): Tier | undefined => TIERS.find((x) => x === v);

  function commitLimit(axis: keyof PlanLimits, text: string) {
    const v = parseLimit(text);
    if (v !== undefined) setLimit(axis, v);
  }
</script>

<aside class="drawer" aria-label={t.settings} data-testid="settings">
  <div class="top">
    <span class="title">{t.settings}</span>
    <button class="link" onclick={onclose}>{t.close}</button>
  </div>

  <button class="btn primary block add-to-site" data-testid="add-to-site" onclick={addPlanToSite}
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
      {#if def?.glassTierLimits}
        <SelectRow
          label={t.validity.glass}
          title={t.validity.glassHint}
          value={$plan.glassTier ?? ''}
          options={glassChoices(def, $plan.glassTier)}
          testid="machine-glass"
          onchange={(v) => setGlassTier(asTier(v))}
        />
      {/if}
      {#if def?.coils}
        <SelectRow
          label={t.coil}
          title={t.coilHint}
          value={$plan.coil ?? ''}
          options={coilChoices(def)}
          testid="machine-coil"
          onchange={(v) => setCoil(v || undefined)}
        />
      {/if}
      <ToggleRow
        on={!!$plan.mirror}
        label={t.mirror}
        title={t.mirrorHint}
        disabled={mirrorLocked}
        hint={t.mirrorForbidden}
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
      {#if def?.wallshare}
        <ToggleRow
          on={!!$plan.shareMaintenance}
          label={t.shareMaintenance}
          title={t.shareMaintenanceHint}
          testid="toggle-share-maintenance"
          ontoggle={() => setShareMaintenance(!$plan.shareMaintenance)}
        />
        <ToggleRow
          on={!!$plan.shareEnergy}
          label={t.shareEnergy}
          title={t.shareEnergyHint}
          testid="toggle-share-energy"
          ontoggle={() => setShareEnergy(!$plan.shareEnergy)}
        />
      {/if}
    </ul>
    {#if fallback}
      <p class="hint" data-testid="wallshare-fallback">
        {t.wallshareFallback(fallback.wanted, fallback.used, fallback.reason)}
      </p>
    {/if}
  </section>

  {#if $build.pack}
    <section>
      <h2>{t.validity.title}</h2>
      <Buildability errors={lines.errors} hints={lines.hints} onpick={pickProblem} />
    </section>
  {/if}

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
    margin-top: 4px;
  }
  section {
    margin-top: 36px;
  }
  h2 {
    margin: 0 0 14px;
  }
  .limits {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
  }
  .limit {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .limit > span {
    white-space: nowrap;
  }
  .hint {
    margin: 10px 0 0;
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

  /* Below the top bar, so its buttons stay reachable while the drawer is open. */
  @media (min-width: 761px) {
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
      position: sticky;
      top: 0;
      background: var(--bg);
    }
    section {
      margin-top: 20px;
    }
  }
</style>
