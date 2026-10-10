# GTNH Base Planner

A 3D planner for [GregTech: New Horizons](https://github.com/GTNewHorizons/GT-New-Horizons-Modpack) multiblocks that share walls, hatches and pipes. Pick a multiblock, set how many you want, and the planner packs them so compatible casings overlap, places shared hatches and routes pipes between them.

It is a layout tool, not a recipe or production-chain calculator. Structures follow GT:NH **2.9.0-RC-2**
(GT5-Unofficial 5.09.54.205).

**Live:** <https://gtnh-base-planner.pages.dev/>

## Features

- **Catalog of 244 multiblocks** with a picker: every multiblock of GT5-Unofficial 5.09.54.205 but the Mega
  Industrial Apiary and the Cleanroom. 34 are transcribed and checked by hand: steam machines (Steam Separator,
  Grinder, Squasher, Presser, Hearth, Blender, Purifier, Fuser), Coke Oven, EBF, Vacuum Freezer, Distillation
  Tower, Pyrolyse Oven, Large Turbines, combustion engines, Assembly Line, Large Fluid Extractor, Industrial
  Autoclave, Industrial Centrifuge and more. The other 210 (Large Boilers, GT++ industrial machines, fusion
  reactors, drilling rigs, TecTech, Bartworks, Good Generator, the Water Purification Plant and its units, the
  Nanochip Assembly Complex and its modules, Forge of the Gods, the Space Elevator modules, Large Hadron Collider,
  Antimatter Forge, ...) are built by the game itself and dumped block by block by
  [`tools/game-dump`](tools/game-dump/README.md); they are tagged "From game" in the picker, because their hatch
  counts are estimated. Almost every GT multiblock can share walls in game (structure checks do not claim
  casings).
- **Adjustable sizes** for multiblocks GT builds in variable size: Distillation Tower height (3 to 12) and Assembly Line length (5 to 16).
- **Auto-packing** of N units with optional limits counted in multiblocks (at most N along X, N layers, N along Z); controllers always face outward, and rows that cannot share a back wall get a one-block walkway. Example: 15 Pyrolyse Ovens with X 5, Layers 1, Z 3 give three rows of five.
- **Shared walls**: blocks that coincide in the same cell are counted once; incompatible overlaps are highlighted.
- **Hatches**: enable hatch kinds per plan; shareable hatches serve several controllers from one block. A hatch faces open space rather than a gap between units, and never the ground: the build stands on its lowest layer. Hatches of different kinds are spread apart, and none faces a cell its pipe could not leave.
- **Pipe routing** per hatch kind (items, fluids, steam), with length estimates. The kinds are negotiated rather than laid one after another (a cell two networks want gets dearer each round until one gives way), so no network walls in another kind's hatch. With pipes or cables on, a layout whose walkways cannot hold a line per kind is spaced out step by step (walkways and gaps of one or two blocks, same rows and layers) until every hatch is connected; a warning remains only for hatches that still cannot be reached (e.g. in a manual layout). Packing and routing run in the background, so the page stays responsive while a large build is laid out (the stats line says when it is still working, and pipes appear after an unrouted preview). Routing has a fixed work budget, so it never runs for minutes: on a very large build (such as several Nanochip Assembly Complexes) it can stop early and leave a few hatches unconnected, and the warning says so. Bends are priced in, so pipes run in straight trunks with fewer bends than plain shortest paths. A pipe may reach a hatch from any open side (the hatch is turned to face it, as with a wrench in game), and pipes never go underground.
- **Cable routing**: the Cables toggle connects energy hatches (and dynamo hatches of generators) with thinner cables, like pipes.
- **Textured view**: real GregTech textures, layered and tinted the way the game draws them (glass is
  see-through, a hatch shows the casing it replaces with its own overlay), flat colours when they cannot load,
  with the build's width and depth measured beside it.
- **Stats line**: units, unique blocks, shared walls, hatches and how many blocks sharing saves.
- **Save and share**: autosave in the browser, JSON download/upload, and share links.
- **Templates** (the TEMPLATE view): several groups of multiblocks on a bounded ground area (30 × 30 by default, up to 256 × 256), joined by
  links that each carry one item, fluid or EU. Every group gets one hatch per resource it takes or gives, pipes are
  routed between groups and to input/output ports on the template edges, and animated arrows show which way each
  pipe flows. Groups can be arranged automatically along the flow, moved and turned by hand. Large templates are
  laid out and routed in the background: the groups appear first, their pipes follow, and the page stays usable.
- **GTNH Planner import**: open a chain exported from [GTNH Planner](https://gtnhplanner.com) (its board's
  Export JSON) and it becomes a template: one group per recipe node, links from its edges, ports for whatever enters
  or leaves the chain.

## How to use

1. Choose a multiblock in the catalog.
2. Set the count and, if needed, the maximum footprint.
3. Set the height or length of a resizable multiblock; toggle hatch kinds, pipes and cables.
4. Drag to orbit, scroll or pinch to zoom, right-drag to pan, double-click to reset. Click a block to select its unit.
5. Copy a share link, or download the plan as JSON.

The planner checks layout rules for the transcribed structure only. It is not a full in-game build validation.

### Templates

1. Switch to TEMPLATE in the top bar. Use TEMPLATE (top right) to open the template panel.
2. Import a chain (IMPORT FROM GTNH PLANNER), or build one by hand: ADD MULTIBLOCK, then ADD LINK with a start
   (a group or TEMPLATE INPUT), an end (a group or TEMPLATE OUTPUT) and a resource. In the single-machine view, SETTINGS →
   ADD TO TEMPLATE copies the current plan into the template as a group.
3. ARRANGE lays the groups out west to east along the flow. OPTIMIZE arranges, then searches for a tighter layout
   with shorter pipes in the background: simulated annealing on a cheap length estimate finds candidates, then a
   second pass judges every step by the real router. It may also pack a group of several units another way (rows or
   layers, which sets the group's limits), and says how many it changed. A result is kept only if the router connects at least as much with
   fewer pipe blocks; otherwise the plain arrangement stays. It runs against a time budget of about ten seconds (a second or two for small chains), and a plan that is slow
   to route gets fewer tries. A group's limits can be kept in its settings (editing them keeps them): Arrange and
   Optimize never change those.
   Editing the template while Arrange or Optimize runs stops it (a notice says so); closing the import dialog stops an import in progress.
   Select a group (click it, or pick it in the panel)
   and drag it in the view, or move it with the arrow keys as seen on screen (Shift: 5 blocks) or the arrows in
   the panel; PageUp and PageDown raise and lower it (Shift: 5 blocks), R turns it (Shift+R back), F frames it
   and Delete removes it. The panel edits the selected group: its label and machine, count, limits and extra
   hatches, and X, Z and height to place it exactly. Template inputs and outputs (the chests, tanks and energy
   blocks on the edge) move the same way: click one, then drag it or use the arrows; A gives it back to
   automatic placement. Ports stand on the ground, so they have no height. Ctrl+Z undoes any
   change to the template (Ctrl+Shift+Z or Ctrl+Y redoes it). Moving a group past an edge grows the template
   that way (and ARRANGE grows it when the chain does not fit). While you move or turn groups the pipes wait,
   shown faded, and are routed again a moment after you stop.
4. Click a pipe or a legend entry to highlight one resource; the other nets fade. The bottom line shows the
   selected group or net, and PROBLEMS lists overlaps, groups outside the template, hatches that did not fit and
   pipes that could not be routed.

In the import dialog every recipe node can be placed as a catalog multiblock, a single-block machine (a
1-block machine whose faces take the pipes), a placeholder (a 3×3×3 stand-in for a multiblock not in the catalog
yet), a template port (passive sources such as crops, bees and ore veins) or skipped. The machine name mapping lives
in [`src/data/gtnhplanner-machines.ts`](src/data/gtnhplanner-machines.ts); names it does not list are also
looked up among the machine types GT gives each multiblock ("Vacuum Furnace" is the Utupu-Tanuri), which
`tools/gt-source/machine-types.mjs` collects. The template is sized to the chain, and each port sits on the
edge nearest the groups it serves. After an import the template is shown at once with the plain layout, then optimized
in the background (the box "Optimize the layout after import" in the dialog, on by default; Undo brings the plain layout
back). ARRANGE and OPTIMIZE stay in the template panel for later. Storages between machines are passed
through; product drains become output ports, trash drains void ports. Thaumcraft aspect flows are left out.
Odd values in an export do not stop the import: control characters in names are replaced, machine counts are
clamped and impossible rates are dropped, and the dialog says how many values were adjusted.

## Data model

Each multiblock is one JSON file in [`src/data/multiblocks/`](src/data/multiblocks/), typed as `MultiblockDef` in [`src/model/multiblock/types.ts`](src/model/multiblock/types.ts). Files are picked up at build time; there is no registry to edit.

| Field                | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `id`, `name`, `tier` | Stable id (used in saved plans and links), display name, short tag such as `Steam` or `LV`.  |
| `source`             | Link to the GT5-Unofficial source the structure was transcribed from.                        |
| `size`               | `[x, y, z]` in blocks.                                                                       |
| `layers`             | `layers[y][z]` is a string of length `x`. `~` controller, `-` must be air, space = not part. |
| `legend`             | Every other character: `{ blockId, hatches? }`. `hatches` lists kinds that may replace it.   |
| `controller`         | `{ pos, facing, blockId }`; `pos` is the `~` cell, `facing` the front face (local frame).    |
| `hatchBlocks`        | Block id placed for each hatch kind.                                                         |
| `shareableHatches`   | Hatch kinds whose single block may serve several controllers.                                |
| `requiredHatches`    | Optional `{ min, max }` per hatch kind and unit.                                             |
| `defaultHatches`     | Hatch kinds enabled in a new plan.                                                           |
| `wallshare`          | Whether casings of two units may overlap when the blocks match.                              |
| `resize`             | Optional variable size: `{ axis, from, to, min, max, default, label }`, see below.           |
| `notes`              | Free-text notes: game version, quirks, hatch behaviour.                                      |

Coordinates follow Minecraft: X = east, Y = up, Z = south.

**Variable size.** A multiblock that GT builds in several sizes stores its smallest form (`size[axis] === min`)
with one copy of a repeating slab `[from, to)` along `axis`. A plan's height or length inserts more copies after
it (`sizedDef` in [`src/model/resize.ts`](src/model/resize.ts)). A slab cell with a `region` gets one numbered
region per copy (`layer` → `layer1`, `layer2`, …), and `requiredHatches.*.regions` naming it grow to match, so
the Distillation Tower keeps one output hatch per layer. Never change `default`: plans without a size use it.

**Adding a multiblock**

1. Add `src/data/multiblocks/<id>.json` (see [`coke-oven.json`](src/data/multiblocks/coke-oven.json)).
2. Register any new block ids in [`src/data/blocks.ts`](src/data/blocks.ts) with a flat colour, and map them to textures in [`src/render/textures.json`](src/render/textures.json).
3. Run `npm run check && npm test`, then check the new entry in `npm run dev`.

Structures can be transcribed by hand from the GT5-Unofficial source. Entries marked `"generated": true` are built from a dump of the running game by [`tools/game-dump`](tools/game-dump/README.md); do not edit them by hand. To take one over, remove `generated` and edit it: the build never overwrites a class that a hand-made entry covers. StructureLib shapes read from the sources must be mirrored in X: the first axis of a shape runs to the right of a controller seen from its front, which is west for a controller facing north.

## Textures and attribution

DETAILED view uses block textures from [GT5-Unofficial](https://github.com/GTNewHorizons/GT5-Unofficial), licensed under LGPL-3.0. The generated atlas is `public/textures/atlas.png`; its source files (build inputs, not deployed) are in `tools/texture-sources/` (`DUMP_*.png` are GT sprites layered and tinted the way the game draws a block face, see [`tools/game-dump`](tools/game-dump/README.md)). Vanilla Minecraft blocks keep flat colours: their textures are not LGPL. Sources and licence details are in [`ATTRIBUTION.md`](ATTRIBUTION.md). SIMPLE view uses flat colours only.

## Privacy

There is no server, account or tracking. Plans are stored in your browser's `localStorage`. A share link carries the compressed plan in the URL fragment (`#p=...`, or `#s=...` for a template); browsers never send the fragment to the server, so the host only sees a request for the page. A saved plan or template that can no longer be read (for example after an update removed a multiblock) is never overwritten: a copy is kept in the browser (the newest three), autosave pauses for it, and a notice offers Download copy, Try again and Start new. A template that names a multiblock the catalog no longer has still opens: those groups become placeholders labelled `Missing: <id>` (positions and links stay), a notice says how many, and a stored template's original text is kept as a backup first. Renamed multiblocks are mapped to their new id in [`src/data/multiblock-aliases.ts`](src/data/multiblock-aliases.ts) so old plans, templates and links keep loading; a plan with an unknown multiblock is still refused.

The GTNH Planner import reads the file you open or paste in the browser; the file itself is never sent anywhere.
Exports carry an icon path for each item and fluid, and the template view shows those icons (legend, link list,
import dialog) by loading the images from gtnhplanner.com, without a referrer. Turn off **Item icons** in the template
panel to show colour swatches instead; then the page loads nothing from other sites. Only `/datasets/...png` paths
on gtnhplanner.com are accepted, so a shared template link cannot make the page load any other address. The 3D view
uses colours only: the browser does not allow images from another site in WebGL.

## Development

Requires Node 24 LTS.

```sh
npm ci          # install
npm run dev     # dev server with hot reload
npm run check   # svelte-check + TypeScript
npm test        # unit tests (Vitest)
npm run e2e     # Playwright smoke tests; first run: npx playwright install chromium
npm run build   # texture atlas, then production build into dist/
npm run format  # Prettier
```

Stack: TypeScript, Svelte 5, Three.js, Vite.

### Project structure

```
src/
  data/        block registry, catalog, multiblocks/*.json
  model/       pure logic: geometry, walls, scene model, and one folder per stage:
    core/ multiblock/ plan/ render/   shared types, by domain
    layout/    packing units that share walls
    hatches/   placing hatches on the packed units
    routing/   pipes and cables inside one build
    site/      templates: group builds, ports, resource nets and their router, auto-arrange, scene
  import/      GTNH Planner project import
  render/      Three.js renderer, SIMPLE and DETAILED materials, texture mapping
  share/       share-link codec and local persistence
  state/       app store
  ui/          Svelte components
  i18n/        UI strings
public/        static files copied as-is (favicon, generated texture atlas)
e2e/           Playwright tests
tools/         offline tooling (game dump import, GT source reader, texture sources)
```

## Deployment

The planner is fully client-side: a static site with no backend, database or server-side code. Plans live in
the browser and share links carry the plan in the URL fragment.

```sh
npm install     # or npm ci
npm run dev     # local development
npm run build   # production build into dist/
```

`npm run build` first regenerates the texture atlas (`npm run atlas`: `public/textures/atlas.png` and
`src/render/textures.json` from `tools/texture-sources/`, offline and deterministic), then runs Vite. The texture
sources are build inputs only and are not deployed; `dist/` holds `index.html`, the favicon, the hashed JS and CSS
in `assets/`, and `textures/atlas.png`. Asset paths are relative (`base: './'`), so the same build works at a
domain root and under a sub-path.

**Cloudflare Pages** hosts the live site, through Cloudflare's Git integration (no Wrangler configuration or
API tokens in the repository). Every push to `main` deploys <https://gtnh-wallshare-planner.pages.dev/>; other
branches get preview deployments. Project settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: 24, read from [`.node-version`](.node-version) (or set `NODE_VERSION=24`)

**CI.** Pull requests and pushes to `main` run [`ci.yml`](.github/workflows/ci.yml): formatting, type-check,
unit tests, build and end-to-end tests. It deploys nothing.

## License

The planner is released under the [MIT License](LICENSE), © 2026 ryazhenkofc.

Bundled third-party files keep their own licences:

- GT5-Unofficial block textures (the sources in `tools/texture-sources/` and the generated `public/textures/atlas.png`) are under LGPL-3.0; see [`ATTRIBUTION.md`](ATTRIBUTION.md).
- `tools/game-dump/extractor.patch` changes the Apache-2.0 [gtnh-process-line-solver](https://github.com/MrBruh/gtnh-process-line-solver) extractor; it is not bundled.
