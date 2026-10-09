/** Exact source drawing, registrations and first-match electrode traversal at the RC2 revisions. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const root = process.argv[2];
const source = 'src/main/java/kubatech/tileentity/gregtech/multiblock/MTEIndustrialArcFurnace.java';
const raw = readPinnedSource(root, source);
const clean = stripComments(raw);
const shape = string2D(
  splitArgs(findCalls(clean, 'addShape')[0].args)[1]
    .replace(/^transpose\(/, '')
    .replace(/\)$/, ''),
);
if (
  !shape ||
  shape.length !== 11 ||
  shape.some((layer) => layer.length !== 19 || layer.some((row) => row.length !== 17))
)
  throw new Error('Unsupported Arc Furnace shape');
const lock = JSON.parse(readFileSync('tools/gt-source/structurelib-rc2-hashes.json', 'utf8'));
for (const [name, hash] of Object.entries(lock.files)) {
  const text = readFileSync(`${process.argv[3]}/${name}`, 'utf8');
  if (createHash('sha256').update(text).digest('hex') !== hash)
    throw new Error(`StructureLib source differs: ${name}`);
  if (name.startsWith('StructureDefinition') && !text.includes('builder.append(string).append(B)'))
    throw new Error('Traversal changed');
  if (name.startsWith('StructureUtility') && !text.includes('shape[j][i] = structurePiece[i][j]'))
    throw new Error('Transpose changed');
}
const ids = readPinnedSource(root, 'src/main/java/gregtech/api/enums/MetaTileEntityIDs.java');
const registration = readPinnedSource(root, 'src/main/java/kubatech/loaders/RecipeLoader.java');
const loader = readPinnedSource(root, 'src/main/java/kubatech/loaders/ArcFurnaceLoader.java');
const variants = readPinnedSource(root, 'src/main/java/kubatech/loaders/ArcFurnaceElectrode.java');
const item = readPinnedSource(root, 'src/main/java/kubatech/loaders/item/arcfurnace/ElectrodeItem.java');
const electrode = readPinnedSource(
  root,
  'src/main/java/kubatech/tileentity/gregtech/hatch/MTEHatchElectrode.java',
);
const detector = readPinnedSource(
  root,
  'src/main/java/kubatech/tileentity/gregtech/hatch/MTEHatchElectrodeDetector.java',
);
readPinnedSource(root, 'src/main/java/gregtech/api/interfaces/IHatchElement.java');
if (
  !clean.includes('ElectrodeHatch.or(InputBus)') ||
  !clean.includes('if (electrodeHatch != null) return false;') ||
  !electrode.includes('extends MTEHatchInputBus') ||
  !item.includes('stack.getItem() != this') ||
  !loader.includes('GameRegistry.registerItem(ARC_FURNACE_ELECTRODE, "arc_furnace_electrode")')
)
  throw new Error('Electrode semantics changed');
const hatches = {};
for (const [key, constant, cls, text] of [
  ['electrode', 'ELECTRODE_HATCH', 'MTEHatchElectrode', electrode],
  ['detector', 'ELECTRODE_DETECTOR_HATCH', 'MTEHatchElectrodeDetector', detector],
]) {
  const meta = ids.match(new RegExp(`${constant}\\((\\d+)\\)`))?.[1];
  const name = registration.match(
    new RegExp(`new ${cls}\\(\\s*${constant}\\.ID,\\s*"[^"]+",\\s*"([^"]+)"`),
  )?.[1];
  if (!meta || !name || !text.includes('VoltageIndex.IV'))
    throw new Error(`Missing fixed IV registration: ${cls}`);
  hatches[key] = { meta: Number(meta), name, tier: 'IV' };
}
const electrodes = [...variants.matchAll(/\b(\w+Electrode)\((\d+),/g)].map(([, name, meta]) => ({
  name,
  gameId: `kubatech:arc_furnace_electrode@${meta}`,
}));
if (electrodes.length !== 14) throw new Error('Unexpected electrode variants');
// transpose(shape) is flattened z -> top-down y -> source x; catalogue x is mirrored.
const order = [];
for (let z = 0; z < 19; z++)
  for (let y = 0; y < 11; y++)
    for (let x = 0; x < 17; x++) if (shape[y][z][x] === 'A') order.push([16 - x, 10 - y, z]);
const letters = { A: 'B', B: 'C', C: 'D', D: 'A', E: 'E', F: 'I', G: 'G', H: 'F', I: 'H' };
const layers = shape.toReversed().map((layer) =>
  layer.map((row) =>
    [...row]
      .reverse()
      .map((c) => letters[c] ?? c)
      .join(''),
  ),
);
writeFileSync(
  'src/data/arc-furnace.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      structureLib: lock,
      layers,
      order,
      hatches,
      electrodes,
      minimumCasings: Number(clean.match(/checkCasingMin\(errors, mCasing, (\d+)\)/)?.[1]),
    },
    null,
    2,
  ) + '\n',
);
