/** Water Pump topology and concrete Steam Hatch registration from the pinned RC2 sources. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';
const root = process.argv[2];
for (const path of [
  'src/main/java/gregtech/api/metatileentity/implementations/MTEHatchOutput.java',
  'src/main/java/gregtech/api/recipe/check/SimpleCheckRecipeResult.java',
  'src/main/java/gregtech/api/recipe/check/CheckRecipeResultRegistry.java',
  'src/main/java/gregtech/api/interfaces/tileentity/IVoidable.java',
  'src/main/java/gregtech/api/util/VoidProtectionHelper.java',
])
  readPinnedSource(root, path);
const source = 'src/main/java/gregtech/common/tileentities/machines/multi/steam/MTESteamWaterPump.java';
const raw = readPinnedSource(root, source);
const clean = stripComments(raw);
const parent = readPinnedSource(
  root,
  'src/main/java/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/base/MTESteamMultiBlockBase.java',
);
const registration = stripComments(
  readPinnedSource(
    root,
    'src/main/java/gtPlusPlus/xmod/gregtech/registration/gregtech/GregtechCustomHatches.java',
  ),
);
const ids = readPinnedSource(root, 'src/main/java/gregtech/api/enums/MetaTileEntityIDs.java');
const materials = readPinnedSource(root, 'src/main/java/gregtech/api/enums/MaterialsIDMap.java');
readPinnedSource(
  root,
  'src/main/java/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/base/MTEHatchCustomFluidBase.java',
);
const call = findCalls(clean, 'addShape')[0];
const shape = string2D(
  splitArgs(call.args)[1]
    .replace(/^transpose\(/, '')
    .replace(/\)$/, ''),
);
if (!shape || shape.length !== 3 || shape.some((row) => row.length !== 4 || row.some((s) => s.length !== 3)))
  throw new Error('Unsupported Water Pump shape');
const frames = {};
for (const material of ['Bronze', 'Steel']) {
  const meta = materials.match(new RegExp(`r\\((\\d+), Materials\\.${material}\\)`))?.[1];
  const tier = clean.match(
    new RegExp(`meta == Materials\\.${material}\\.mMetaItemSubID\\) return (\\d+)`),
  )?.[1];
  if (!meta || !tier) throw new Error(`Missing frame ${material}`);
  frames[material.toLowerCase()] = { blockId: `gregtech:gt.blockframes@${meta}`, tier: Number(tier) };
}
const steam = registration.match(
  /new MTEHatchCustomFluidBase\(\s*Materials\.Steam\.getGas\(1\)\s*\.getFluid\(\),\s*(\d+),\s*Hatch_Input_Steam\.ID,\s*"([^"]+)",\s*"([^"]+)",\s*(\d+)\s*\)/,
);
const meta = ids.match(/Hatch_Input_Steam\((\d+)\)/)?.[1];
if (
  !steam ||
  !meta ||
  !parent.includes('mSteamInputFluids.isEmpty()') ||
  !clean.includes('checkOneOutputHatch(errors)')
)
  throw new Error('Steam registration or checker changed');
const minimumCasings = Number(clean.match(/checkCasingMin\(errors, mCountCasing, (\d+)\)/)?.[1]);
if (!minimumCasings) throw new Error('Missing casing minimum');
writeFileSync(
  'src/data/steam-water-pump.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      size: [3, 3, 4],
      layers: shape.toReversed(),
      frames,
      minimumCasings,
      steamHatch: { meta: Number(meta), capacity: Number(steam[1]), name: steam[3], tier: Number(steam[4]) },
    },
    null,
    2,
  ) + '\n',
);
