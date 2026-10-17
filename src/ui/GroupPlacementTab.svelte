<script lang="ts">
  import { t } from '../i18n/en';
  import type { PlacedGroup } from '../model/site/buildTypes';
  import type { SiteGroup } from '../model/site/types';
  import { SITE_MAX_ELEVATION, SITE_MAX_SIZE } from '../share/siteCodec';
  import NudgePad from './NudgePad.svelte';
  import NumberStepper from './NumberStepper.svelte';
  import { patchGroup, rotateSelected, setSelectedOrigin } from './siteEditing';

  /** The Placement tab of the group inspector: position, elevation and turn. */
  interface Props {
    group: SiteGroup;
    placed: PlacedGroup | undefined;
  }
  let { group, placed }: Props = $props();

  const footprint = $derived(
    placed ? ([placed.max[0] - placed.min[0], placed.max[2] - placed.min[2]] as const) : null,
  );

  function commitOrigin(axis: 0 | 1, text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) setSelectedOrigin(axis, n);
  }
  function commitElevation(text: string) {
    const n = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(n)) patchGroup(group.id, { elevation: n });
  }
</script>

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

<style>
  .value {
    color: var(--text);
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
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 30px;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pair > span {
    white-space: nowrap;
  }
  .placement {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  .coords {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .axis-x {
    color: var(--axis-x);
  }
  .axis-z {
    color: var(--axis-z);
  }
  .hint {
    margin: 8px 0 0;
  }
</style>
