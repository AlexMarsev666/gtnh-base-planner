/** Preserve the fixed computer core separately from the Data Bank's service interface cells. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';
const source = 'src/main/java/tectech/thing/metaTileEntity/multi/MTEDataBank.java';
const raw = readPinnedSource(process.argv[2], source);
readPinnedSource(
  process.argv[2],
  'src/main/java/tectech/thing/metaTileEntity/multi/base/TTMultiblockBase.java',
);
const calls = findCalls(stripComments(raw), 'addShape');
if (calls.length !== 1) throw new Error('Expected Data Bank main form');
const args = splitArgs(calls[0].args);
const shape = string2D(args[1].replace(/^transpose\(/, '').replace(/\)$/, ''));
if (
  !shape ||
  shape.length !== 3 ||
  shape.some((rows) => rows.length !== 3 || rows.some((r) => r.length !== 5))
)
  throw new Error('Unsupported Data Bank frame');
const layers = shape.toReversed();
const blocks = {
  A: 'tectech:gt.blockcasingsTT@1',
  B: 'tectech:gt.blockcasingsTT@2',
  C: 'tectech:gt.blockcasingsTT@0',
  D: 'tectech:gt.blockcasingsTT@1',
};
const dump = JSON.parse(readFileSync('src/data/multiblocks/data-bank.json', 'utf8'));
layers.forEach((rows, y) =>
  rows.forEach((row, z) =>
    [...row].forEach((char, x) => {
      const old = dump.layers[y][z][x];
      if (char === '~' ? old !== char : dump.legend[old]?.blockId !== blocks[char])
        throw new Error(`Data Bank dump/source mismatch at ${x},${y},${z}`);
    }),
  ),
);
writeFileSync(
  'src/data/data-bank.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      size: [5, 3, 3],
      controllerPos: [2, 1, 0],
      layers,
      blocks,
    },
    null,
    2,
  ) + '\n',
);
