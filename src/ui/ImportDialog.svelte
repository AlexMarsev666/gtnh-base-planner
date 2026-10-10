<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { catalog } from '../data/catalog';
  import { t } from '../i18n/en';
  import {
    ImportError,
    MAX_IMPORT_BYTES,
    importRows,
    parseGtnhProject,
    type GtnhProject,
    type ImportRow,
    type MachineChoice,
  } from '../import/gtnhplanner';
  import { SITE_MAX_SIZE, SITE_MIN_SIZE } from '../share/siteCodec';
  import { appMode, site } from '../state/site';
  import { connectBelow } from '../state/store';
  import { notify } from './notices';
  import NumberField from './NumberField.svelte';
  import ResourceIcon from './ResourceIcon.svelte';
  import { releaseIfBackedUp } from './recovery';
  import { fallbackColor } from '../import/gtnhplanner';
  import { importSite } from './sitePipeline';
  import { replaceSite } from './siteActions';
  import { optimizeAfterImport } from './siteCommands';
  import { runImport } from './importFlow';

  interface Props {
    onclose: () => void;
  }
  let { onclose }: Props = $props();

  /** Pastes longer than this are read without showing them. */
  const LARGE_PASTE = 200_000;

  let text = $state('');
  let error = $state<string | null>(null);
  let project = $state.raw<GtnhProject | null>(null);
  let rows = $state.raw<ImportRow[]>([]);
  /** Per node id: choice encoded as a select value (`mb:<id>`, `single`, `placeholder`, `port`, `skip`). */
  let choices = $state<Record<string, string>>({});
  /**
   * Rows whose machine list has been opened. The others list only their current choice: a chain of 150
   * nodes would otherwise put 30 000 options in the page.
   */
  let expanded = $state<Record<string, boolean>>({});
  /** Catalog entries a row's select lists. */
  const listed = (id: string) =>
    expanded[id] ? catalog : catalog.filter((d) => choices[id] === `mb:${d.id}`);
  // Start from the current site size.
  let width = $state(get(site).size[0]);
  let depth = $state(get(site).size[1]);
  let fit = $state(true);
  /** Optimise the layout in the background once the template is shown. */
  let optimizeAfter = $state(true);

  function encode(c: MachineChoice): string {
    return c.type === 'multiblock' ? `mb:${c.id}` : c.type;
  }
  function decode(v: string): MachineChoice {
    if (v.startsWith('mb:')) return { type: 'multiblock', id: v.slice(3) };
    return { type: v as 'single' | 'placeholder' | 'port' | 'skip' };
  }

  function read(source: string) {
    error = null;
    try {
      const p = parseGtnhProject(source);
      project = p;
      rows = importRows(p);
      choices = Object.fromEntries(rows.map((r) => [r.node.id, encode(r.proposed)]));
      expanded = {};
    } catch (err) {
      project = null;
      rows = [];
      error = err instanceof ImportError ? err.message : String(err);
    }
  }

  let fileInput = $state<HTMLInputElement>();
  async function onfile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      error = 'The file is too large.';
      return;
    }
    text = '';
    read(await file.text());
  }

  /** Closing the dialog (Esc, Cancel, anything) stops an import still running. */
  const ac = new AbortController();
  onDestroy(() => ac.abort());

  let building = $state(false);
  async function build() {
    if (!project || building) return;
    const map = new Map(Object.entries(choices).map(([k, v]) => [k, decode(v)]));
    building = true;
    error = null;
    const message = await runImport(
      project,
      map,
      { size: [width, depth], fit, below: get(connectBelow) },
      optimizeAfter,
      ac.signal,
      {
        importSite,
        releaseIfBackedUp,
        replaceSite,
        showSite: () => appMode.set('site'),
        notify,
        close: onclose,
        optimizeAfterImport,
      },
    );
    building = false;
    if (message !== null && !ac.signal.aborted) error = message;
  }

  /** Up to three item and fluid outputs of a row's recipe, each once (a recipe may list one twice). */
  function shownOutputs(r: ImportRow) {
    const seen = new Set<string>();
    return (r.recipe?.outputs ?? [])
      .filter((o) => {
        const k = o.kind + o.id;
        if ((o.kind !== 'item' && o.kind !== 'fluid') || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3);
  }

  /** A large paste is read right away instead of being put into the text box (megabytes of text are slow there). */
  function onpaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (pasted.length < LARGE_PASTE) return;
    e.preventDefault();
    text = '';
    read(pasted);
  }

  function clampSize(v: string): number | null {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(SITE_MAX_SIZE, Math.max(SITE_MIN_SIZE, n)) : null;
  }
</script>

<div class="dialog" role="dialog" aria-label={t.importer.title} data-testid="import-dialog">
  <div class="inner">
    <div class="head">
      <span class="title">{t.importer.title}</span>
      <button class="link" onclick={onclose}>{t.importer.cancel}</button>
    </div>
    <p class="hint">{t.importer.hint}</p>

    <textarea
      class="paste"
      placeholder={t.importer.paste}
      aria-label={t.importer.paste}
      spellcheck="false"
      data-testid="import-text"
      {onpaste}
      bind:value={text}></textarea>
    <div class="actions">
      <button class="link" data-testid="import-read" disabled={!text.trim()} onclick={() => read(text)}
        >{t.importer.read}</button
      >
      <button class="link" onclick={() => fileInput?.click()}>{t.importer.openFile}</button>
      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        accept="application/json,.json"
        tabindex="-1"
        aria-hidden="true"
        onchange={onfile}
      />
    </div>
    {#if error}<p class="error" data-testid="import-error">{error}</p>{/if}

    {#if project}
      <h2>{project.name}</h2>
      {#if project.newerSchema}<p class="hint" data-testid="import-newer">
          {t.importer.newerSchema(project.schemaVersion ?? 0)}
        </p>{/if}
      {#if project.skipped}<p class="hint">{t.importer.skippedEntries(project.skipped)}</p>{/if}
      <table class="rows" data-testid="import-rows">
        <thead>
          <tr
            ><th>{t.importer.node}</th><th>{t.importer.machine}</th><th>{t.importer.count}</th><th
              >{t.importer.placeAs}</th
            ></tr
          >
        </thead>
        <tbody>
          {#each rows as r (r.node.id)}
            <tr>
              <td class="name">
                <span class="recipe">
                  {#each shownOutputs(r) as o (o.kind + o.id)}
                    <ResourceIcon
                      res={{
                        kind: o.kind as 'item' | 'fluid',
                        name: o.displayName ?? o.id,
                        color: o.dominantColor ?? fallbackColor(`${o.kind}:${o.id}`),
                        icon: o.iconPath,
                      }}
                      size={22}
                    />
                  {/each}
                  <span>{r.recipe?.name ?? r.node.recipeId}</span>
                </span>
              </td>
              <td>{r.machine}</td>
              <td class="num"
                >{r.count}<span class="meta"> ({Math.round(r.node.machineCount * 100) / 100})</span></td
              >
              <td>
                <select
                  class="field select"
                  bind:value={choices[r.node.id]}
                  aria-label={t.importer.placeAs}
                  onpointerdown={() => (expanded[r.node.id] = true)}
                  onfocus={() => (expanded[r.node.id] = true)}
                >
                  <option value="single">{t.importer.single}</option>
                  <option value="placeholder">{t.importer.placeholder}</option>
                  <option value="port">{t.importer.port}</option>
                  <option value="skip">{t.importer.skip}</option>
                  <optgroup label={t.site.groups}>
                    {#each listed(r.node.id) as d (d.id)}<option value={`mb:${d.id}`}>{d.name}</option>{/each}
                  </optgroup>
                </select>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <div class="fields">
        <label class="pair check"
          ><input type="checkbox" bind:checked={fit} /><span>{t.importer.fit}</span></label
        >
        <label class="pair check" title={t.importer.optimizeAfterHint}
          ><input type="checkbox" data-testid="import-optimize" bind:checked={optimizeAfter} /><span
            >{t.importer.optimizeAfter}</span
          ></label
        >
        {#if !fit}
          <label class="pair"
            ><span>{t.site.width}</span><NumberField
              value={String(width)}
              label={t.site.width}
              oncommit={(v) => {
                const n = clampSize(v);
                if (n !== null) width = n;
              }}
            /></label
          >
          <label class="pair"
            ><span>{t.site.depth}</span><NumberField
              value={String(depth)}
              label={t.site.depth}
              oncommit={(v) => {
                const n = clampSize(v);
                if (n !== null) depth = n;
              }}
            /></label
          >
          <p class="hint" data-testid="import-fixed-hint">{t.importer.fixedHint}</p>
        {/if}
      </div>
      <div class="actions">
        <button class="link active" data-testid="import-build" disabled={building} onclick={build}
          >{building ? t.importer.building : t.importer.build}</button
        >
        {#if $site.groups.length}<span class="hint">{t.importer.replaces}</span>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .dialog {
    position: fixed;
    inset: 0;
    background: var(--bg);
    z-index: 50;
    overflow-y: auto;
    padding: calc(var(--bar-h) + 12px) var(--gutter) 64px;
  }
  .inner {
    max-width: 920px;
    margin: 0 auto;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .title,
  h2 {
    color: var(--text);
  }
  h2 {
    font: inherit;
    margin: 28px 0 6px;
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint,
  .meta {
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  .hint {
    margin: 0 0 12px;
  }
  .paste {
    width: 100%;
    height: 120px;
    resize: vertical;
    border: 1px solid var(--line);
    padding: 8px;
    font:
      11px/1.4 ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
    color: var(--text);
    text-transform: none;
    letter-spacing: 0;
  }
  .actions {
    display: flex;
    gap: 18px;
    align-items: baseline;
    margin: 8px 0;
  }
  .error {
    color: var(--text);
    text-transform: none;
    letter-spacing: 0.02em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
  }
  th {
    font-weight: normal;
    text-align: left;
    padding: 4px 8px 4px 0;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 3px 8px 3px 0;
    color: var(--text);
    text-transform: none;
    letter-spacing: 0.02em;
    vertical-align: middle;
  }
  .recipe {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    white-space: nowrap;
  }
  .select {
    text-align: left;
    text-transform: none;
    letter-spacing: 0.02em;
    max-width: 240px;
    cursor: pointer;
  }
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    align-items: baseline;
    margin-top: 18px;
  }
  .fields .hint {
    flex-basis: 100%;
    margin: 0;
  }
  .pair {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .pair > span {
    white-space: nowrap;
  }
  .check {
    text-transform: none;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  @media (max-width: 640px) {
    th:nth-child(2),
    td:nth-child(2) {
      display: none;
    }
  }
</style>
