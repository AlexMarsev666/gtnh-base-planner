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

Generated catalog entries follow GT5-Unofficial **5.09.54.205** (GT:NH 2.9.0-RC-2).
The pinned source lock is [`rc2-source-lock.json`](../game-dump/rc2-source-lock.json).
The audit and reviewed slot/casing generators also verify the actual Java bytes against
[`rc2-source-hashes.json`](rc2-source-hashes.json), covering all 244 controller inheritance chains
and the glass registration helpers. This works for extracted archives without `.git`; a directory
name or a version label cannot make a different checkout pass as RC2.
A sparse, blob-less clone is enough:

```sh
git clone --filter=blob:none --no-checkout --depth 1 --branch 5.09.54.205 \
  https://github.com/GTNewHorizons/GT5-Unofficial.git ../gt5u
git -C ../gt5u sparse-checkout set --no-cone '/src/main/java/' '/src/main/resources/assets/*/lang/en_US.lang'
git -C ../gt5u checkout

node tools/gt-source/machine-types.mjs ../gt5u
node tools/gt-source/audit-rc2.mjs ../gt5u <scratch>/rc2-audit.json <verified-rc2-dump>/multiblocks
node tools/gt-source/constraints-rc2.mjs <scratch>/rc2-audit.json
node tools/gt-source/casings-rc2.mjs ../gt5u <scratch>/rc2-audit.json
node tools/gt-source/fusion-slots-rc2.mjs ../gt5u
node tools/gt-source/cracking-zones-rc2.mjs ../gt5u
node tools/gt-source/tower-slots-rc2.mjs ../gt5u
node tools/gt-source/glass-variants-rc2.mjs ../gt5u
node tools/gt-source/beam-structures-rc2.mjs ../gt5u
node tools/gt-source/accelerator-sections-rc2.mjs ../gt5u
node tools/gt-source/assembly-sections-rc2.mjs ../gt5u
node tools/gt-source/computation-rc2.mjs ../gt5u
```

`audit-rc2.mjs` records all 244 controller sources, hashes, inheritance chains, structural checks,
hatch adders and resource methods. Its optional third argument supplies the verified dump's actual
`source_class` names, needed to distinguish registered nested controllers such as the three Void Miner
variants. `constraints-rc2.mjs` extracts unconditional standard hatch-count
helpers. `casings-rc2.mjs` resolves unconditional minima to the actual blocks incrementing each counter;
unsupported expressions are left pending. Source evidence stays in `constraints.rc2.generated.json`
and `casings.rc2.generated.json`; their smaller runtime companions ship in the browser and worker.
`fusion-slots-rc2.mjs` extracts the source-reviewed injector cells and minimum energy tiers of the
ten fusion controllers. A probe using one LV hatch misses their higher-tier injector filters.
`cracking-zones-rc2.mjs` separates Mega Oil Cracker's middle catalyst inputs from its two reversible
side zones. Its survival hints advertise only one kind on each side; the checked adders accept both
orientations and dispatch catalyst fluids exclusively from the middle.
`tower-slots-rc2.mjs` records Mega Distillation Tower's two output cells per repeated section and
the final output cell, with the source coordinates checked against the RC2 dump. Tower mode has
one to five sections; its separate distillery mode is not represented by the layered binding UI.
`glass-variants-rc2.mjs` reads the eleven canonical BartWorks glass metas and their actual tiers from
the pinned `ItemRegistry` and `GlassTier`, copies their sprites, and records their SHA-256 hashes and
attribution. Reviewed structures can select these variants; other structures retain their catalog glass.
`beam-structures-rc2.mjs` extracts six exact forms for Beam Mirror, Splitter, Stabilizer, Crafter and Source Chamber,
checks the first physical shape against the game dump, and records pinned source hashes. Mirror T2 is
a different topology rather than a repeated slice of T1. The runtime adapter preserves skipped source
cells and assigns the concrete beam input, ordinary output and filtered output blocks and directions.
Source Chamber's single input cell requires either an item bus or fluid hatch; its mandatory output
bus connects below the base. The explicit `requiredHatch` marker separates source-reviewed alternatives
from ambiguous dump placeholders. The joint allocator matches remaining resource assignments to all
mandatory cells before accepting a choice, and fills only the remaining structural requirements.
`accelerator-sections-rc2.mjs` extracts LINAC's base, repeating layer and end directly from pinned source,
checks their nineteen-block assembly against the dump and records the source hash. The smallest complete
form is seventeen blocks; added two-block sections do not repeat the end's mandatory interface. Complete
checked forms extend to 135, while the construction hint offers 19–83. The historical default stays 19.
Native evidence also records RC2's length-128 loop escape: it accepts a prefix without checking an end.
That prefix has no registered output and is not offered as a productive structure. Full LINAC coolant
processing and Source Chamber recipes remain pending.

`assembly-sections-rc2.mjs` verifies that the two pinned Assembly Line controllers share their
FIRST/LATER/LAST topologies. Their checker reads FIRST then LATER and terminates at an Output Bus;
LAST is only a construction hint. The adapter offers complete lengths 2–16, preserves historical
implicit lengths 16/5, and confines output buses to the terminal section for lengths above two. The
two-section checker also accepts FIRST outputs, with up to four buses while retaining maintenance.
Later centres may be
Input Bus or Output Hatch; the terminal centre may also be Output Bus. Up to three terminal buses
are accepted. Default templates still keep an input bus in every section. Native tests confirm
optional Data Access (at most one, outside FIRST), its registered 145/146/147 variants, and all
six orientations for these hatches and ordinary energy. Data Access is editable in both modes;
its three tiers come from pinned registrations, independently of the machine's voltage tier.
Ordered recipe bindings remain pending. Catalog transcription notes remain in the JSON sources for review;
the production client and worker omit that unused prose through the Vite build plugin.

`steam-pump-rc2.mjs` extracts Water Pump's exact shape, uniform Bronze/Steel frame IDs and tiers,
minimum counted casings and the actual custom Steam Hatch registration (31040, ULV, 64000 L).
The adapter restores the missing steam adder, keeps the single output and reserves nine wooden casings.
Known resource IDs use Steam/Water; manual unknown IDs require explicit roles. Native tests verify both
frame variants, structural negatives, all interface facings and actual steam consumption/Water output.
Controlled humidity and dimension inputs test the minimum-output exceptions and Void Protection.

`computation-rc2.mjs` extracts the actual computational hatch registrations and the exact pieces of
Dyson Swarm, Quantum Computer and both QoS switches. Recipe-data connectors remain distinct kinds.
Dyson's `o` command cells allow data input but identical `y` casings do not. Quantum only accepts Rack
in interior slices, not caps. Source checking and native regression evidence establish lengths 4–16
and 2–18 for Quantum/Static respectively, including no interior slice; construction hints start at 5/3.
`checkOneUncertaintyHatch` checks a nonempty list, not an exact maximum of one. Wireless computational
interfaces inherit wired types; native list observations retain the actual generic-adder dispatch.
Packet transport and recipe/resource processing still require their own adapters and native scenarios.

These passes are **partial rule extraction**, not proof that all 244 controller semantics have been
reviewed. Conditional glass/coil tiers, special hatches, alternative structures and recipe-specific
dispatch still need adapters and game verification. See the [implementation status](../../docs/implementation-status-2026-10-07.md).

Four catalog entries still come from the old converter, because the game dump cannot build them (their mods are
not on the dump's dev server): Extreme Entity Crusher, Large Essentia Smeltery, Research Completer and Space
Elevator. Their GT shapes are in `src/data/gt-shapes.generated.json`, checked by `src/data/gt-structures.test.ts`.
