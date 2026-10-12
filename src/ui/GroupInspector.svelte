<script lang="ts">
  import { PLACEHOLDER_ID, SINGLE_BLOCK_ID, getSiteDef, isSingleBlock } from '../data/generic';
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import { IO_KINDS } from '../model/site/group';
  import { TIERS } from '../model/core/types';
  import { WALLSHARE_MODES } from '../model/plan/types';
  import type { SiteGroup } from '../model/site/types';
  import type { HatchKind } from '../model/multiblock/types';
  import { SITE_MAX_ELEVATION, SITE_MAX_SIZE } from '../share/siteCodec';
  import { siteGroup, siteHatch } from '../state/site';
  import { hatchKindsOf } from './catalogView';
  import {
    COUNT_MAX,
    COUNT_MIN,
    LIMIT_MAX,
    LIMIT_MIN,
    formatLimit,
    parseCount,
    parseLimit,
    parseSize,
  } from './fields';
  import Buildability from './Buildability.svelte';
  import GroupHatch from './GroupHatch.svelte';
  import GroupHatchTiers from './GroupHatchTiers.svelte';
  import GroupResources from './GroupResources.svelte';
  import MachineTypeEditor from './MachineTypeEditor.svelte';
  import NudgePad from './NudgePad.svelte';
  import NumberStepper from './NumberStepper.svelte';
  import { mirrorDisabled } from './orientationText';
  import { groupLimitAxis, type GroupPatch } from './siteActions';
  import {
    duplicateSelected,
    frameSelected,
    patchGroup,
    removeSelected,
    rotateSelected,
    setSelectedOrigin,
  } from './siteEditing';
  import SelectRow from './SelectRow.svelte';
  import { groupHatchInfo, groupTiers, hasStructure, tierChoices } from './siteInspect';
  import ToggleRow from './ToggleRow.svelte';
  import { coilChoices, glassChoices, groupValidity, validityLines } from './validityText';

  /** The editor of the selected template group: Machine, Packing and Placement. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
    /** Open the multiblock picker to replace the machine. */
    onreplace: () => void;
  }
  let { group, placed, onreplace }: Props = $props();

  const def = $derived(getSiteDef(group.multiblockId));
  const name = $derived(group.label ?? def?.name ?? group.multiblockId);
  const units = $derived(placed?.units.length ?? group.count);
  const extraKinds = $derived(def ? hatchKindsOf(def).filter((k) => !IO_KINDS.includes(k)) : []);
  /** Multiblocks along x, layers, z as packed (from the placed units). */
  const grid = $derived.by(() => {
    const us = placed?.units ?? [];
    if (!us.length) return null;
    const axis = (i: 0 | 1 | 2) => new Set(us.map((u) => u.origin[i])).size;
    return [axis(0), axis(1), axis(2)] as const;
  });
  const footprint = $derived(
    placed ? ([placed.max[0] - placed.min[0], placed.max[2] - placed.min[2]] as const) : null,
  );

  const mirrorLocked = $derived(mirrorDisabled(def, !!group.mirror));
  const tiers = $derived(groupTiers(group, def));
  const tierOptions = $derived(
    tierChoices(tiers, group.tier, { any: t.site.tierAny, notAllowed: t.notAllowed }),
  );
  const wallshareOptions = WALLSHARE_MODES.map((m) => ({ value: m, label: t.wallshareModes[m] }));

  /** The hatch picked in the 3D view, when it is one of this group's. */
  const hatchInfo = $derived(
    placed && $siteHatch?.group === group.id ? groupHatchInfo(placed, $siteHatch.key) : undefined,
  );

  const lines = $derived(
    placed
      ? validityLines(
          groupValidity(placed),
          placed.units.map((u) => u.id),
          def,
        )
      : undefined,
  );

  let replacing = $state(false);
  $effect(() => {
    void group.id;
    replacing = false;
  });

  /** Changes that can make the group bigger grow the site once the group is rebuilt. */
  function patch(p: GroupPatch) {
    patchGroup(group.id, p);
  }
  function commitOrigin(axis: 0 | 1, text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) setSelectedOrigin(axis, n);
  }
  function commitElevation(text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) patch({ elevation: n });
  }
  /** `axis` is a site axis (the field's label); the group stores its limits unturned. */
  function commitLimit(axis: 'x' | 'y' | 'z', text: string) {
    const v = parseLimit(text);
    if (v !== undefined) patch({ limits: { ...group.limits, [groupLimitAxis(axis, group.rotation)]: v } });
  }
  function toggleHatch(kind: HatchKind) {
    const on = group.enabledHatches.includes(kind);
    patch({
      enabledHatches: on ? group.enabledHatches.filter((k) => k !== kind) : [...group.enabledHatches, kind],
    });
  }
  function replaceWith(id: string) {
    replacing = false;
    patch({ multiblockId: id });
  }
</script>

<div class="inspector" data-testid="site-group-editor" aria-label={name}>
  <div class="head">
    <span class="name"
      >{name} ×{units}{#if lines?.errors.length}
        <span class="badge" title={t.validity.badgeHint} data-testid="site-group-badge"
          >{t.validity.badge}</span
        >{/if}</span
    >
    <span class="acts">
      <button class="link" onclick={frameSelected}>{t.site.frame}</button>
      <button class="link" onclick={() => siteGroup.set(null)}>{t.site.deselect}</button>
    </span>
  </div>
  {#if group.source}<p class="hint">
      {group.source.name}{group.source.tier ? ` · ${group.source.tier}` : ''}{group.source.machineCount !==
      undefined
        ? ` · ${t.site.needed(group.source.machineCount)}`
        : ''}
    </p>{/if}

  {#if def?.generated}<p class="hint unverified" data-testid="unverified">
      {t.generatedTag}: {t.generatedHint}
    </p>{/if}

  {#if hatchInfo}<GroupHatch {group} info={hatchInfo} />{/if}

  <div class="sub">
    <p class="sub-title"><span>{t.site.machine}</span></p>
    <label class="col">
      <span>{t.site.label}</span>
      <input
        class="field text"
        type="text"
        value={group.label ?? ''}
        placeholder={def?.name ?? ''}
        aria-label={t.site.label}
        data-testid="site-group-label"
        onchange={(e) => patch({ label: e.currentTarget.value.trim() || null })}
      />
    </label>
    <div class="row">
      <span class="value">{def?.name ?? group.multiblockId}</span>
      <button class="link" aria-expanded={replacing} onclick={() => (replacing = !replacing)}
        >{t.site.replace}</button
      >
    </div>
    {#if def && isSingleBlock(def)}<MachineTypeEditor {group} />{/if}
    {#if replacing}
      <div class="row wrap replace">
        <span>{t.site.replaceWith}</span>
        <button class="link" onclick={onreplace}>{t.site.replaceCatalog}</button>
        {#if group.multiblockId !== SINGLE_BLOCK_ID}
          <button class="link" onclick={() => replaceWith(SINGLE_BLOCK_ID)}>{t.importer.single}</button>
        {/if}
        {#if group.multiblockId !== PLACEHOLDER_ID}
          <button class="link" onclick={() => replaceWith(PLACEHOLDER_ID)}>{t.importer.placeholder}</button>
        {/if}
      </div>
    {/if}
    <ul class="rows opts">
      {#if tiers.length}
        <SelectRow
          label={t.site.tier}
          title={t.site.tierHint}
          value={group.tier ?? ''}
          options={tierOptions}
          testid="site-group-tier"
          onchange={(v) => patch({ tier: TIERS.find((x) => x === v) ?? null })}
        />
      {/if}
      {#if def?.glassTierLimits}
        <SelectRow
          label={t.validity.glass}
          title={t.validity.glassHint}
          value={group.glassTier ?? ''}
          options={glassChoices(def, group.glassTier)}
          testid="site-group-glass"
          onchange={(v) => patch({ glassTier: TIERS.find((x) => x === v) ?? null })}
        />
      {/if}
      {#if def?.coils}
        <SelectRow
          label={t.coil}
          title={t.coilHint}
          value={group.coil ?? ''}
          options={coilChoices(def)}
          testid="site-group-coil"
          onchange={(v) => patch({ coil: v || null })}
        />
      {/if}
      {#if hasStructure(def)}
        <ToggleRow
          on={!!group.mirror}
          label={t.mirror}
          title={t.mirrorHint}
          disabled={mirrorLocked}
          hint={t.mirrorForbidden}
          testid="site-group-mirror"
          ontoggle={() => patch({ mirror: !group.mirror })}
        />
        <SelectRow
          label={t.wallshare}
          title={t.wallshareHint}
          value={group.wallshare ?? 'auto'}
          options={wallshareOptions}
          testid="site-group-wallshare"
          onchange={(v) => {
            const mode = WALLSHARE_MODES.find((m) => m === v);
            if (mode) patch({ wallshare: mode });
          }}
        />
        {#if def?.wallshare}
          <ToggleRow
            on={!!group.shareMaintenance}
            label={t.shareMaintenance}
            title={t.shareMaintenanceHint}
            testid="site-group-share-maintenance"
            ontoggle={() => patch({ shareMaintenance: !group.shareMaintenance })}
          />
          <ToggleRow
            on={!!group.shareEnergy}
            label={t.shareEnergy}
            title={t.shareEnergyHint}
            testid="site-group-share-energy"
            ontoggle={() => patch({ shareEnergy: !group.shareEnergy })}
          />
        {/if}
      {/if}
    </ul>
  </div>

  {#if lines}
    <div class="sub">
      <p class="sub-title"><span>{t.validity.title}</span></p>
      <Buildability errors={lines.errors} hints={lines.hints} testid="site-group-buildability" />
    </div>
  {/if}

  {#if def}
    <GroupResources
      {group}
      {def}
      demand={placed?.demand ?? {}}
      units={placed?.units.length ?? group.count}
      focus={hatchInfo?.resource ? { kind: hatchInfo.kind, resource: hatchInfo.resource } : undefined}
    />
  {/if}
  <GroupHatchTiers {group} {placed} />

  <div class="sub">
    <p class="sub-title">
      <span>{t.site.packing}</span>{#if grid}<span class="meta">{t.site.grid(grid[0], grid[1], grid[2])}</span
        >{/if}
    </p>
    <div class="fields">
      <label class="pair"
        ><span>{t.site.count}</span><NumberStepper
          value={String(group.count)}
          label={t.site.count}
          min={COUNT_MIN}
          max={COUNT_MAX}
          width="3.2em"
          testid="site-group-count"
          oncommit={(v) => {
            const n = parseCount(v);
            if (n !== null) patch({ count: n });
          }}
        /></label
      >
      {#if def?.resize}
        {@const r = def.resize}
        <label class="pair"
          ><span>{r.label === 'length' ? t.length : t.height}</span><NumberStepper
            value={String(group.size ?? r.default)}
            label={r.label === 'length' ? t.length : t.height}
            min={r.min}
            max={r.max}
            oncommit={(v) => {
              const n = parseSize(v);
              if (n !== null) patch({ size: n });
            }}
          /></label
        >
      {/if}
    </div>
    <div class="grid3">
      {#each [['x', t.site.maxX], ['y', t.limitY], ['z', t.site.maxZ]] as const as [axis, label] (axis)}
        <label class="col"
          ><span>{label}</span><NumberStepper
            value={formatLimit(group.limits[groupLimitAxis(axis, group.rotation)])}
            {label}
            min={LIMIT_MIN}
            max={LIMIT_MAX}
            empty
            placeholder={t.unlimited}
            oncommit={(v) => commitLimit(axis, v)}
          /></label
        >
      {/each}
    </div>
    <p class="hint">{t.site.packingHint}</p>
    <ul class="rows">
      <ToggleRow
        on={!!group.limitsLocked}
        label={t.site.lockLimits}
        testid="site-lock-limits"
        ontoggle={() => patch({ limitsLocked: !group.limitsLocked })}
      />
    </ul>
    <p class="hint">{t.site.lockLimitsHint}</p>
    {#if extraKinds.length}
      <p class="sub-label">{t.site.hatches}</p>
      <ul class="rows">
        {#each extraKinds as kind (kind)}
          <ToggleRow
            on={group.enabledHatches.includes(kind)}
            label={t.hatchKinds[kind]}
            ontoggle={() => toggleHatch(kind)}
          />
        {/each}
      </ul>
    {/if}
    {#if placed?.build?.unplaced.length}<p class="hint warn">
        {t.unplacedHatches(placed.build.unplaced.length)}
      </p>{/if}
  </div>

  <div class="sub">
    <p class="sub-title">
      <span>{t.site.placement}</span>{#if footprint}<span class="meta"
          >{t.site.footprint(footprint[0], footprint[1])}</span
        >{/if}
    </p>
    <div class="placement">
      <NudgePad />
      <div class="coords">
        <label class="pair"
          ><span class="axis-x">{t.site.x}</span><NumberStepper
            value={String(group.origin[0])}
            label={t.site.x}
            min={-SITE_MAX_SIZE}
            max={2 * SITE_MAX_SIZE}
            testid="site-group-x"
            oncommit={(v) => commitOrigin(0, v)}
          /></label
        >
        <label class="pair"
          ><span class="axis-z">{t.site.z}</span><NumberStepper
            value={String(group.origin[1])}
            label={t.site.z}
            min={-SITE_MAX_SIZE}
            max={2 * SITE_MAX_SIZE}
            testid="site-group-z"
            oncommit={(v) => commitOrigin(1, v)}
          /></label
        >
        <label class="pair"
          ><span>{t.site.elevation}</span><NumberStepper
            value={String(group.elevation ?? 0)}
            label={t.site.elevation}
            min={0}
            max={SITE_MAX_ELEVATION}
            testid="site-group-elevation"
            oncommit={(v) => commitElevation(v)}
          /></label
        >
        <div class="row">
          <span>{t.site.turn} <span class="value">{t.site.rotation(group.rotation)}</span></span>
          <button class="link" data-testid="site-group-rotate" onclick={() => rotateSelected(1)}
            >{t.site.rotate}</button
          >
        </div>
      </div>
    </div>
    <p class="hint">{t.site.placementHint}</p>
  </div>

  <div class="row foot">
    <button class="link" data-testid="site-group-duplicate" onclick={duplicateSelected}
      >{t.site.duplicate}</button
    >
    <button class="link" data-testid="site-group-remove" onclick={removeSelected}>{t.site.removeGroup}</button
    >
  </div>
</div>

<style>
  .badge {
    margin-left: 6px;
    padding: 0 4px;
    border: 1px solid var(--pick);
    color: var(--pick);
  }
  .unverified {
    color: var(--pick);
  }
  .inspector {
    padding: 4px 0 20px;
    border-bottom: 1px solid var(--line);
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .name,
  .value,
  .sub-title {
    color: var(--text);
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    gap: 12px;
    flex: none;
  }
  .sub {
    margin-top: 20px;
  }
  .sub-title {
    margin: 0 0 6px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .meta {
    color: var(--muted);
  }
  .sub-label {
    margin: 12px 0 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 26px;
  }
  .row.wrap {
    flex-wrap: wrap;
    row-gap: 0;
  }
  .replace > span {
    color: var(--muted);
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 18px;
    margin: 2px 0 6px;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair > span {
    white-space: nowrap;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .col .text {
    width: 100%;
  }
  .text {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    border-bottom: 1px dotted var(--muted);
    padding-bottom: 2px;
  }
  .text:focus {
    border-bottom: 1px solid var(--text);
    text-decoration: none;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    gap: 6px 12px;
  }
  .opts {
    margin-top: 6px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .placement {
    display: flex;
    gap: 20px;
    align-items: flex-start;
  }
  .coords {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .axis-x {
    color: var(--axis-x);
  }
  .axis-z {
    color: var(--axis-z);
  }
  .hint {
    margin: 8px 0 0;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint.warn {
    color: var(--text);
  }
  .foot {
    margin-top: 16px;
    justify-content: space-between;
  }
</style>
