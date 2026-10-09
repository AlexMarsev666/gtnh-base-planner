# Catalog from the game

`build.mjs` builds the generated catalog entries from a dump of the running game instead of reading the Java
sources: every controller in GT5-Unofficial is placed in a world and its `construct()` (what the hologram
projector runs in creative) builds the whole structure, block by block. The result is the structure exactly as
the game builds it, including machines whose shape is computed at run time (Large Hadron Collider, Water
Purification Plant, Nanochip Assembly Complex, Forge of the Gods and its modules, Extreme Industrial Greenhouse,
YOTTank, the Space Elevator modules, ...).

The catalog follows GT5-Unofficial **5.09.54.205** (GT:NH 2.9.0-RC-2).

## 1. Dump the structures

The dump comes from the `gtnh-extractor` Forge mod of
[MrBruh/gtnh-process-line-solver](https://github.com/MrBruh/gtnh-process-line-solver) (Apache-2.0), with the
changes in [`extractor.patch`](extractor.patch) (next section). It boots a headless dev server with
GT5-Unofficial and its dependencies from the GTNH Maven, builds every controller facing north and writes one
JSON file per controller: every placed block, the hologram's hint dots and the hatch kinds each cell accepts.

```sh
git clone https://github.com/MrBruh/gtnh-process-line-solver.git
cd gtnh-process-line-solver
git checkout 19deba995e2bd8d74050aee80653949a0af1ad6f
git apply <this repo>/tools/game-dump/extractor.patch
cd tools/gtnh-extractor

export JAVA_HOME=<a JDK 25>
export GRADLE_USER_HOME=<a disk with ~5 GB free>   # optional
mkdir -p run/server run/conf
printf 'eula=true\n' > run/server/eula.txt
printf 'server-port=25599\nonline-mode=false\n' > run/server.properties

./gradlew setupCIWorkspace
# CoFHCore's dev-time remapper looks for the MCP conf in run/conf:
cp "$GRADLE_USER_HOME"/caches/minecraft/net/minecraftforge/forge/1.7.10-10.13.4.1614-1.7.10/unpacked/conf/packaged.srg \
   "$GRADLE_USER_HOME"/caches/minecraft/de/oceanlabs/mcp/mcp_stable/12/{fields,methods}.csv run/conf/

./gradlew runServer -PdatasetOut=<out>/structures -PpackVersion=2.9.0-RC-2 \
  "-PmodVersions=GT5-Unofficial=5.09.54.205,StructureLib=1.4.45"
```

A verified RC2 run took about fifteen minutes and dumped 296 controllers. Two fail on unavailable classes (the Space Elevator
and the Bose-Einstein Condensate Storage). Machines of mods the dev server does not load (Thaumcraft, Forestry,
Ender IO) cannot be dumped there either: the Extreme Entity Crusher, Large Essentia Smeltery, Research Completer
and the Space Elevator keep the entries the old source converter wrote (see "What is kept" below); the Mega
Industrial Apiary is not in the catalog. The Cleanroom is dumped but left out: its controller sits in the
ceiling with casing on every side, and the planner needs a controller that looks out sideways.

### What `extractor.patch` changes

- GT5-Unofficial `5.09.54.205` instead of the pinned `5.09.54.20`.
- `GTNHExtLib` is left out: Windows Defender quarantines that jar on download. In the pack GTNHLib fetches the
  three libraries it bundles (fastutil, JOML, Brigadier) at run time; the build names them directly.
- StructureLib `1.4.45`, matching RC2.
- The jvmdowngrader stubs GT5-Unofficial 205 is built against (`2.0.1`, not GTNHLib's `1.3.5`) go on the run
  class path, and `LaunchClassLoader` loads them untransformed.
- Placed machines get an owner: GT 205 tracks power failures per owner and throws on removing an ownerless one.
- A headless server (a dev-time folder picker then fails instead of hanging), block display names in the
  texture manifest, and the auto-world harness accepts GT:NH's main menu (both for the client run below).

## 2. Build the catalog

```sh
node tools/game-dump/build.mjs --structures <out>/structures/multiblocks --gt5u ../gt5u \
  --jars <GRADLE_USER_HOME>/caches/modules-2/files-2.1/com.github.GTNewHorizons/GT5-Unofficial/5.09.54.205/*/GT5-Unofficial-5.09.54.205-dev.jar
node tools/game-dump/build.mjs ... --write
npm run atlas
npm run check && npm test
```

### Independent native validation

`construct()` does not establish that a completed machine forms or dispatches resources correctly.
`native-fixtures.mjs` exports the actual planner placements and deliberately invalid variants;
`NativeStructureValidation.java` places them in the extractor's scratch server world and calls the
loaded controller's real `checkMachine`. It also calls Manual Transformer's `checkProcessing`, checks
Mega Oil Cracker's resource filtering and compares Mega Distillation Tower output slots with its
native per-layer hatch lists. No planner validation code is loaded into that JVM.

```sh
node tools/game-dump/native-fixtures.mjs <fixtures.json> <GT5-Unofficial-5.09.54.205-dev.jar> \
  <StructureLib-1.4.45-dev.jar>
node tools/game-dump/install-native-validation.mjs <patched extractor>/tools/gtnh-extractor
cd <patched extractor>/tools/gtnh-extractor
./gradlew runServer -PnativeValidationIn=<fixtures.json> -PnativeValidationOut=<results.json>
# Back in the planner checkout, after a successful native run:
node tools/game-dump/save-native-evidence.mjs <fixtures.json> <results.json>
```

Use absolute input/output paths. The installer adds a separate pass to the pinned extractor and can
be rerun. The native pass verifies SHA-256 of the **actually loaded** GT5U and StructureLib JARs against
the fixture before executing cases. Errors include the native diagnostic ID and serialized payload;
client-only translated strings are never called on the dedicated server. A mismatching expectation
or exception is a failed case, including exceptions in deliberately invalid structures. The JSON is
written before a failing exit, so all discrepancies remain inspectable.

The regression suite contains 1866 cases for 66 controllers: both direct transformer modes at all eight
winding heights, invalid input/output placement, three glass tiers and energy limits on Algae Farm,
both normal and Mega Oil Cracker side orientations with steam/hydrogen and swapped resources, all ten
normal and all five Mega Distillation Tower heights with missing-top-output negatives, and normal
tower vertical outputs and a misplaced input. It also covers all 15 driller-family defaults and missing
resource/low-energy negatives; minimum glass without a standard-energy cap on Component Assembly Line,
Precise Auto-Assembler and TFFT, including TFFT's all-T10 zero-cost exception; conditional output/muffler
counts on all five XL turbines and the splitter's exact coolant-hatch count; all Assembly Line lengths
from 2 to 16 for both controllers with missing mandatory first buses, terminal centre and multiple
outputs (including FIRST outputs on two-section lines), a later-centre fluid output, all six energy faces,
optional EV/LuV/UV Data Access in all six orientations, placements generated by the planner at all three
tiers and lengths 2/5/16, and excess/first-section Data Access negatives; dedicated and ordinary input/output hatches on Extreme
Heat Exchanger, pH Neutralization and Extreme Temperature Fluctuation units, including native field
assignments and swapped resources; and the current Drone Centre form with a missing-input negative.
Both Assembly Lines also accept registered wired and wireless recipe receivers in all six orientations,
with first-section, excess and mixed-receiver negatives. The maximum of one applies to all receiver
classes together. Data Bank covers all six input/output combinations in four horizontal orientations,
missing required interfaces and substitutions into fixed core computer cells. It calls real processing
and observes slave mode and the controller's EU/t field. Fifteen packet cases load a real registered
Assembly Line recipe from a written data stick, wired receiver or wireless store, then call the actual
output and hatch tick methods. They verify clearing stale packets, the controller wireless switch,
direct wired reception with colour/facing negatives, and wireless upload/download with a wrong-owner
negative. The test controls server ticks and uses a unique owner per fixture. This bounded proof does
not cover optical pipe routes, team ownership changes or Assembly Line recipe execution.
Circuit Assembly Line covers lengths 2–7, both directions of growth, four controller orientations,
EV/HV glass, missing required interfaces, and an extra-energy negative. Its right-hand fallback clears
the first branch's EV-glass diagnostic, so the minimum is conditional on growth direction. All six
facings on input/output buses, fluid input, maintenance and energy are accepted by the actual checker;
the builder's side preferences affect survival placement only. Exact FIRST/NEXT/LAST pieces are
regenerated with `node tools/gt-source/circuit-sections-rc2.mjs <GT5U source root>`. Imprint/assembler
processing and the first occupied inventory slot of each bus need separate resource scenarios.
Water Pump adds 70 cases: Bronze/Steel uniform frames, four horizontal controller directions, all six
facings of both interfaces, missing/extra hatches, ordinary fluid input substitution, mixed/unsupported
frames and an occupied skipped interior. Native processing checks 1500 L Steam consumption per 20 ticks,
residual Steam, insufficient/wrong fluid and a full output. Controlled humidity 0.4 produces 600/1200 L Water;
dry Overworld uses the 250 L minimum, while dry Venus/Mercury/Mars/Moon/Nether hit the real zero-output
Void Protection failure. Environment inputs and exact fluid observations are bound to fixture hashes.
This controls humidity/dimension after structure checking; it does not simulate biome changes or a full
world tick cycle. Topology, frame IDs and Steam Hatch 31040 (ULV) are regenerated with
`node tools/gt-source/steam-pump-rc2.mjs <GT5U source root>` from hash-verified sources.
Industrial Arc Furnace adds 405 cases: all 177 allowed steel-casing cells for the operating electrode,
every adjacent pair in the actual StructureLib traversal, four controller rotations, all six faces of
the three electrode roles, missing mandatory interfaces, input/output alternatives, 9/10 counted
casings and uniform/mixed/missing coils. Extra Electrode Hatches enter the ordinary Input Bus list,
while the first dedicated hatch does not satisfy the input requirement. Fourteen registered electrode
items are put in real inventories before checkMachine; observations bind exact registry/meta IDs,
slot acceptance, one-slot/max-stack limits, the controller's selected electrode and detector durability.
An invalid metadata subtype and a different item remain unrecognized operating electrodes. These
cases do not execute ignition, recipe modes, consumption or special electrode effects.
Regenerate the adapter with `node tools/gt-source/arc-furnace-rc2.mjs <GT5U source root> <StructureLib source cache>`;
the cache contains `StructureDefinition-1.4.45.java` and `StructureUtility-1.4.45.java`, whose hashes and
commit are in `tools/gt-source/structurelib-rc2-hashes.json`. The raw generated catalogue stays unchanged.
Computational interfaces add 522 scenarios for Dyson Swarm, Quantum Computer and both QoS switches.
Every permitted service cell in the default source form, forbidden regions (including identical fixed
casings), all six real hatch facings, wired/wireless alternatives and missing interfaces are checked.
Quantum lengths 4–16 and Static Switch lengths 2–18 are checked in four rotations; the checker accepts
zero interior slices even though construction hints start at 5/3. Extra Uncertainty Resolvers are accepted,
and Rack is optional and confined to interior Quantum slices. The observed wireless output enters
`eOutputData`; the Quantum-specific wireless list remains empty due to the earlier generic adder.
This proof covers structure/adders, not packet routing, rack processing, heat or uncertainty resolution.
Regenerate with `node tools/gt-source/computation-rc2.mjs <GT5U source root>` and extract inactive overlays
with `node tools/game-dump/computation-hatch-textures.mjs <RC2-GT5U-dev.jar>`.
Sparge Tower tests include missing first/last outputs, all seven output slots and vertical faces;
Dangote's tower mode covers heights 3–12, missing last outputs, slot order and vertical faces.
The game accepts vertical outputs through these towers' unrestricted `addLayerOutputHatch` fallback,
despite stricter construction hints.
All four Godforge modules are tested with their defaults, all eight standard interface types on the
front disc, and a forbidden rear interface. Exoticizer additionally requires both output types.
The standard EBF, LCR, Multi Smelter and Vacuum Freezer forms include missing-energy and incorrect-inner-block
negatives. Large Heat Exchanger tests verify dedicated native fields, ordinary water/steam interfaces,
swapped resources and its twenty counted titanium casings.
Bricked Blast Furnace uses its actual private boolean `checkMachine` (it does not inherit
`MTEMultiBlockBase`): all four horizontal facings, air/lava cores, a blocked chimney and a wrong brick.
Target Chamber uses the registered LuV Beam Input Hatch (10503), separate mask/ordinary bus lists,
LuV minimum glass and no cap on standard energy tier. Tests cover dedicated field assignments,
swapped resources, each missing mandatory interface and insufficient glass.
Regenerate its front overlay with `node tools/game-dump/beam-hatch-textures.mjs <RC2-GT5U-dev.jar>`;
the compositor checks the jar checksum and uses the inactive source overlay stack.
HTGCR tests cover all five dedicated fluid fields (helium, coolant, water, hot coolant and steam),
missing mandatory fluid/item/energy/maintenance interfaces and swapped resource mappings. Three
adjacent source `e` cells jointly accept helium, maintenance and energy; identical dumped placeholders
for `c`/`w` and `h`/`s` are split into their source regions by the reviewed adapter.
Beam Mirror T1/T2, Splitter, Stabilizer and Crafter use exact pinned source shapes, concrete beam
interfaces and all four horizontal controller orientations. Tests include missing special interfaces,
Crafter's required ordinary interfaces and fluid alternatives, and Splitter's filtered-output type.
Skipped source cells remain free; a filled interior cell in Splitter is accepted by the actual checker.
Native packet forwarding preserves a rate of 120 through either mirror, splits it into four rates of
30, and produces Stabilizer's configured rate of 100. Native block facings and packet rates are observed
and compared independently of formation. Crafter recipes and full beam-network dispatch remain pending.
Cryogenic Freezer and Volcanus use registered locked-fluid hatches 967/968 (fixed IV). Tests cover
their separate native lists, four controller facings, every missing mandatory interface, incorrect
ordinary/opposite coolant types, ordinary fluid alternatives, and the 46/6 casing minima and one below.
Actual `drainCryotheum`/`drainPyrotheum` methods consume 10 from a dedicated hatch while leaving
1000 in the ordinary recipe input. Exact, insufficient and incorrect fluid supplies are checked through
the native hatch fill method and drain helper; this is not a full recipe/onPostTick run.
Source Chamber tests cover item/fluid alternatives in its one input cell, the mandatory bottom output
bus, beam output, air, exact energy/maintenance counts and all four horizontal orientations. LINAC tests
cover complete lengths 17/19/83/85/135 in all four orientations, both mandatory top fluid cells, each beam
interface, air, uniform LuV glass, optional energy with maximum two, and maintenance. Both fluid cells may
use the same type; standard UHV energy remains compatible with LuV glass. A separate positive scenario
records the upstream length-128 loop escape, which accepts a prefix without its end. The planner offers
complete forms only; a stored game-invalid length remains readable and receives a rule error. Its old
nineteen-block default is preserved, and long structures round-trip in plans, sites and links even if
their controller ID later becomes unavailable. The document size cap (256) is separate from game rules.
These scenarios do not establish recipe/coolant dispatch or complete beam-network behavior.
The Freezer source skips its interior cells; a filled interior block is accepted by checkMachine.
Regenerate the stock custom-fluid indicator with
`node tools/game-dump/locked-fluid-hatch-textures.mjs <RC2-GT5U-dev.jar>`.
This is a bounded integration
suite, **not** evidence that all 244 controllers or recipes from all RC2 mods have been validated.

The saved report omits local cache paths and records a SHA-256 of every placement, controller facing,
circuit and optional dedicated-field, block-facing, packet-rate and fluid-drain expectations. Unit tests
regenerate those placements and compare them with the successful native evidence. The publishing command
rejects missing or failed cases, exceptions in negative scenarios, changed placements/circuits and wrong
game JARs. Dedicated-field mappings must account for each expected native field, and their matched or
deliberately mismatched result is checked separately from formation. A placement change requires a new
game run before updating this evidence.

For diagnostic coverage of the whole catalog, pass `--catalog` after the JAR arguments when exporting
fixtures. It attempts each of the 244 entries, records unmapped physical blocks or incomplete exports,
and submits supported placements to `checkMachine`. Its report may have failures and remains diagnostic;
it cannot replace the successful regression evidence. Passing one default placement does not establish
all restrictions, alternate forms, orientations, shared-wall behavior or resource dispatch of a controller.
`node tools/game-dump/save-native-catalog.mjs <catalog-fixtures.json> <catalog-results.json>` records a
separate diagnostic in `catalog-results.rc2.json`, accounting for all 244 IDs without dropping failures,
exceptions or unmapped forms. It refuses stale placements or a report that omits a controller. Both
publishers require the exact development-JAR checksums in `rc2-source-lock.json`, even when the fixture
and loaded report agree on some different JAR. This check supplements the pinned source revision.

`--gt5u` is a GT5-Unofficial checkout at the same tag (see [`tools/gt-source/README.md`](../gt-source/README.md)
for a sparse clone). Without `--write` the script only reports: new and removed entries, blocks without a texture.

With `--write` it replaces:

| File                                      | Contents                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `src/data/multiblocks/<id>.json`          | One `MultiblockDef` per controller, marked `"generated": true`                  |
| `src/data/blocks.generated.json`          | Name and flat colour (the mean colour of its texture) of every block            |
| `tools/game-dump/textures.generated.json` | Block faces and their tiles, merged into the atlas by `scripts/build-atlas.mjs` |
| `tools/texture-sources/DUMP_*.png`        | The face tiles                                                                  |
| `ATTRIBUTION.md`                          | The sprites the tiles are made from, between the `tools/game-dump` markers      |

### Structures

- Block ids are `<registry name>@<meta>` (`gregtech:gt.blockcasings2@0`), so two machines built of the same
  block share the id.
- The first dumped form (trigger stack 1) is the smallest: a variable-size machine is shown at its smallest size.
- Hatch cells come from the hatch kinds each cell's structure element accepts (Input Bus, Output Hatch, Energy,
  ...). A cell that only a machine-specific hatch may fill (data, laser, beamline, ...) shows as a
  "Machine-specific Hatch". A hatch slot or hint with nothing placed and nothing next to it is left out: the
  probe sometimes visits cells outside the structure.
- Reserved StructureLib AIR hints (13) with no placed block remain required air, including openings
  connected to the outside. They never become machine-specific hatches. Other enclosed empty cells
  retain the converter's earlier air fallback; ordinary hint numbers do not establish their semantics.
- `*Legacy` controllers (the old versions GT keeps so existing worlds load; they cannot be crafted) are skipped,
  and a machine registered under two ids (the Drone Centre) is listed once.
- Generated shape defaults place energy or dynamo, maintenance and muffler once each when the structure
  takes them. The runtime overlays source-derived minima and exact maxima from `tools/gt-source`.
  Shape hints alone do not establish count requirements or recipe resource dispatch.
- Hand-made entries always win: a controller class a hand-made entry links to in its `source` is not generated.

The dump settles which way StructureLib's first axis runs: to the **right of a controller seen from its front**,
so west (-X) for a controller facing north. Structures read from the sources with that axis pointing east are
mirror images of the game's (the Assembly Line ran the wrong way); `src/data/gt-structures.test.ts` checks the
hand-made entries with the right orientation.

### Textures

`single-tiers.mjs <GT5U source root>` reads the pinned registration loader and enum to retain only
the three real Data Access variants (145 EV, 146 LuV, 147 UV). `data-access-textures.mjs <RC2 dev JAR>`
verifies the pinned JAR SHA-256 and extracts its Data Access overlay; `npm run atlas` then composites
that overlay with the three hulls. The service hatch defaults to EV independently of machine voltage.

The same generator reads the four fixed recipe-data registrations from the pinned TecTech MachineLoader
and their constructor tiers, rather than tier-like suffixes in registry names. Regenerate the Data Bank
core/service split with `node tools/gt-source/data-bank-rc2.mjs <GT5U source root>`; it checks every cell
against the dumped physical form and writes `src/data/data-bank.rc2.generated.json`. Runtime adapters
apply input/output alternatives without editing the generated catalogue entry. Extract the shared front
with `node tools/game-dump/data-interface-textures.mjs <RC2 dev JAR>` and run `npm run atlas`.

Without a client dump (the extractor's texture pass reads the sprites a client stitched), `static-textures.mjs`
works the faces out from the GT5-Unofficial sources: the block class registered under each registry name and
its `getIcon(side, meta)`, the texture names a block's constructor lists, material blocks (frames, sheetmetal,
storage blocks, BartWorks material casings) from the material's icon set and colour, a few blocks by hand
(`MANUAL`) and controllers as their hatch casing with the front overlay GT's `getTexture` draws. A client
texture manifest can be passed with `--textures <manifest.json>` instead of `--gt5u`.

Each face's layers are tinted and composited into one 16×16 tile (identical tiles are shared). Only
GT5-Unofficial's sprites (LGPL-3.0) go into the atlas: vanilla Minecraft blocks (water, dirt, planks, bricks, ...)
and AE2's quartz lamp keep a flat colour, the mean colour of their texture.

### What is kept

Generated entries whose controller class is not in the dump are left as they are (with the faces and tiles they
had), so a machine the dev server cannot build does not disappear.

## Files

- `build.mjs` - the CLI: structures, blocks, faces, tiles, attribution.
- `static-textures.mjs` - face textures from the sources (a manifest in the client dump's shape).
- `compose.mjs` - tinting and compositing layers into tiles.
- `jars.mjs` - block sprites read from mod jars.
- `extractor.patch` - the changes to the extractor, against gtnh-process-line-solver `19deba9`.
- `textures.generated.json` - generated.
