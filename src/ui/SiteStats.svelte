<script lang="ts">
  import { getSiteDef } from '../data/generic';
  import { t } from '../i18n/en';
  import { site, siteGroup, siteNet } from '../state/site';
  import { splitWarnings } from './siteInspect';
  import { siteBuild, siteBusy } from './sitePipeline';

  interface Props {
    onproblems: () => void;
  }
  let { onproblems }: Props = $props();

  const build = $derived($siteBuild.build);

  const main = $derived.by(() => {
    if (!build) return $siteBusy ? [t.site.building] : [];
    const s = build.stats;
    const out = [t.site.groupCount(s.groups), t.units(s.units), t.blocks(s.blocks)];
    if (s.sharedBlocks) out.push(t.site.sharedWalls(s.sharedBlocks));
    if ($siteBusy) out.unshift(t.site.building);
    // While editing, the pipes wait (and their counts would read 0).
    if ($siteBuild.pending) {
      out.push(t.site.pipesWait);
      return out;
    }
    if (s.pipeBlocks) out.push(t.pipeLength(s.pipeBlocks));
    if (s.cableBlocks) out.push(t.cableLength(s.cableBlocks));
    if (s.terminals) out.push(t.site.connected(s.connected, s.terminals));
    return out;
  });

  const detail = $derived.by(() => {
    if (!build) return null;
    if ($siteNet !== null) {
      const n = build.nets.find((x) => x.id === $siteNet);
      const res = n ? $site.resources[n.resource] : undefined;
      if (n && res && n.route) {
        const base = t.site.netInfo(res.name, n.route.length, n.route.connected, n.route.total);
        return n.rate !== undefined ? `${base} · ${t.site.rateText(n.rate, res.kind)}` : base;
      }
    }
    const g = build.groups.find((x) => x.group.id === $siteGroup);
    if (g) {
      const name = g.group.label ?? g.def?.name ?? getSiteDef(g.group.multiblockId)?.name ?? g.group.id;
      const src = g.group.source
        ? [g.group.source.name, g.group.source.tier].filter(Boolean).join(' · ')
        : undefined;
      return t.site.groupInfo(name, g.units.length, src);
    }
    return null;
  });

  const problems = $derived(splitWarnings(build?.warnings ?? []).problems.length);
</script>

{#if main.length || detail}
  <footer class="stats" data-testid="site-stats">
    {#each main as part, i (i)}
      {#if i > 0}<span class="dot" aria-hidden="true">{t.separator}</span>{/if}
      <span>{part}</span>
    {/each}
    {#if problems}
      <span class="dot" aria-hidden="true">{t.separator}</span>
      <button class="link warn" data-testid="site-problems" onclick={onproblems}
        >{t.site.problemCount(problems)}</button
      >
    {/if}
    {#if detail}
      <span class="break" aria-hidden="true"></span>
      <span class="detail" data-testid="site-detail">{detail}</span>
    {/if}
  </footer>
{/if}

<style>
  .stats {
    position: fixed;
    left: 160px;
    right: 240px;
    bottom: 22px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: baseline;
    gap: 2px 0;
    z-index: 10;
    pointer-events: none;
  }
  .dot {
    margin: 0 10px;
    color: var(--faint);
  }
  .warn {
    pointer-events: auto;
    color: var(--text);
    padding: 0;
  }
  .break {
    flex-basis: 100%;
    height: 0;
  }
  .detail {
    color: var(--text);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  @media (max-width: 640px) {
    .stats {
      left: var(--gutter);
      right: var(--gutter);
      bottom: auto;
      top: calc(var(--bar-h) + 2px);
      justify-content: flex-start;
      column-gap: 14px;
    }
    .dot {
      display: none;
    }
  }
</style>
