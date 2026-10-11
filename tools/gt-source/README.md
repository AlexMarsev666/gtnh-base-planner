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

## Casing minimums and any-input checks

`casing-min.mjs` reads what a controller's structure check demands beyond its hatch counts and patches it into
`src/data/multiblocks/*.json` (also hand-made entries; the class comes from the entry's `source`):

```sh
node tools/gt-source/casing-min.mjs ../gt5u           # report
node tools/gt-source/casing-min.mjs ../gt5u --write   # patch `minCasings` and `requiredAny`
```

`checkCasingMin(errors, counter, min)` becomes `minCasings`: the counter's blocks come from the `onElementPass` /
`if (block == X && meta == N) counter++` that bump it (also through the methods they call), matched to catalog block ids by
registry name and meta; GT counts only the cells of the elements that bump, so when another element of the shapes the
check runs places the same block without counting it (a plain casing beside the hatch casing, as in the Industrial
Compressor), `chars` lists only the legend keys of the same kind (with or without hatches) as the counting element,
and an entry where that cannot be told apart fails the run. `min` is an `int` expression, size-dependent ones anchored
on the tooltip's casing line. `checkHasAnyInput/Output` becomes `requiredAny`, also when it is only called under a
condition (a per-tier loop). Both follow superclasses (large boilers, XL turbines). A minimum or counter it cannot read
fails the run with the class list (`--partial` writes the rest), as does a class that calls `checkCasingMin` but gets no
entry, unless the entry is in `UNWRITTEN` with the reason (Exo Foundry: truncated structure; Nano Forge, PCB Factory:
the check only runs for another tier). It also lists tooltip disagreements and alternatives per structure tier (chosen
by the tier of the entry's casing, then the tooltip, then the largest the structure meets), and `--write` refreshes
`src/data/constraints.snapshot.json`. `tools/game-dump/build.mjs` applies the same code to the entries it writes.

## Hatch elements per hint dot

`hatch-elements.mjs` reads the `.addElement('x', ...)` calls of a controller's structure definition (the nearest class
of its chain that has any) and gives, per hint dot, the hatch kinds the element carrying that dot accepts.
`node tools/gt-source/hatch-elements.mjs ../gt5u <source class>` prints them. `tools/game-dump/build.mjs` adds them to
the dump's kinds of every hint cell (the dump's probe misses custom elements). Same rule for every class:

| Source                                                                                                                                           | Kind                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InputBus`, `InputBus_Steam`                                                                                                                     | itemIn                                                                                                                                           |
| `OutputBus`, `OutputBus_Steam`                                                                                                                   | itemOut                                                                                                                                          |
| `InputHatch`, `SolidifierHatch`, `Cryotheum/PyrotheumHatch`                                                                                      | fluidIn                                                                                                                                          |
| `OutputHatch`                                                                                                                                    | fluidOut                                                                                                                                         |
| `Energy`                                                                                                                                         | energy                                                                                                                                           |
| `Dynamo`                                                                                                                                         | dynamo                                                                                                                                           |
| `ExoticEnergy`, `MultiAmpEnergy`, TecTech `EnergyMulti`, GT++ `TTEnergy`, `ExoticDynamo`, `DynamoMulti`, `TTDynamo`                              | none (multi-amp and laser hatches are not plain Energy / Dynamo Hatches: `addEnergyInputToMachineList`, `addDynamoToMachineList` turn them away) |
| `Maintenance`, `Muffler`                                                                                                                         | maintenance, muffler                                                                                                                             |
| `.hatchClass(MTEHatchInput/InputBus/Output/OutputBus/Energy/Dynamo/Maintenance/Muffler/SteamBusInput/SteamBusOutput.class)`                      | the matching kind                                                                                                                                |
| adder `add{Input,InputBus,InputHatch,Output,OutputBus,OutputHatch,Energy,Dynamo,Maintenance,Muffler}...ToMachineList`, `addSteamBusInput/Output` | the matching kinds                                                                                                                               |
| adder `addToMachineList`, TecTech `addClassicToMachineList` (their bodies switch over every plain hatch class)                                   | itemIn, itemOut, fluidIn, fluidOut, energy, dynamo, maintenance, muffler                                                                         |
| any other adder `Foo::bar` (only when the call names no element)                                                                                 | the hatch classes `bar`'s body tests with `instanceof` (not those it returns false for)                                                          |

Dot sources: `.hint(N)`, `.dot(N)`, `X.newAny(casing, N, ...)`, `ofHatchAdder(adder, casing, N)`, `ofHatchAdderOptional(adder,
casing, N, ...)`. `ofChain(...)` / `buildAndChain(...)` is one cell: first member's dot, kinds of all members. Where several
elements share a dot (Circuit Assembly Line: energy hatch and first input bus are both dot 3), a cell takes the elements whose
kind set contains all the kinds the dump gave it (the smallest set; the union of those tied; none fits: the dump's kinds stay), and a kind-less cell on such a dot gets nothing. Machine-specific elements (data,
laser, beamline, ...) are in no table and give no kind. Not resolved: element lists held in local variables
(`layeredOutputHatch` in the Sparge Tower).
