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

A run takes about ten minutes and dumps 296 controllers. Two fail on client-only classes (the Space Elevator
and the Bose-Einstein Condensate Storage). Machines of mods the dev server does not load (Thaumcraft, Forestry,
Ender IO) cannot be dumped there either: the Extreme Entity Crusher, Large Essentia Smeltery, Research Completer
and the Space Elevator keep the entries the old source converter wrote (see "What is kept" below); the Mega
Industrial Apiary is not in the catalog. The Cleanroom is dumped but left out: its controller sits in the
ceiling with casing on every side, and the planner needs a controller that looks out sideways.

### What `extractor.patch` changes

- GT5-Unofficial `5.09.54.205` and StructureLib `1.4.45` instead of the pinned `5.09.54.20` and `1.4.42`.
- `GTNHExtLib` is left out: Windows Defender quarantines that jar on download. In the pack GTNHLib fetches the
  three libraries it bundles (fastutil, JOML, Brigadier) at run time; the build names them directly.
- The jvmdowngrader stubs GT5-Unofficial 133 and later are built against (`2.0.1`, not GTNHLib's `1.3.5`) go on the run
  class path, and `LaunchClassLoader` loads them untransformed.
- Placed machines get an owner: GT 133 and later track power failures per owner and throw on removing an ownerless one.
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
- An empty cell inside the structure must stay air; the dump cannot tell "air" from "any block" there.
- `*Legacy` controllers (the old versions GT keeps so existing worlds load; they cannot be crafted) are skipped,
  and a machine registered under two ids (the Drone Centre) is listed once.
- Hatch counts come from the controller's tooltip (`.addInputHatch("2", "...", 1, 2, 3)` and its siblings, read by
  [`tools/gt-source/hatch-rules.mjs`](../gt-source/README.md)): `"2"` is min 2 max 2, `"2-11"` min 2 max 11, `"1+"`
  min 1, `"0+"` min 0; lines of one kind add up. A kind that must have a hatch is on by default
  (`defaultHatches`). Where the tooltip has no line for a kind, or no tooltip line is found at all, the old estimate
  stays (energy or dynamo, maintenance and muffler once each when the structure takes them).
- Hatch zones: every hatch cell gets `region: "dot<N>"`, N being the hint dot the hologram shows on it (the dump's
  `hint` value + 1, which is the number the tooltip's lines use). The def's `zones` maps each region to the hatch
  kinds its cells take that the tooltip lists for that dot, and the tooltip lines for it as the game prints them
  (`1+ Energy Hatch: Any casing`). Zones add no `regions` requirements to `requiredHatches`.
- Hand-made entries are never rewritten for this: `build.mjs` writes their zones to
  `src/data/hatch-zones.generated.json` (`{ <id>: { zones, cells: { "x,y,z": "dot<N>" } } }`, in the entry's own
  frame: the dump's north-facing frame rotated so north is the entry's `controller.facing`). An entry is left out
  when the dump's blocks do not sit on its cells or most dump hatch cells are no hatch cell in it, or when the
  machine has no hint dots (the steam machines).
- A class GT renamed keeps its entry and id through `RENAMED_CLASSES` in `build.mjs` (`MTESMDProcessorModule` to
  `MTEPartProcessorModule`, the Part Preparation Apparatus).
- Hand-made entries always win: a controller class a hand-made entry links to in its `source` is not generated.

The dump settles which way StructureLib's first axis runs: to the **right of a controller seen from its front**,
so west (-X) for a controller facing north. Structures read from the sources with that axis pointing east are
mirror images of the game's (the Assembly Line ran the wrong way); `src/data/gt-structures.test.ts` checks the
hand-made entries with the right orientation.

### Textures

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

### Hatch kinds from the source

The dump's hatch kinds come from probing StructureLib's `IHatchElement` lists, which misses custom elements (fusion's
energy injector, steam buses, TecTech multi-amp hatches, `ofHatchAdder(Foo::addClassicToMachineList)`). `build.mjs` adds, to
every hint cell, the kinds that the structure definition's element for that dot accepts
([`hatch-elements.mjs`](../gt-source/README.md), mapping table there). The def's notes say how many cells got kinds this
way. The final report "tooltip kinds no dumped cell accepts" counts the dump and the source together; what stays on it is
a part the dump does not build (the Cleanroom, which is left out anyway).
