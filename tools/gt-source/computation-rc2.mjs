/** Computational hatches and the four reviewed TecTech/Dyson topologies, from pinned RC2 sources. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stringValue, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';
const root = process.argv[2];
const ids = readPinnedSource(root, 'src/main/java/gregtech/api/enums/MetaTileEntityIDs.java');
const loader = stripComments(readPinnedSource(root, 'src/main/java/tectech/loader/thing/MachineLoader.java'));
const registrations = {};
for (const [kind, cls] of Object.entries({
  computationIn: 'MTEHatchDataInput',
  computationOut: 'MTEHatchDataOutput',
  wirelessComputationIn: 'MTEHatchWirelessComputationInput',
  wirelessComputationOut: 'MTEHatchWirelessComputationOutput',
  uncertainty: 'MTEHatchUncertainty',
  computerRack: 'MTEHatchRack',
})) {
  readPinnedSource(root, `src/main/java/tectech/thing/metaTileEntity/hatch/${cls}.java`);
  registrations[kind] = findCalls(loader, cls).map((call) => {
    const args = splitArgs(call.args);
    const meta = ids.match(new RegExp(`\\b${args[0].replace(/\.ID$/, '')}\\((\\d+)\\)`))?.[1];
    const tier = Number(args[3]),
      name = stringValue(args[2]);
    if (!meta || !name || !Number.isInteger(tier)) throw new Error(`Unknown ${cls} registration`);
    return { meta: Number(meta), tier, name };
  });
  if (registrations[kind].length !== (kind === 'uncertainty' ? 2 : 1))
    throw new Error(`Missing ${kind} variants`);
}
readPinnedSource(root, 'src/main/java/tectech/thing/metaTileEntity/hatch/MTEHatchDataConnector.java');
const parent = stripComments(
  readPinnedSource(root, 'src/main/java/tectech/thing/metaTileEntity/multi/base/TTMultiblockBase.java'),
);
if (!parent.includes('if (eUncertainHatches.isEmpty())')) throw new Error('Uncertainty helper changed');
const sources = {};
const read = (path) => {
  const raw = readPinnedSource(root, path);
  sources[path] = createHash('sha256').update(raw).digest('hex');
  return stripComments(raw);
};
const dysonSource = 'src/main/java/gtnhintergalactic/tile/multi/TileEntityDysonSwarm.java';
const dyson = read(dysonSource);
const shape = string2D(
  splitArgs(findCalls(dyson, 'addShape')[0].args)[1]
    .replace(/^(?:StructureUtility\.)?transpose\(/, '')
    .replace(/\)$/, ''),
);
const oldDyson = JSON.parse(readFileSync('src/data/multiblocks/dyson-swarm.json', 'utf8'));
if (
  !shape ||
  shape.length !== oldDyson.size[1] ||
  shape.some((layer) => layer.length !== 16 || layer.some((row) => row.length !== 16))
)
  throw new Error('Dyson shape changed');
const letters = {
  b: 'A',
  c: 'F',
  d: 'P',
  e: 'E',
  f: 'J',
  g: 'O',
  h: 'Q',
  i: 'G',
  j: 'I',
  k: 'K',
  m: 'L',
  o: 'R',
  p: 'H',
  s: 'M',
  t: 'N',
  x: 'B',
  y: 'C',
  z: 'D',
};
const dysonLayers = shape.toReversed().map((layer) =>
  layer.map((row) =>
    [...row]
      .reverse()
      .map((c) => letters[c] ?? c)
      .join(''),
  ),
);
dysonLayers.forEach((layer, y) =>
  layer.forEach((row, z) =>
    [...row].forEach((c, x) => {
      const original = oldDyson.layers[y][z][x];
      if (c === '~' || c === '-' || c === ' ') {
        if (c !== original) throw new Error('Dyson reserved cell mismatch');
      } else if (oldDyson.legend[original]?.blockId !== oldDyson.legend[c === 'R' ? 'C' : c]?.blockId)
        throw new Error(`Dyson source mismatch at ${x},${y},${z}`);
    }),
  ),
);
const quantumSource = 'src/main/java/tectech/thing/metaTileEntity/multi/MTEQuantumComputer.java';
const quantum = read(quantumSource);
const pieces = {};
for (const call of findCalls(quantum, 'addShape')) {
  const args = splitArgs(call.args);
  const piece = string2D(args[1].replace(/^transpose\(/, '').replace(/\)$/, ''));
  if (!piece || piece.length !== 4 || piece.some((layer) => layer.length !== 1 || layer[0].length !== 3))
    throw new Error('Quantum piece changed');
  pieces[stringValue(args[0])] = piece.toReversed().map((layer) => [...layer[0]].reverse().join(''));
}
if (Object.keys(pieces).join() !== 'front,cap,slice,back' || !quantum.includes('totalLen > 17'))
  throw new Error('Quantum range changed');
const weightedSource = 'src/main/java/tectech/thing/metaTileEntity/multi/MTENetworkSwitch.java';
const weighted = read(weightedSource);
const weightedShape = string2D(weighted.match(/return transpose\((new String\[\]\[\][\s\S]*?)\);/)?.[1]);
if (!weightedShape || weightedShape.length !== 3) throw new Error('Weighted switch shape changed');
const weightedLayers = weightedShape
  .toReversed()
  .map((layer) => layer.map((row) => [...row].reverse().join('')));
const staticSource = 'src/main/java/tectech/thing/metaTileEntity/multi/MTENetworkSwitchAdv.java';
const staticSwitch = read(staticSource);
const staticPieces = {};
for (const name of ['FIRST', 'MIDDLE', 'LAST']) {
  const literal = staticSwitch.match(new RegExp(`String\\[\\] ${name} = \\{([\\s\\S]*?)\\};`))?.[1];
  const rows = literal && string2D(`new String[][] { { ${literal} } }`)?.[0];
  if (!rows || rows.length !== 3 || rows.some((row) => row.length !== 3))
    throw new Error(`Static switch piece changed: ${name}`);
  staticPieces[name.toLowerCase()] = rows.toReversed().map((row) => [...row].reverse().join(''));
}
if (!staticSwitch.includes('MAX_LENGTH = 16')) throw new Error('Static switch range changed');
writeFileSync(
  'src/data/computation.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      registrations,
      sources,
      dyson: { source: dysonSource, layers: dysonLayers },
      // checkMachine has no minimum interior-slice count; the final cap also matches a slice.
      quantum: { source: quantumSource, pieces, min: 4, max: 16 },
      weighted: { source: weightedSource, layers: weightedLayers },
      // A LAST piece can immediately follow FIRST; no MIDDLE is required by the checker.
      static: { source: staticSource, pieces: staticPieces, min: 2, max: 18 },
    },
    null,
    2,
  ) + '\n',
);
