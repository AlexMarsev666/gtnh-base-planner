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
  [`tools/game-dump`](tools/game-dump/README.md); they are tagged "From game" in the picker, because they are not
  checked by hand (hatch counts follow the controller's tooltip and structure check). Almost every GT multiblock can share walls in game (structure checks do not claim
  casings).
- **Hatch zones and counts**: hatch placement follows GT5-Unofficial 5.09.54.205. Generated entries carry the
  hatch zones the controller's tooltip names (hint dots) and its hatch counts, and a zone limits which hatch kinds
  may go there. A machine whose hatches do not all fit says so ("hatches don't fit, N wanted and M fit") and how
  many to remove. Hatches also keep the casing minimum of the controller's structure check: no hatch replaces a
  casing the game still needs to count. Existing plans and templates may now warn when a machine asks for
  more hatches than its casing minimum allows.
- **Machine tier and hatch tiers**: Settings → Tier sets the voltage tier of the energy and dynamo hatches, and
  Hatch tiers sets the tier of each hatch separately (only the tiers the game allows; they reset when the layout
  changes). Clicking a hatch block in the 3D view picks that hatch: it is outlined, and a notice offers to open
  Settings on its row in Hatch tiers (already open: the row is emphasised). In a template the group is selected
  and its editor, once open, shows the hatch (kind, resource, the units it serves, its zone, its tier), with the
  Unit and Zone choices of its resource emphasised.
  Escape, or a click on anything else, clears it.
- **Buildability**: Settings → Buildability says whether GT would form each unit as laid out: "Will form", or "Won't form: N problems"
  (also in the stats line). Problems are listed per unit in words (no energy hatch, 14 casings left where GT needs 18 and which
  casing, an energy hatch above the glass); a click selects that unit, and the hatch when the problem names one. Hints are
  listed apart in a quieter colour: GT would turn a hatch away from the side it was put on when placing it itself, but the machine
  still forms. In a template the group editor has the same block, a "Won't form" badge next to the group's name, and Problems
  lists each such group.
- **Glass tier**: machines whose hatches are limited by their tiered glass (for example the Mega Oil Cracker) get a Glass
  choice next to Tier, in Settings and in the group editor. It shows the glass the machine draws ("HV (drawn)") and lets you pick
  another tier; an energy hatch above it is a problem under Buildability. Template changes can be undone like other edits.
- **Heating coil**: machines whose structure takes any heating coil (Electric Blast Furnace, Volcanus, Multi Smelter, Pyrolyse
  Oven, Mega Alloy Blast Smelter, Large Chemical Reactor and so on) get a Heating coil choice, in Settings and in the group
  editor. The first entry is the coil the machine draws ("Cupronickel (drawn)"); picking another one draws every coil of the machine
  with it in the 3D view and the block list. GT forms the machine with any tier as long as all its coils are the same, so no
  heat is shown. Changing the machine drops the choice; template changes can be undone like other edits.
- **Mirror and shared walls**: Mirror builds every machine mirrored left to right (unavailable for machines GT doesn't let
  be mirrored). Shared walls (Auto, Side walls, Stack, Back walls, Separate) is a preference: when it cannot be met another
  layout is used and a notice says which. Where GT allows it the packer may also flip (upside down) or mirror neighbours so
  they share more walls; the bottom line then says how many units are flipped or mirrored, and a single selected unit shows its
  orientation (Mirrored, Upside down, Mirrored vertically).
- **Adjustable sizes** for multiblocks GT builds in variable size: Distillation Tower height (3 to 12) and Assembly Line length (5 to 16).
- **Auto-packing** of N units with optional limits counted in multiblocks (at most N along X, N layers, N along Z); controllers always face outward, and rows that cannot share a back wall get a one-block walkway. Example: 15 Pyrolyse Ovens with X 5, Layers 1, Z 3 give three rows of five. Where the structures allow it, units overlap deeper than one wall, and neighbours are mirrored or turned upside down when the machine's alignment limits permit it and the shapes then fit together (two Steam Separators in one 5x5x5 cube, Industrial Extrusion Machines in a 15x7 facade); the packer only tries the most overlapped spacings it finds valid, and a hatch that does not fit makes it fall back to a looser layout as before.
- **Shared walls**: blocks that coincide in the same cell are counted once; incompatible overlaps are highlighted.
- **Hatches**: enable hatch kinds per plan; shareable hatches serve several controllers from one block. A hatch faces open space rather than a gap between units, and never the ground: the build stands on its lowest layer. Hatches of different kinds are spread apart, and none faces a cell its pipe could not leave. In a shared wall, item, fluid and steam hatches and the muffler (which needs air in front) serve every machine around them; maintenance and energy hatches do so only when asked (next item).
- **Share maintenance / Share energy** (Settings, and in a template group's settings; off by default): a maintenance or energy hatch in a shared wall serves both machines instead of each having its own. GT forms such machines, so these are not errors, but Buildability shows a hint: a manual repair of a shared maintenance hatch fixes only one machine at a time (an auto-maintenance hatch avoids that), and a shared energy hatch gives each machine 1 A of its 2 A, so recipes must stay within 1 A. A shared energy hatch serves at most two machines.
- **Pipe routing** per hatch kind (items, fluids, steam), with length estimates. The kinds are negotiated rather than laid one after another (a cell two networks want gets dearer each round until one gives way), so no network walls in another kind's hatch. With pipes or cables on, a layout whose walkways cannot hold a line per kind is spaced out step by step (walkways and gaps of one or two blocks, same rows and layers) until every hatch is connected; a warning remains only for hatches that still cannot be reached (e.g. in a manual layout). Packing and routing run in the background, so the page stays responsive while a large build is laid out (the stats line says when it is still working, and pipes appear after an unrouted preview). Routing has a fixed work budget, so it never runs for minutes: on a very large build (such as several Nanochip Assembly Complexes) it can stop early and leave a few hatches unconnected, and the warning says so. Bends are priced in, so pipes run in straight trunks with fewer bends than plain shortest paths. A pipe may reach a hatch from any open side (the hatch is turned to face it, as with a wrench in game). With From below (or a template's routing depth) hatches may face down and pipes run in trenches under the build.
- **Cable routing**: the Cables toggle connects energy hatches (and dynamo hatches of generators) with thinner cables, like pipes.
- **Textured view**: real GregTech textures, layered and tinted the way the game draws them (glass is
  see-through, a hatch shows the casing it replaces with its own overlay), flat colours when they cannot load,
  with the build's width and depth measured beside it.
- **Stats line**: units, unique blocks, shared walls, hatches and how many blocks sharing saves.
- **Save and share**: autosave in the browser, JSON download/upload, and share links.
- **Templates** (the TEMPLATE view): several groups of multiblocks on a bounded ground area (30 × 30 by default, up to 256 × 256), joined by
  links that each carry one item, fluid or EU. Every group gets the hatches for the resources it takes or gives (see below), pipes are
  routed between groups and to input/output ports on the template edges, and animated arrows show which way each
  pipe flows. Groups can be arranged automatically along the flow, moved and turned by hand. Pipes are routed
  Classic or Neat, on the ground or up to three layers under it; single-block machines have machine types and
  tiers, and transformers between power tiers are checked. Large templates are
  laid out and routed in the background: the groups appear first, their pipes follow, and the page stays usable.
- **GTNH Planner import**: open a chain exported from [GTNH Planner](https://gtnhplanner.com) (its board's
  Export JSON) and it becomes a template: one group per recipe node, links from its edges, ports for whatever enters
  or leaves the chain.

## How to use

1. Choose a multiblock in the catalog.
2. Set the count and, if needed, the maximum footprint.
3. Set the height or length of a resizable multiblock; toggle hatch kinds in Settings, which also holds
   the tier, Mirror, Shared walls, Share maintenance and Share energy, and Hatch tiers. The chips over the scene
   switch Pipes, Cables, From below (hatches facing down, pipes in a trench under the build) and X-ray.
4. Drag to orbit, scroll or pinch to zoom, right-drag to pan, double-click to reset. Click a block to select its unit.
5. The Share menu in the top bar copies a share link, downloads or opens the plan as JSON, and resets the plan (a second
   click confirms).

The planner checks layout rules for the transcribed structure only. It is not a full in-game build validation.

### Templates

1. Switch to TEMPLATE in the top bar. Use INSPECTOR (top right) to open the template panel. The groups and links list is
   the outline docked at the left (on narrow screens it is the first block of the template panel); the panel at the right is the inspector. With a group selected it shows the group in three tabs: Machine (hatch, machine options, buildability, resources, hatch tiers; the tab shows the number of problems), Packing and Placement, with Duplicate and Remove below. With nothing selected it shows the template: its problems and notes, then the tabs Layout (name, size) and Routing. The tab you last used stays when you select another group.
   The top bar holds Undo and Redo, IMPORT FROM GTNH PLANNER, BLOCKS and the Share menu (copy share link, download or open
   JSON, reset the template; a reset can be undone). The toolbar over the scene has ARRANGE, OPTIMIZE and NEAT, and the
   view chips Pipes, Cables, Flow (the flow animation), X-ray and Icons (item icons).
   An empty template shows a Start a template card over the scene: add a multiblock from the catalog, add the machine open in
   the Machine view, or import from GTNH Planner (also: a single-block machine, a placeholder, or open a JSON file). It goes
   away with the first group. While a group or port is selected, a one-line strip at the bottom left lists the main keys
   (drag to move, arrows to nudge, R to turn, or A to auto place a port); its ? button opens the full list of shortcuts.
2. Import a chain (IMPORT FROM GTNH PLANNER), or build one by hand: + ADD in the outline's Groups heading opens a menu
   (Add multiblock, Add single-block machine, Add placeholder; Escape or a click elsewhere closes it, the arrow keys
   move through it). A group that GT would not form shows a badge with its number of problems. + LINK in the Links
   heading opens the new link form at the top of the panel, with a start (a group or TEMPLATE INPUT), an end (a group
   or TEMPLATE OUTPUT) and a resource; the link you add is selected. Click a link in the outline to select it: its
   resource is isolated (the other nets fade) and the panel shows the link with its colour, a Remove link button, and
   its ends and rate; click it again, or press Escape, to let go. In the single-machine view, SETTINGS →
   ADD TO TEMPLATE copies the current plan into the template as a group.
3. ARRANGE (in the toolbar over the scene) lays the groups out west to east along the flow, turning each so its input hatches face upstream and its output
   hatches downstream (OPTIMIZE turns groups too, by where their hatches are). NEAT does that and switches to neat routing, at least
   one layer under the ground, as one undo step (the layout and the routing come back together). OPTIMIZE arranges,
   then searches for a tighter layout with shorter pipes in the background: simulated annealing on a cheap length
   estimate finds candidates, then a second pass judges every step by the real router. It may also pack a group of
   several units another way (rows or layers, which sets the group's limits), and says how many it changed. It can also stand
   two groups flush, sharing one wall, when their facing walls are the same casing (no hatch is placed in such a wall, and a
   group set to Separate never shares; the shared block is built once, and the stats line says how many blocks shared
   walls save); ARRANGE keeps the corridor between groups. A
   result is kept only if it beats the current layout (fewer problems, then more connected, then fewer pipe
   blocks less the blocks shared walls save, then a smaller footprint); when nothing does, nothing changes and the notice says so. The search is repeatable: its work is counted in
   iterations that grow with the size of the template, not in time, and its random numbers come from the
   template's seed, so the same template and seed give the same result. Only a safety limit of a minute can cut it
   short ("stopped at the time limit"). While Arrange, Neat or Optimize runs a progress bar names the phase and
   Cancel stops it: the template and its undo history stay as they were. Editing the template meanwhile stops it
   too (a notice says so), so a late result is never applied to a changed template. A group's limits can be kept
   in its settings (editing them keeps them): Arrange and Optimize never change those. Closing the import dialog
   stops an import in progress.
   Select a group (click it, or pick it in the panel)
   and drag it in the view, or move it with the arrow keys as seen on screen (Shift: 5 blocks) or the arrows in
   the panel; PageUp and PageDown raise and lower it (Shift: 5 blocks), R turns it (Shift+R back), F frames it
   and Delete removes it. The panel edits the selected group: its label and machine, count, limits and extra
   hatches, and X, Z and height to place it exactly. Template inputs and outputs (the chests, tanks and energy
   blocks on the edge) move the same way: click one, then drag it or use the arrows; A gives it back to
   automatic placement. Ports stand on the ground, so they have no height. Ctrl+Z (or the Undo button in the top bar) undoes any
   change to the template (Ctrl+Shift+Z or Ctrl+Y, or Redo, redoes it). Moving a group past an edge grows the template
   that way (and ARRANGE grows it when the chain does not fit). While you move or turn groups the pipes wait,
   shown faded, and are routed again a moment after you stop.
   The panel's Routing block sets the router (Classic or Neat) and how deep pipes may go under the ground (0 to 3;
   a very big template may be routed shallower, and the panel says so), and shows the route: blocks routed, bends,
   blocks per underground level and, on the ground, trunk lines against stubs at hatches. X-ray (a chip in the toolbar) sees through the
   ground. The Floor setting (None by default; Light Concrete, a few machine casings or iron) lays one layer of that
   block under the whole template at y = -1 for the machines to stand on (groups raised off the ground are
   unaffected). With a floor, pipes and cables that go under the ground cross it only straight down or up, each
   crossing a hole where the pipe block replaces the floor block, and the trench starts below it (a hatch facing down
   reaches the floor layer; the levels reported are those below the floor, so depth 2 shows 2; depth 0 keeps everything above, so the floor has no holes). The floor shows see-through
   while something runs under it, and the Blocks panel lists its blocks (width x depth less the holes). A template without a floor
   is unchanged. A template saved before the Routing block existed keeps its old routing (classic, following the machine
   view's From below) and offers Use neat routing; old files and links load unchanged. The selected group also
   has a tier (its energy hatches; a transformer's high side), Mirror, a shared-walls choice, Share maintenance and Share energy, Quadruple input hatches (on by default; off gives every fluid its own regular input hatch, shown only for machines with fluid inputs; stored in the template only when off), a Resources list
   (put a resource's hatch on one unit, on all units, or into a hatch zone of the multiblock; Auto spreads them;
   the Zone list offers only zones with a place for that hatch kind, and a saved zone without one is reported and ignored)
   and the tier of each of its hatches. A bus holds several items and an input hatch from EV several fluids, so a unit gets
   as few of them as fit its resources: an item bus has (tier + 1)² slots (LV 4, MV 9, HV 16, ... UHV 100), and the
   Quadruple Input Hatch (fluid input, EV and up) holds four fluids; below EV one fluid per input hatch, and
   every output hatch holds one fluid. Item buses and fluid input hatches now take the group's tier unless their
   own entry in Hatch tiers says otherwise (the bill of materials of older templates shows their tier too, and
   their hatch layout is recomputed with fewer buses); a bus that holds several items is set by the entry of
   its first resource. Several pipes may end at one bus: they all enter through its front, sharing only the
   block in front of it. A single-block machine picks its machine type from a searchable list and
   its tier; a transformer also has a direction and a low-side amperage (4 A, 16 A Hi-Amp or 64 A Power, from an LV high side up). A link
   whose voltage does not match the tier a machine takes, or a transformer GT does not make, is reported under
   PROBLEMS. PROBLEMS lists what could not be met; Notes
   lists what the build did on its own (spread resources, a wall-sharing fallback) and is not a problem.
4. Click a pipe, a legend entry or a link in the outline to highlight one resource; the other nets fade. The bottom line shows the
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
back). ARRANGE, NEAT and OPTIMIZE stay in the toolbar over the scene for later. Storages between machines are passed
through; product drains become output ports, trash drains void ports. Thaumcraft aspect flows are left out.
Odd values in an export do not stop the import: control characters in names are replaced, machine counts are
clamped and impossible rates are dropped, and the dialog says how many values were adjusted.

## Data model

Each multiblock is one JSON file in [`src/data/multiblocks/`](src/data/multiblocks/), typed as `MultiblockDef` in [`src/model/multiblock/types.ts`](src/model/multiblock/types.ts). Files are picked up at build time; there is no registry to edit.

| Field                | Meaning                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `id`, `name`, `tier` | Stable id (used in saved plans and links), display name, short tag such as `Steam` or `LV`.    |
| `source`             | Link to the GT5-Unofficial source the structure was transcribed from.                          |
| `size`               | `[x, y, z]` in blocks.                                                                         |
| `layers`             | `layers[y][z]` is a string of length `x`. `~` controller, `-` must be air, space = not part.   |
| `legend`             | Every char: `{ blockId, hatches?, allowFaces? }`; `hatches` lists kinds that may replace it.   |
| `controller`         | `{ pos, facing, blockId }`; `pos` is the `~` cell, `facing` the front face (local frame).      |
| `hatchBlocks`        | Block id placed for each hatch kind.                                                           |
| `shareableHatches`   | Hatch kinds whose single block may serve several controllers (the muffler always may).         |
| `requiredHatches`    | Optional `{ min, max, regions?, perSlab? }` per hatch kind and unit, see below.                |
| `requiredAny`        | Optional `{ kinds, min }[]`: at least `min` hatches of any of `kinds` (GT's any input/output). |
| `minCasings`         | Optional `{ chars, min, perSlab? }[]`: at least `min` cells of those legend keys stay casing.  |
| `coils`              | Optional `{ chars }`: the legend keys of the heating coil (any tier forms; see below).         |
| `glassTierLimits`    | Optional `{ chars, kinds }`: hatches of `kinds` stay at or below the tier of the glass.        |
| `defaultHatches`     | Hatch kinds enabled in a new plan.                                                             |
| `variants`           | Optional `(0                                                                                   | 1   | 2   | 3)[]`: the orientations GT allows, when not all four, see below. |
| `wallshare`          | Whether casings of two units may overlap when the blocks match.                                |
| `resize`             | Optional variable size: `{ axis, from, to, min, max, default, label }`, see below.             |
| `zones`              | Optional hatch zones by legend `region` (`dot<N>`): the kinds meant for it and its tooltip.    |
| `notes`              | Free-text notes: game version, quirks, hatch behaviour.                                        |

Coordinates follow Minecraft: X = east, Y = up, Z = south.

**Saved plans and links.** A plan or template may also carry a tier, mirror, a shared-walls preference, shared maintenance and energy hatches, hatch
tiers, per-resource hatch assignments (unit, all units or zone), a routing style and depth, a floor block, and an optimize seed.
Each is optional: files and links saved before they existed decode exactly as before and are never rearranged on
opening.

**Variable size.** A multiblock that GT builds in several sizes stores its smallest form (`size[axis] === min`)
with one copy of a repeating slab `[from, to)` along `axis`. A plan's height or length inserts more copies after
it (`sizedDef` in [`src/model/resize.ts`](src/model/resize.ts)). A slab cell whose `region` a
`requiredHatches.*.regions` names gets one numbered region per copy (`layer` → `layer1`, `layer2`, …) and the requirement
grows to match, so the Distillation Tower keeps one output hatch per layer; any other region (the hatch zones of
generated entries, `dot<N>`) keeps its name in every copy, so its zone covers them all. Generated entries get their
rule from the dump's forms (see [`tools/game-dump/`](tools/game-dump/README.md)). A requirement of a resizable def may carry `perSlab`: its
`min` and `max` are the smallest form's and each added slab raises both by `perSlab` (an Advanced Assembly Line's input
bus per slice; `sizedDef` states them for its own size). Never change `default`: plans without a size use it.

**Casing minimums and hatch groups.** GT refuses to form a multiblock whose structure check fails, so the data
states two of its checks (read from the controller classes by [`tools/gt-source/casing-min.mjs`](tools/gt-source/README.md)):
`minCasings` is `checkCasingMin`, at least `min` cells drawn with the listed legend keys (together) must be casing, so
hatches may replace only the rest; for a resizable def `min` is the smallest form's and `perSlab` what each added slab
raises it by (`sizedDef` returns the minimum of its size). `requiredAny` is `checkHasAnyInput` / `checkHasAnyOutput`:
at least one hatch of any of `kinds` (`itemIn` or `fluidIn`, `itemOut` or `fluidOut`), stated only when no kind of the
group is already in `requiredHatches`. Both are validated (keys in the legend, the structure holds `min` cells).
Hatch placement honours them: a hatch never goes where it would leave a unit below a casing minimum (a hatch in a
wall shared by units takes a casing from each of them; the mandatory hatches are placed first, and one that finds
cells but no room is reported with the reason `casings`), the room counts in the "hatches don't fit" summary, and
the `requiredAny` hatch is placed of the first enabled kind of its group. `checkValidity` (`src/model/validity.ts`)
then lists per unit what the game's structure check would still object to (missing energy or maintenance,
`requiredHatches` or `requiredAny` unmet, casings under the minimum, a hatch above the glass tier) as `error`s, plus `hint`s for what GT still forms but would not recommend (a hatch on a
side its legend hints against, or outside its `allowFaces`: GT does not check hatch facing; a maintenance or energy hatch shared by units); Buildability lists them.

**Hatch sides, glass tier and the data access hatch.** Three more things GT's structure definitions and checks say
about hatches, read by [`tools/gt-source/hatch-extras.mjs`](tools/gt-source/README.md) for every controller class (also for
hand-made entries) and validated like the rest. A legend entry's `allowFaces` is
`{ kind: sides[] }`, the only sides (local frame, so `north` is the front of a controller facing north) GT's
auto-placement turns a hatch of that kind to there, from `.allowOnly(...)` / `.disallowOnly(...)`: the Assembly Line's
input and maintenance hatches `down`, its data access hatch `north`. These are hints of GT's survival hologram, not rules
of the structure check (a hatch facing any side still forms the machine). A kind that is not listed has no limit, a side
is open when it is in `allowFaces` and not in `disallowFaces` (which already says the same for older entries, and is not
repeated). Placement turns a hatch to an open side when it can (`disallowFaces` is a hard rule there, `allowFaces` a
preference: an Assembly Line's floor casings only allow `down`, which is the ground unless connections from below are
on, so the hatch faces another side and the validity check gives a hint). Pipe routing turns a hatch to the side its
pipe reaches it from (never one `disallowFaces` forbids), so it may end up outside `allowFaces`; the hint then says so.
A lowest-layer cell walled in on every side but the ground (the Advanced Assembly Line's input buses, the Synchrotron's
output hatches) still takes a hatch of a kind the machine requires (`requiredHatches` min) when a single machine has too
few other cells for it, facing down: GT does not ask a hatch for a free face. These cells are used only after the normal
ones and only up to the minimum (a crowded layout is loosened instead), and a hint tells
the hatch faces the ground and must be fed from below (From below, or a template's routing depth). Without a
trench such a hatch is simply left unconnected by routing.
`variants` lists the orientations the controller's alignment limits allow (`getInitialAlignmentLimits` / `getAlignmentLimits`
of the class and its superclasses, `tools/gt-source/orientation.mjs`): 0 as in the catalog, 1 mirrored left-right, 2 upside down
(a roll of 180 degrees about the facing axis, which is a mirror along X and along Y), 3 mirrored top-bottom; the controller keeps
facing horizontally. A player sets them with the wrench (roll, horizontal flip; never a vertical flip directly), so a machine that
allows no roll reaches only 0 and 1. An absent field allows all four (GT's default `!f.isVerticallyFliped()` reaches them through the roll). It
is a list because GT has sets that are no product of two flags: the large turbines (`f.isNotFlipped()`, roll allowed) are `[0, 2]`.
Upright-only machines (Coke Oven, drilling rigs, distillation towers, air filters, fishing port) are `[0, 1]`; machines that allow
neither roll nor flip (Bricked Blast Furnace, Windmill, Extreme Industrial Greenhouse, the two reactors) are `[0]`.
A unit carries its own variant (`Unit.variant`, 1 to 3, absent = 0; in the plan JSON `manualUnits[i].variant`, in a `#p=` link the unit's rotation slot holds `rotation + 4 * variant`), relative to the def the model is given: a mirrored plan hands it the mirrored def, so the variant composes on top of the mirror. A unit in a variant `variants` does not list (counting the plan mirror) gets an `orientation` error in the buildability check. The packer does not choose variants yet; manual units can have any.
`glassTierLimits` is a multiblock's `chainAllGlasses` check, `glassTier < hatch.getTierForStructure()`: the `kinds`
(`energy`) may not be of a higher voltage tier than the glass in `chars`. The planner compares the hatch's tier (the
machine tier, or the hatch's own entry in Hatch tiers) with the glass tier: the `glassTier` of the plan or template group
(optional, saved as `glassTier` in plan and template JSON and as `g` in a machine plan link, so old plans and links open
unchanged), or when it is not set the tier of the glass the multiblock draws at `chars` (`src/data/glass-tiers.ts`,
from GT's `GlassTier.RegisterGlassTiers`: the Borosilicate series `bartworks:BW_TieredGlass@0..10` is HV to UXV). A hatch
above it is a `glassTier` error from `checkValidity`; a glass with no known tier (the planner's own
`gt.glass.reinforced` stand-in) sets no limit. The Glass picker sets it. `dataAccess` is the Data Access Hatch of the
Assembly Lines (GT's `DataHatchElement.DataAccess`), a hatch kind like the others: on the grate casings of the later slices,
none required and at most one (`requiredHatches`, from `al_too_many_data_access_hatch`). It is the last of the hatch kinds
(bit 9 of a link's hatch mask), so links made before it decode as they did.

**Heating coils.** A structure with GT's `ofCoil(...)` element (or its own `instanceof IHeatingCoil` check, the Large
Chemical Reactor) forms with any coil tier as long as all its coils are the same. `coils.chars` names the legend keys that
hold the coil (a block of the table or the `gt.coil.cupronickel` stand-in of a hand-made entry), read by
[`tools/gt-source/coils.mjs`](tools/gt-source/README.md) / `hatch-extras.mjs` from the class (fixed coil casings such as
`Casings.ElectrumFluxCoilBlock` are not coils in this sense). The table of coils is `src/data/coils.generated.json`
(`HeatingCoilLevel` and the `BlockCasings5` metas; `src/data/coils.ts`, with the heat as data only). The `coil` of a plan or template
group (an id of the table such as `kanthal`; saved as `coil` in plan and template JSON and as `o`, the table index, in a machine plan link, so old
plans and links open unchanged) makes `withCoil` (`src/model/coil.ts`) draw those keys with the coil's block; walls compare blocks,
so units with the same coil still share walls. A plan or group with a coil for a machine that has none ignores it.

**Adding a multiblock**

1. Add `src/data/multiblocks/<id>.json` (see [`coke-oven.json`](src/data/multiblocks/coke-oven.json)).
2. Register any new block ids in [`src/data/blocks.ts`](src/data/blocks.ts) with a flat colour, and map them to textures in [`src/render/textures.json`](src/render/textures.json).
3. Run `npm run check && npm test`, then check the new entry in `npm run dev`.

Structures can be transcribed by hand from the GT5-Unofficial source. Entries marked `"generated": true` are built from a dump of the running game by [`tools/game-dump`](tools/game-dump/README.md); do not edit them by hand. To take one over, remove `generated` and edit it: the build never overwrites a class that a hand-made entry covers. StructureLib shapes read from the sources must be mirrored in X: the first axis of a shape runs to the right of a controller seen from its front, which is west for a controller facing north.

## Textures and attribution

DETAILED view uses block textures from [GT5-Unofficial](https://github.com/GTNewHorizons/GT5-Unofficial), licensed under LGPL-3.0. The generated atlas is `public/textures/atlas.png`; its source files (build inputs, not deployed) are in `tools/texture-sources/` (`DUMP_*.png` are GT sprites layered and tinted the way the game draws a block face, see [`tools/game-dump`](tools/game-dump/README.md)). Vanilla Minecraft blocks keep flat colours: their textures are not LGPL. Sources and licence details are in [`ATTRIBUTION.md`](ATTRIBUTION.md). SIMPLE view uses flat colours only.

## Privacy

There is no server, account or tracking. Plans are stored in your browser's `localStorage`. A share link carries the compressed plan in the URL fragment (`#p=...`, or `#s=...` for a template); browsers never send the fragment to the server, so the host only sees a request for the page. Following a link while the planner is already open (only the fragment changes) opens it the same way as at startup, asking first when it would replace a plan or template you have edited. A saved plan or template that can no longer be read (for example after an update removed a multiblock) is never overwritten: a copy is kept in the browser (the newest three), autosave pauses for it, and a notice offers Download copy, Try again and Start new. A template that names a multiblock the catalog no longer has still opens: those groups become placeholders labelled `Missing: <id>` (positions and links stay), a notice says how many, and a stored template's original text is kept as a backup first. Renamed multiblocks are mapped to their new id in [`src/data/multiblock-aliases.ts`](src/data/multiblock-aliases.ts) so old plans, templates and links keep loading; a plan with an unknown multiblock is still refused.

The GTNH Planner import reads the file you open or paste in the browser; the file itself is never sent anywhere.
Exports carry an icon path for each item and fluid, and the template view shows those icons (legend, link list,
import dialog) by loading the images from gtnhplanner.com, without a referrer. Turn off the **Icons** chip in the template
toolbar to show colour swatches instead; then the page loads nothing from other sites. Only `/datasets/...png` paths
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
