/** Source segments, not a repeated crop of the hologram's already-assembled default LINAC. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const source = 'src/main/java/gtnhlanth/common/tileentity/MTELINAC.java';
const raw = readPinnedSource(process.argv[2], source);
const blocks = {
  c: 'gtnhlanth:casing.shielded_accelerator@0',
  j: 'gtnhlanth:casing.shielded_accelerator@0',
  g: 'gregtech:gt.blockcasings3@10',
  b: 'bartworks:BW_TieredGlass@0',
  i: 'gregtech:gt.blockmachines@10503',
  o: 'gregtech:gt.blockmachines@10504',
  v: 'gtnhlanth:casing.electrode@0',
  k: 'gtnhlanth:tile.casing.shielded_accelerator_glass@0',
  d: 'gtnhlanth:casing.coolant_delivery@0',
  y: 'gregtech:gt.blockcasings@15',
  h: 'gt.hatch.inputHatch',
};
const segments = {};
for (const call of findCalls(stripComments(raw), 'addShape')) {
  const args = splitArgs(call.args);
  const name = args[0].replace('STRUCTURE_PIECE_', '').toLowerCase();
  const shape = string2D(args[1]);
  if (!shape || !['base', 'layer', 'end'].includes(name)) throw new Error('Unsupported LINAC piece');
  const size = [shape[0][0].length, shape[0].length, shape.length];
  const layers = Array.from({ length: size[1] }, (_, y) =>
    shape.map((rows) => rows[size[1] - 1 - y].split('').reverse().join('')),
  );
  for (const char of layers.flat().join(''))
    if (![' ', '-', '~'].includes(char) && !blocks[char]) throw new Error(`Unknown source cell ${char}`);
  segments[name] = { size, layers };
}
if (Object.keys(segments).join() !== 'base,layer,end') throw new Error('Missing LINAC pieces');
const defaultLayers = segments.base.layers.map((rows, y) => [
  ...rows,
  ...segments.layer.layers[y],
  ...segments.end.layers[y],
]);
const dump = JSON.parse(readFileSync('src/data/multiblocks/linear-accelerator.json', 'utf8'));
defaultLayers.forEach((rows, y) =>
  rows.forEach((row, z) =>
    [...row].forEach((char, x) => {
      const dumped = dump.layers[y][z][x];
      if ([' ', '-', '~'].includes(char)) {
        if (char !== dumped) throw new Error(`LINAC source/dump occupancy differs at ${x},${y},${z}`);
      } else {
        const block = dump.legend[dumped]?.blockId;
        if (block !== blocks[char] && !(block === 'gt.hatch.special' && ['i', 'o'].includes(char)))
          throw new Error(`LINAC source/dump block differs at ${x},${y},${z}`);
      }
    }),
  ),
);
writeFileSync(
  'src/data/linear-accelerator.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      blocks,
      segments,
    },
    null,
    2,
  ) + '\n',
);
console.log('Generated pinned LINAC base (8), repeating layer (2), end (9).');
