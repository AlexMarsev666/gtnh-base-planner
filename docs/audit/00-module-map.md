# 00 — Module map (stage 1)

Produced by `code-explorer` (Haiku) for the audit of 2026-10-10, branch `cla` at `b9969eb`. Line counts are approximate; the
lead agent re-checked the data counts (244 / 210 / 34) and found the `src/model` total underestimated (site + routing + hatches + layout
alone are ~7.7k lines including tests).

## Entry points

- `index.html` → `src/main.ts` → `src/ui/App.svelte`
- `src/ui/siteWorker.ts` — Web Worker for site builds, arrange/optimize and GTNH imports

## Directories

| Directory    | Purpose                                                                               | Imports from                           |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| `src/data`   | Catalog (`import.meta.glob` of `multiblocks/*.json`), blocks, GTNH name map, validate | model types, geometry, resize          |
| `src/model`  | Pure logic: core, multiblock, plan, render types; layout, hatches, routing, site      | data only (no ui/state)                |
| `src/ui`     | Svelte components, machine and site pipelines, worker controller, sessions, commands  | model, state, import, share, data, …   |
| `src/state`  | Svelte writable stores (plan, site, checklist)                                        | data, model, share                     |
| `src/render` | Three.js renderer, SIMPLE / DETAILED materials, controls                              | model types (no ui/state)              |
| `src/share`  | Share-link codecs, JSON files, localStorage persistence                               | model, data                            |
| `src/import` | GTNH Planner import                                                                   | model, data, **ui/fields** (see below) |
| `src/i18n`   | UI strings                                                                            | —                                      |

Layering: no `model → ui/state` imports. One upward import: `src/import/gtnhplanner.ts:36` imports `clampCount` from `../ui/fields`.

## Largest source files

`render/renderer.ts` (1259), `import/gtnhplanner.ts` (891), `model/site/router.ts` (690), `model/site/anneal.ts` (672),
`ui/SitePanel.svelte` (623), `ui/GroupInspector.svelte` (415), `ui/ImportDialog.svelte` (412), `render/controls.ts` (402),
`ui/siteActions.ts` (396), `share/siteCodec.ts` (389), `share/codec.ts` (386), `model/site/group.ts` (377),
`model/hatches/sites.ts` (369), `i18n/en.ts` (348), `ui/Settings.svelte` (335).

## Modules over ~150 lines without a colocated test

`data/gtnhplanner-machines.ts`, `data/validate.ts`, `model/hatches/placement.ts`, `model/hatches/sites.ts`,
`model/layout/candidates.ts`, `model/routing/refine.ts`, `model/site/group.ts`, `model/site/nets.ts`, `model/site/siteScene.ts`,
`render/renderer.ts` (e2e only), `ui/siteEditing.ts`. Several are covered indirectly through higher-level tests.

## Multiblock data

244 files in `src/data/multiblocks/`: 210 `"generated": true` (game dump), 34 hand-made.
