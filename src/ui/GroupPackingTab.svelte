<script lang="ts">
  import { getSiteDef } from '../data/generic';
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import { IO_KINDS } from '../model/site/group';
  import type { SiteGroup } from '../model/site/types';
  import type { HatchKind } from '../model/multiblock/types';
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
  import NumberStepper from './NumberStepper.svelte';
  import { groupLimitAxis } from './siteActions';
  import { patchGroup } from './siteEditing';
  import ToggleRow from './ToggleRow.svelte';

  /** The Packing tab of the group inspector: count, limits, resize and extra hatch kinds. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
  }
  let { group, placed }: Props = $props();

  const def = $derived(getSiteDef(group.multiblockId));
  const extraKinds = $derived(def ? hatchKindsOf(def).filter((k) => !IO_KINDS.includes(k)) : []);
  /** Multiblocks along x, layers, z as packed (from the placed units). */
  const grid = $derived.by(() => {
    const us = placed?.units ?? [];
    if (!us.length) return null;
    const axis = (i: 0 | 1 | 2) => new Set(us.map((u) => u.origin[i])).size;
    return [axis(0), axis(1), axis(2)] as const;
  });

  /** Changes that can make the group bigger grow the site once the group is rebuilt. */
  function patch(p: Parameters<typeof patchGroup>[1]) {
    patchGroup(group.id, p);
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
</script>

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
          width="2.4em"
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

<style>
  .sub {
    margin-top: 20px;
  }
  .sub-title {
    margin: 0 0 6px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .sub-label {
    margin: 12px 0 0;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 18px;
    margin: 2px 0 6px;
  }
  .pair {
    display: flex;
    align-items: center;
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
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    gap: 6px 4px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .hint {
    margin: 8px 0 0;
  }
  .hint.warn {
    color: var(--text);
  }
</style>
