# GT source reader

Reads the [GT5-Unofficial](https://github.com/GTNewHorizons/GT5-Unofficial) Java sources without compiling them.
The catalog itself is built from a dump of the running game (see [`tools/game-dump/`](../game-dump/README.md));
this code is what is left of the older converter that read the structures from the sources:

- `registry.mjs` indexes a checkout (block classes and their `getIcon`, icon fields, lang files, materials,
  controller names and front overlays). `tools/game-dump/static-textures.mjs` uses it to find the texture of
  every dumped block when no client texture dump is at hand.
- `java.mjs` holds the small Java text helpers it needs (comments, calls, argument lists, method bodies).
- `machine-types.mjs` writes `src/data/gt-machine-types.generated.json`: the machine types GT names in each
  catalog multiblock's tooltip, so the GTNH Planner import can find a multiblock by them.
- `hatch-rules.mjs` reads the hatch lines of every controller's `MultiblockTooltipBuilder`
  (`addInputBus`, `addOutputHatch`, `addEnergyHatch`, `addMaintenanceHatch`, ..., `addMiscHatch`): count string,
  description and hint dots. `tools/game-dump/build.mjs` turns them into `requiredHatches` and hatch zones.
  `node tools/gt-source/hatch-rules.mjs ../gt5u <dump>/multiblocks` lists the controllers with no hatch line
  (Bricked Blast Furnace, Entropic Processor, PCB Bio Chamber in 5.09.54.205).

The tooltip's dot number is the dump's `hint` value plus one: `hatch.hint(2)` in a structure definition shows
dot 2, `"hint": 1` in the dump, and `.addInputHatch("2", "...", 1, 2, 3)` names dots 1 to 3
(`MultiblockTooltipBuilder.toolTipFinisher`: "e.getKey() - 1 because 1 hint is meta 0"). Checked on the Oil Cracker
(middle `hint(1)` is hint 0, left `hint(2)` is hint 1, right `hint(3)` is hint 2); the air hint is 13. The reader finds
a class's hatch lines in the class itself, else in its superclass chain (a nested controller extends its outer
class), and resolves string arguments from literals, `translateToLocal` keys of the English lang file, String
fields and zero-argument String methods (`anyCasingText()`); text it cannot resolve (a tier read at run time) is
left out and the dots and count are kept.

The catalog follows GT5-Unofficial **5.09.54.205** (GT:NH 2.9.0-RC-2, StructureLib 1.4.45). A sparse, blob-less
clone is enough:

```sh
git clone --filter=blob:none --no-checkout --depth 1 --branch 5.09.54.205 \
  https://github.com/GTNewHorizons/GT5-Unofficial.git ../gt5u
git -C ../gt5u sparse-checkout set --no-cone '/src/main/java/' '/src/main/resources/assets/*/lang/en_US.lang'
git -C ../gt5u checkout

node tools/gt-source/machine-types.mjs ../gt5u
```

Four catalog entries still come from the old converter, because the game dump cannot build them (their mods are
not on the dump's dev server): Extreme Entity Crusher, Large Essentia Smeltery, Research Completer and Space
Elevator. Their GT shapes are in `src/data/gt-shapes.generated.json`, checked by `src/data/gt-structures.test.ts`.
