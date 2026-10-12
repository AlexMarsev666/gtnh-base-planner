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

## Hatch sides, glass tier limits and the data access hatch

`hatch-extras.mjs` reads three more things from the structure definitions and checks and patches them into
`src/data/multiblocks/*.json` (the text is edited in place, so nothing else in a file changes; the class comes from
the entry's `source`):

```sh
node tools/gt-source/hatch-extras.mjs ../gt5u           # report
node tools/gt-source/hatch-extras.mjs ../gt5u --write   # patch the files and src/data/hatch-extras.snapshot.json
```

- `hatch-faces.mjs`: `LegendEntry.allowFaces` from `.allowOnly(ForgeDirection...)`, `.disallowOnly(...)` (the complement) and
  `X.newAny(casingIndex, dot, ForgeDirection...)`. The directions are in the structure's frame, where the controller
  faces NORTH and UP is up, so a def turns them with its `controller.facing` (GT only names EAST and WEST together, so
  the planner's X mirror does not matter). GT only uses them to pick the side its survival auto-placement turns a hatch to (a hint, not a
  structure-check rule: a hatch facing any side still forms the machine), but they say where the slices of the
  structure leave room for one; the planner uses them as the allowed sides. An entry of a zone `dot<N>` takes the elements with that hint dot,
  a hand-made entry the elements of the class; where elements share a dot (the Dangote Distillus's rings and top) an entry keeps the elements whose kinds hold all its
  kinds; per kind the sides are the union of the members that accept it, and one
  unrestricted element leaves the kind unrestricted. What `disallowFaces` already says (its complement) is not repeated; a
  disagreement is listed.
- `glass-tier.mjs`: `MultiblockDef.glassTierLimits`. A `for (T h : <list>)` loop of the class chain that compares the glass
  tier field (the one `chainAllGlasses(-1, (te, t) -> te.glassTier = t, ...)` sets) with `h.getTierForStructure()` /
  `h.mTier` limits the kind of the list (`Energy` in its name: `energy`, `Dynamo`: `dynamo`), and so does
  `glassTier < inputTier` with `inputTier` from `getInputVoltageTier()`. The glass is the legend keys with a block of
  `GlassTier.RegisterGlassTiers` (`addCustomGlass`) or the planner's `gt.glass.reinforced` stand-in; another element placing
  such a block makes the keys ambiguous and fails the run. Other comparisons with the glass tier (a fixed minimum, a
  recipe's voltage, the laser source) are listed as "not modelled".
- `coils.mjs`: `MultiblockDef.coils` and the table of heating coils. The table is every block class that `implements IHeatingCoil`
  (`BlockCasings5`): its `register(N, ...)` metas, the `HeatingCoilLevel` each meta gives (`getCoilHeatFromDamage`), the heat
  (`getHeat`) and the level's lang name; `node tools/gt-source/coils.mjs <checkout> --write` writes `src/data/coils.generated.json`.
  A class has coils when its chain calls `ofCoil(` (or tests `instanceof IHeatingCoil`); the cells are the legend keys with a
  block of the table (or the `gt.coil.cupronickel` stand-in), and another element placing such a block fails the run.
  `hatch-extras.mjs` writes the `coils` field and `src/data/hatch-extras.snapshot.json` lists the ids that carry it.
- `data-access.mjs`: the `dataAccess` hatch kind (`hatch-elements.mjs` knows `DataAccess` / `MTEHatchDataAccess`). The cells
  are the legend keys that already take it, else those of the element's zone, else the key of the casing block the element
  places when that is one key; an entry that cannot be told apart (a hand-made one with a plain grate beside the data one)
  names the cells itself. A key found by its block that also holds plain cells of that block (the first slice's grate
  casing, GT `G`) is split: `shape-fit.mjs` fits the controller's shape into the def (the eight turns and mirrors, anchored
  at the controller) and draws the cells GT covers with an element that takes no hatches with a new legend key. `requiredHatches.dataAccess` is `{ min: 0, max }` with `max` from the `<list>.size() > N` check on
  the list the element's adder fills; `hatchBlocks.dataAccess` is `gt.hatch.dataAccess`.

`tools/game-dump/build.mjs` applies the same code (`withExtras`) to the entries it writes. A local `IHatchElement`
(`IHatchElement<T> layeredOutputHatch = OutputHatch...`) is read through its initialiser by `hatch-elements.mjs`.

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
| `DataAccess` (the Assembly Lines' `DataHatchElement`), `MTEHatchDataAccess`, `addDataAccessToMachineList`                                        | dataAccess                                                                                                                                       |
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

## Orientations

`orientation.mjs` reads the alignment limits of every controller class and patches `variants` (the orientations GT allows,
see the README's data model) into `src/data/multiblocks/*.json` (also hand-made entries; the class comes from the entry's
`source`):

```sh
node tools/gt-source/orientation.mjs ../gt5u           # report
node tools/gt-source/orientation.mjs ../gt5u --write   # patch the files and src/data/orientation.snapshot.json
```

`MTEEnhancedMultiBlockBase.getInitialAlignmentLimits()` is `(d, r, f) -> !f.isVerticallyFliped()`; the nearest
`getAlignmentLimits()` override in the class chain (not `return mLimits`) wins over any `getInitialAlignmentLimits()`.
The expression is read as a lambda over `d` (direction), `r` (rotation, the roll about the facing axis) and `f` (flip):
`d.offsetY == 0`, `d != / == ForgeDirection.X`, `(d.flag & (ForgeDirection.UP.flag | ...)) == 0`, `r.isNotRotated()` /
`isUpsideDown()` / `isClockwise()` / `isCounterClockwise()`, `f.isNotFlipped()` / `isVerticallyFliped()` /
`isHorizontallyFlipped()` / `isBothFlipped()`, with `!`, `&&`, `||`, parentheses; as an `IAlignmentLimits` constant
(`UNLIMITED`, `UPRIGHT`, `NOT_UPSIDE_DOWN`, `FACING_UP`, read from StructureLib 1.4.45's byte code); or as an
`IAlignmentLimits.Builder.allowAll()/denyAll()` chain of `.allow/.deny(ForgeDirection.X | Rotation.X | Flip.X)`. Anything
else fails the run with the class list (`--partial` writes the rest). A literal `return true/false;` in
`isRotationChangeAllowed()` / `isFlipChangeAllowed()` replaces StructureLib's default (some other roll / flip is valid at
the current state); a body that depends on the run time (Forge of the Gods while formed) keeps the default, which is the
right reading for an orientation set before the machine forms, and is listed. The chain walk continues past superclasses written with
nested type parameters (`<T extends Base<T>>`), which `HatchRules.chain` stops at; a container class (`MTEVoidMiners`) is
read through its nested controllers, which must agree.

With the controller facing horizontally, a state (rotation 0 or 180, flip) is the mirror along X (flip horizontal XOR roll 180) and along Y (flip vertical XOR roll 180); that is variant 0 (as built), 1 (X), 2 (both: upside down) or 3 (Y). The
tool replays what a player can set from placement (roll NORMAL, flip NONE): a wrench click on the front is `toolSetRotation(null)`
(when `isRotationChangeAllowed()`: the first state the limits allow for flip offsets 0..3 and roll offsets 1..3, so it can
pass through flipped states), a sneaking click toggles the horizontal flip (when `isFlipChangeAllowed()`), a vertical flip is
never set directly (`MTEEnhancedMultiBlockBase.onWrenchRightClick`, StructureLib 1.4.45 `IAlignment`). It writes the variants
reached; all four reached writes nothing. A controller that can only face up (`d == UP`, the Solar Tower) keeps the vertical
axis: 0 and, when a flip is allowed, 1. Mapping in 5.09.54.205:

| Limits                                                                                                                   | Variants                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| default `!f.isVerticallyFliped()`, `(d, r, f) -> true`, no override                                                      | all                                                                      |
| `d.offsetY == 0 && r.isNotRotated()` (no flip rule), the Exo Foundry and Space Elevator builders, `d != UP && d != DOWN` | 0, 1 (no roll, so no upside down; the wrench never sets a vertical flip) |
| `... && r.isNotRotated() && !f.isVerticallyFliped()` (towers, drills, ...)                                               | 0, 1                                                                     |
| `!r.isUpsideDown() && !f.isVerticallyFliped()` (heat exchangers)                                                         | 0, 1                                                                     |
| `IAlignmentLimits.UPRIGHT` (Coke Oven)                                                                                   | 0, 1                                                                     |
| `d == ForgeDirection.UP` (Solar Tower)                                                                                   | 0, 1                                                                     |
| `f.isNotFlipped()` with the roll allowed (large turbines)                                                                | 0, 2                                                                     |
| `... && r.isNotRotated() && f.isNotFlipped()` (reactors, greenhouse, ...)                                                | 0                                                                        |
