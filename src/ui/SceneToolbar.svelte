<script lang="ts">
  import { t } from '../i18n/en';
  import { flowAnimation, showIcons, site, siteCables, sitePipes } from '../state/site';
  import { connectBelow, showCables, showPipes, xray } from '../state/store';
  import { arrange, arrangeBlockReason, neatArrange } from './siteCommands';

  /**
   * The tools over the scene: in the Template view the layout commands (Arrange, Optimize, Neat) and the view
   * chips; in the Machine view the view chips. A command that cannot run stays focusable and says why on hover
   * and focus.
   */
  interface Props {
    view: 'machine' | 'site';
  }
  let { view }: Props = $props();

  const id = $props.id();
  const reason = $derived(arrangeBlockReason($site));

  const commands = [
    { key: 'arrange', label: t.site.arrange, hint: undefined, run: () => void arrange() },
    { key: 'optimize', label: t.site.optimize, hint: t.site.optimizeHint, run: () => void arrange(true) },
    { key: 'neat', label: t.site.neat, hint: t.site.neatHint, run: () => void neatArrange() },
  ];
</script>

{#snippet chip(label: string, on: boolean, flip: () => void, testid: string, title?: string)}
  <button class="chip" aria-pressed={on} {title} data-testid={testid} onclick={flip}>{label}</button>
{/snippet}

<div class="scene-toolbar" role="toolbar" aria-label={t.sceneToolbar}>
  {#if view === 'site'}
    {#each commands as c (c.key)}
      <span class="tip-box">
        <button
          class="btn"
          data-testid="site-{c.key}"
          title={reason ? undefined : c.hint}
          aria-disabled={reason ? 'true' : undefined}
          aria-describedby={reason ? `${id}-${c.key}` : undefined}
          onclick={() => !reason && c.run()}>{c.label}</button
        >
        {#if reason}<span class="tip" role="tooltip" id="{id}-{c.key}">{reason}</span>{/if}
      </span>
    {/each}
    <span class="divider" role="separator" aria-orientation="vertical"></span>
    {@render chip(t.pipes, $sitePipes, () => sitePipes.update((v) => !v), 'site-pipes')}
    {@render chip(t.cables, $siteCables, () => siteCables.update((v) => !v), 'site-cables')}
    {@render chip(
      t.site.flow,
      $flowAnimation,
      () => flowAnimation.update((v) => !v),
      'site-animation',
      t.site.animationHint,
    )}
    {@render chip(
      t.site.undergroundView,
      $xray,
      () => xray.update((v) => !v),
      'site-xray',
      t.site.undergroundViewHint,
    )}
    {@render chip(
      t.site.icons,
      $showIcons,
      () => showIcons.update((v) => !v),
      'site-icons',
      t.site.iconsHint,
    )}
  {:else}
    {@render chip(t.pipes, $showPipes, () => showPipes.update((v) => !v), 'toggle-pipes')}
    {@render chip(t.cables, $showCables, () => showCables.update((v) => !v), 'toggle-cables')}
    {@render chip(t.below, $connectBelow, () => connectBelow.update((v) => !v), 'toggle-below', t.belowHint)}
    {@render chip(t.xray, $xray, () => xray.update((v) => !v), 'toggle-xray')}
  {/if}
</div>

<style>
  .scene-toolbar {
    position: fixed;
    top: calc(var(--bar-h) + 12px);
    left: calc(var(--gutter) + var(--outline-w, 0px));
    /* Below the outline (25) and the drawers (28, 40), above the canvas. */
    z-index: 22;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    max-width: calc(100vw - var(--gutter) * 2 - var(--outline-w, 0px) - var(--drawer-w, 0px));
  }
  .tip-box {
    position: relative;
    display: inline-flex;
  }
  .tip {
    display: none;
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 1;
    width: max-content;
    max-width: 220px;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--text);
    color: var(--bg);
    font-size: 12px;
    pointer-events: none;
  }
  .tip-box:hover .tip,
  .tip-box:focus-within .tip {
    display: block;
  }
  .divider {
    align-self: stretch;
    width: 1px;
    margin: 4px 4px;
    background: var(--border);
  }
  @media (max-width: 760px) {
    .scene-toolbar {
      max-width: calc(100vw - var(--gutter) * 2);
    }
  }
</style>
