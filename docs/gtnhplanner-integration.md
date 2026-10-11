# Plan: GTNH Planner integration and multi-machine sites

Status: milestones 1–6 are implemented (see "What was built" at the end). Milestone 7 waits on GTNH Planner.

Goal: take a production chain from [GTNH Planner](https://gtnhplanner.com) (a flowchart of recipes, machine
counts and item/fluid flows), turn every recipe node into a group of our multiblocks, place the groups on a
bounded site (for example 30 × 30 blocks), route pipes between them, and show the inputs and outputs in 3D.

## 1. What GTNH Planner exposes

The site is a Next.js app (`GET /api/version` returns `{"version":"3.9.2"}` as of 2026-09-26). The code is open
source (MIT). It was forked from `Samiracle64/gtnh-factory-flow` and then diverged. The route and schema names
below come from the forks (`src/app/api/**/route.ts` and `src/lib/model/schemas.ts`). We checked the live site
for the endpoints marked "checked".

| Endpoint                                          | Auth | Notes                                                                                                                                                                                                           |
| ------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/version`                                | none | Checked.                                                                                                                                                                                                        |
| `GET /api/community/plans`                        | none | Checked. Lists public plans: `id`, `name`, `description`, `gameVersion`, `datasetVersionId`, `tags`, `icon`, `needs[]` and `outputs[]` (`kind`, `resourceId`, `displayName`, `dominantColor`, `ratePerSecond`). |
| `GET /api/community/plans/{id}?countView=0`       | none | One plan's summary. Without `countView=0`, each call counts as a view.                                                                                                                                          |
| `POST /api/community/plans/{id}/download`         | none | Returns the full project JSON (below). Each call counts as a download.                                                                                                                                          |
| `GET /api/datasets/{versionId}/catalog\|recipes…` | none | The recipe dataset. We do not need it for layout.                                                                                                                                                               |
| `/api/blueprints`, `/api/library`                 | user | Checked: both return 401. Out of scope.                                                                                                                                                                         |

**The live API sends no CORS headers.** A request with our site's origin (tested as `https://ryazhenkofc.github.io`) gets no
`Access-Control-Allow-Origin`, so our static app cannot call it from the browser. Right now the only way in is
the **Export JSON** button on their board (`serializeFactoryProject`), followed by file upload or paste on our
side.

### Their project format (`factoryProjectSchema`, `schemaVersion: 1`)

Only the fields we use are listed.

```ts
recipes[]:  { id, name, machineType, minimumTier, durationTicks, eut,
              inputs[]/outputs[]: { kind: 'item'|'fluid'|'aspect'|'power', id, amount, displayName?, dominantColor? },
              machineHandlers?[]: { id, label, kind?: 'single'|'multiblock'|… }, power?: { sourceId, euPerTick } }
nodes[]:    { id, recipeId, machineCount (fractional), overclockTier, energyHatches?, machineHandlerId?,
              coilTier?, enabled, pocketId?, position }
storages[]: { id, kind, resourceId, displayName?, dominantColor?, drainMode?: 'product'|'byproduct'|'trash' }
edges[]:    { id, source, target (node or storage ids), resourceKind, resourceId, ratePerSecond? }
pockets[]:  { id, name, parentPocketId? }   // their visual sub-groups
```

`machineType` holds display names: `"Blast Furnace"` (alias `"Electric Blast Furnace"`), `"Oil Cracker"`
(alias `"Oil Cracking Unit"`), `"Large Chemical Reactor"`/`"LCR"`, `"Distillation Tower"`, `"Vacuum Freezer"`,
`"Pyrolyse Oven"`, `"Coke Oven"`, `"Multi Smelter"`, `"Implosion Compressor"`, `"TurboCan Pro"`,
`"Industrial Autoclave"`, `"Dissection Apparatus"`, `"Big Barrel Brewery"`, `"Large Fluid Extractor"`,
`"Bricked Blast Furnace"`, and so on. The alias list lives in their `src/lib/machines/machine-table.ts`. Many of
these are already in our catalog. Single-block machines (`"Assembler"`, `"Macerator"`, `"Bender"`,
`"Chemical Reactor"` …) and passive sources (`"Crop Farm"`, `"Bee Produce"`, ore veins, `"Source"`) also appear.

## 2. Mapping their model onto ours

| GTNH Planner                                  | Wall-share planner                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| recipe node                                   | **Group**: `ceil(machineCount)` units of one multiblock, packed with today's packer                       |
| `recipe.machineType` / handler label          | `multiblockId`, through a new table `src/data/gtnhplanner-machines.ts` (name and aliases → id)            |
| `node.energyHatches`, `overclockTier`         | energy hatch count per unit; tier shown in the label                                                      |
| item/fluid `edge`                             | **Link**: output hatch of group A → input hatch of group B, one net per link resource                     |
| `power` edge / `recipe.power` (generators)    | cable link: dynamo → energy (the Cables toggle already routes these)                                      |
| `aspect` edge                                 | dropped, with a notice (Thaumcraft)                                                                       |
| recipe input that no edge feeds               | **site input port** on the site boundary                                                                  |
| output nothing consumes, or a `product` drain | **site output port**                                                                                      |
| `trash` drain                                 | output port with a "void" marker                                                                          |
| `dominantColor`, `displayName`                | colour and name of the resource (pipe colour, legend)                                                     |
| `pocketId`                                    | hint to keep groups together when arranging (optional)                                                    |
| single-block machine                          | new generic `singleblock` def: 1×1×1, I/O on its own faces                                                |
| multiblock we have not transcribed            | placeholder box (size from a small table, else 3×3×3), marked "not transcribed", listed for the extractor |
| passive source (crops, bees, veins)           | site input port                                                                                           |

The import dialog shows this mapping before anything is built. The user sees one row per node with the
proposed multiblock (a dropdown to override it, or "single block" / "skip"), the unit count and its resources.

## 3. New plan model: a site

`PlanState` has one `multiblockId` today. We add a v2 state that is a superset. A v1 plan loads as a site
with one group, so current links and saved plans keep working.

```ts
interface SiteState {
  v: 2;
  site: { size: [w: number, d: number]; maxHeight?: number }; // default [30, 30]
  groups: GroupState[];
  links: LinkState[];
  ports: SitePort[]; // boundary inputs/outputs
  resources: Record<string, { kind: 'item' | 'fluid' | 'power'; name: string; color: string }>;
  colors: Partial<Record<HatchKind, string>>;
}
interface GroupState {
  id: string;
  label?: string;
  multiblockId: string;
  count: number;
  limits: PlanLimits;
  size?: number;
  enabledHatches: HatchKind[];
  origin: [x: number, z: number]; // min corner in the site; y = 0
  rotation: Rotation;
  manualUnits?: Unit[]; // in group-local coordinates
  source?: { gtnhNodeId: string; recipeName: string; machineCount: number };
}
interface LinkState {
  id: string;
  from: { group: string } | { port: string };
  to: { group: string } | { port: string };
  resource: string; // key of `resources`
  rate?: number; // per second, from the edge
}
```

- `codec.ts`: `PLAN_VERSION = 2` with a validator for the new shape; v1 is still decoded and migrated. Only
  the fields above are stored. Recipes, icons and NEI data are dropped, so a 20-group import stays a few KB
  compressed, well under `MAX_LINK_CODE_CHARS` (64 KB).
- `store.ts`: `plan` becomes the site. The current single-machine UI edits the selected group.

## 4. Pipeline changes

Today: `plan → packUnits → placeHatches → computeWallStats → routePipes → buildSceneModel`, all for one `def`.

1. **Per group** (memoised by group, so moving one group does not repack the others): the existing
   `resolveLayout` + `placeHatches` in group-local coordinates.
   - **Hatches per resource.** A group needs one output hatch of kind `k` for each distinct output resource of
     that kind, and one input hatch for each input resource. `placeHatches` takes this as a demand that raises
     `requiredHatches[k].min`. Each placed hatch gets a `resource` tag. Shareable hatches are only shared
     inside one group and for the same resource. If the demand is more than the structure's `max`, show a
     warning.
2. **Site transform**: move each group to world space (origin + rotation of its bounding box, reusing
   `rotateLocal`/`toWorld`).
3. **Collisions and bounds**: overlap between groups is an error. Cells outside `site.size` are drawn red. In
   v1, groups do not share walls with other groups (see open questions).
4. **Terminal assignment**: for each link, choose the source and target hatches with its resource. When a
   group has several, pick the one nearest the other end.
5. **Routing, generalised** (then `routing.ts`, now `src/model/routing/`): today there is one net per `HatchKind` and one `def`. Change it to
   one net per link or port net, with explicit terminals and solids from every group.
   - `termMask` is a `Uint8Array` bitmask of 7 kinds. Replace it with a `Uint16Array` net index. `occ` becomes
     `PIPE + netIndex` in a `Uint16Array`.
   - Search box = site box (`w × d × maxHeight`) instead of structure bounds + `MARGIN`.
   - Order: nets with more terminals and longer spans first. If some stay unconnected, rip up and reroute them
     with a congestion penalty (PathFinder style), limited to a few passes.
   - Keep the current bend cost, no-underground rule and rotate-the-hatch-to-the-pipe rule.
   - Budget: 30 × 30 × 16 ≈ 14k cells is small. With about 40 nets it should still take under 100 ms. If it
     does not, move routing into a Web Worker.
6. **Scene**: voxels of all groups, nets coloured by resource, port markers, group labels.

## 5. Arranging groups on the site

- **Auto-arrange (layered)**: build the group graph from links. Reverse the back edges of cycles (recycle
  loops). Assign layers by longest path. Place layers west → east and order groups within a layer by the
  barycenter heuristic (2–3 sweeps) to reduce crossings. Input ports go on the west edge, outputs on the east.
- **Footprints**: each group's bounding box comes from its pack. The arranger may try other `limits` (for
  example 2 rows instead of 1) so a group fits the site depth. Leave a configurable corridor (default 2
  blocks) between groups for pipes.
- **Does not fit**: say so with the size needed ("needs 34 × 30"). Optionally stack low groups.
- **Manual**: drag a group on the ground grid (snap to blocks), `R` rotates it, and collisions are highlighted
  live. Before 3D dragging exists, number fields in Settings do the same job.
- Optimiser (built, OPTIMIZE button, `src/model/site/anneal.ts`, `optimize.ts`, `shapes.ts`). Stage 1 anneals group
  positions and turns on an estimate (net wire length, part between centres and part across the free gap, plus
  the bounding-box span) from several seeds and routes the best results. The estimate misleads: on test webs its
  best layouts routed worse than the start. Stage 2 therefore anneals again from the best layout, judging every
  step by the router (cached per layout). A result replaces the arrangement only if it beats it on the router's own
  numbers (problems, unconnected terminals, pipe blocks, span), so it is never worse than Arrange.
  Groups of several units may also be repacked with other `limits` (rows and layers, up to three); runs alternate
  between allowing that and not, since repacking widens the spread of results more than it moves the median.
  Groups whose limits are locked (`SiteGroup.limitsLocked`, set by editing them) are never repacked, nor by Arrange.
  It runs when the OPTIMIZE button is pressed and, unless switched off in the import dialog, by itself once an
  imported template has been built and shown (skipped if it was edited meanwhile); ARRANGE stays as it was.
  The work is an iteration budget that grows with the plan (not time), so a run is repeatable for a seed; only a
  60 s safety limit can cut it short. One routing of the start layout sets the pace, so slow-to-route plans
  (a thousand machines: seconds per routing) get fewer candidates and no polish. Packs are kept across the search
  (`SiteBuildOptions.keepCache`). Measured on exported plans of 16 to 154 groups: 25-50 % fewer pipe and cable blocks
  on most, 5-14 % where routing is slow, nothing where no layout beat the start. Not yet: routing only the nets a
  move touches, which is the next speed-up.

## 6. Showing I/O

- Ground grid of the site with boundary lines and coordinates.
- Pipes coloured by resource (`dominantColor`, or a palette colour when it is missing). Item conveyors are
  square, fluid pipes round, cables thin (as today).
- Flow direction: chevrons animated along each path (a UV offset in the shader), with speed on a log scale of
  the rate.
- Hover or click a pipe or hatch to see, for example: "Nitrogen · 250 L/s · EBF ×4 → Vacuum Freezer ×2 · 38
  blocks".
- Group labels above the controller, for example "EBF ×4 (3.4 needed) · HV".
- Site ports: coloured posts on the boundary, plus an I/O panel listing site inputs and outputs with rates
  (the same numbers as their "needs" and "outputs").
- Legend with every resource. Click one to isolate it (everything else dims).
- Warnings: link not routed, hatch demand above the structure's max, group outside the site, machine not
  transcribed.
- Later: pick a GT pipe material from the link rate (fluid pipe capacity tiers).

## 7. How we connect to GTNH Planner

- **A. File or paste (no change needed on their side).** "Import from GTNH Planner" accepts their exported
  JSON. We parse it with our own permissive validator, in the style of `validatePlanState`: no new
  dependency, unknown fields ignored, input capped at about 5 MB. Then the mapping dialog opens, then
  auto-arrange runs. Everything happens in the browser, which keeps the README's privacy promise.
- **B. Browse community plans in the app (needs their cooperation).** This is blocked by CORS. Ask the
  maintainers for:
  - `Access-Control-Allow-Origin: *` on `GET /api/community/plans` and `GET /api/community/plans/{id}`
  - a read-only `GET` export, or CORS on the `POST` download

  With that in place, we can also accept a pasted gtnhplanner.com plan link. A proxy of our own (for example
  a Cloudflare Worker) would work too. It is not recommended: it adds a server and breaks the "no server"
  statement in the README.

- **C. "Open in 3D" from their site (optional, needs them).** They link to
  `https://gtnh-wallshare-planner.pages.dev/#gtnh=<planId>`, or pass the JSON through `postMessage`.

B and C send a request to a third party, so they only run on a user action, and we document them in the
README's Privacy section. We do not hotlink their item icons: we use colour swatches.

## 8. Milestones

Each milestone ships on its own, with `npm run check && npm test` green and e2e updated.

1. **Site model**: `SiteState` types, v1 → v2 migration, codec v2, persistence. Tests for round trips and
   migration.
2. **Several groups**: per-group pipeline, world transform, collisions and bounds, scene for several groups,
   site ground grid, a group list in Settings with numeric placement.
3. **Links and routing**: resource-tagged hatch demand in `ports.ts` (now `src/model/hatches/`), net-based routing in `routing.ts` (now
   `src/model/site/router.ts`), site
   ports. Tests: one link between two groups, a loop, a dense 30 × 30 case with a time budget.
4. **I/O display**: resource colours, flow chevrons, tooltips, legend with isolation, labels, I/O panel.
5. **Arranging**: layered auto-arrange, then drag and rotate in 3D.
6. **GTNH Planner import (A)**: parser, machine mapping table and tests, `singleblock` and placeholder defs,
   mapping dialog. The parser and mapping have no UI dependencies, so they can be built and tested next to
   milestones 1–3 against a real exported plan.
7. **Community browse (B/C)**, only if the upstream CORS change happens.

## 9. Open questions

1. Site size: fixed 30 × 30 or configurable (30 × 30 by default)? Is there a height limit?
2. May groups from different nodes share walls? For example, two EBF groups side by side could share casings.
3. Items: GT pipes and conveyors, or ME? Many bases move items over AE2, and then only fluids need pipes. A
   per-site "items via ME" toggle would turn item links into interface markers instead of routes.
4. Is anyone in touch with the GTNH Planner maintainers about CORS or a read-only export?
5. We need one or two real exported plans (their **Export JSON**) to use as test fixtures.

## 10. What was built

Milestones 1–6, with these choices where the plan left a question open or the code suggested another way:

- **A separate site format instead of `PlanState` v2.** The single-machine view, its links (`#p=`) and saved
  plans are untouched. A site is its own state (`src/model/site/types.ts`), validated by
  `src/share/siteCodec.ts`, saved under `gtnh-planner:site:v1` and shared as `#s=`. The top bar switches between
  MACHINE and SITE, and SETTINGS → ADD TO SITE turns the current plan into a group.
- **Site size** is configurable (8–128 per side), 30 × 30 by default, with a corridor setting (default 2). There
  is no height limit; pipes may pass up to 3 blocks above the tallest group.
- **Groups do not share walls with other groups** (overlaps are reported). Groups share walls inside themselves
  as before.
- **Items travel in pipes** like fluids; there is no ME mode yet.
- **Routing** (`src/model/site/router.ts`) is net-based: one net per resource and connected set of links, grown
  as a bend-priced shortest-path tree, then up to four rounds of rip-up and negotiated rerouting (contested
  cells get more expensive). On the test chain every terminal connects in about 120 ms; the rare leftovers are
  listed under PROBLEMS.
- **Moving groups** is done with the arrow keys, R and the X/Z fields rather than by dragging in 3D.
- **Ports** are placed automatically on the west (inputs) and east (outputs) edges, next to the groups they
  serve; the format keeps an optional explicit position for later.
- **Rates** come only from GTNH Planner edges (shown in the link list and the bottom line); they are not
  recomputed from recipes.
- **Icons**: item and fluid icons come from the export's `iconPath` and are loaded from gtnhplanner.com in the
  HTML parts of the site view (they can be switched off). They cannot be drawn in 3D: the site sends no CORS
  headers, and WebGL refuses cross-origin images.
- **Block textures**: the site stand-ins and ports have GT5-Unofficial textures too (hazard-striped placeholder
  casing; Super Chest, Super Tank and energy-output fronts on the ports), as do the Assembly Line casing and the
  solenoid coil, which were flat before.
- The **import fixture** (`src/import/__fixtures__/gtnhplanner-titanium.json`) is hand-written to the schema.
  A real Export JSON should be added as a second fixture.
