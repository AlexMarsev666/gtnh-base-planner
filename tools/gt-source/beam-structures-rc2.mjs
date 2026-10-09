/** Exact beam structures, including Mirror's topology-changing second form. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const root = process.argv[2];
if (!root) throw new Error('Expected pinned GT5U checkout.');
const entries = {};
for (const [id, name] of [
  ['beam-mirror', 'MTEBeamMirror'],
  ['beam-splitter', 'MTEBeamSplitter'],
  ['beam-stabilizer', 'MTEBeamStabilizer'],
  ['beam-crafter', 'MTEBeamCrafter'],
  ['source-chamber', 'MTESourceChamber'],
]) {
  const source = `src/main/java/${id === 'source-chamber' ? 'gtnhlanth/common/tileentity' : 'gregtech/common/tileentities/machines/multi/beamcrafting'}/${name}.java`;
  const raw = readPinnedSource(root, source);
  const dump = JSON.parse(readFileSync(`src/data/multiblocks/${id}.json`, 'utf8'));
  const forms = findCalls(stripComments(raw), 'addShape').map((call) => {
    const shape = string2D(splitArgs(call.args)[1]);
    if (!shape) throw new Error(`Unsupported source shape ${id}`);
    const width = shape[0][0].length,
      height = shape[0].length,
      depth = shape.length;
    const layers = Array.from({ length: height }, (_, y) =>
      shape.map((rows) => rows[height - 1 - y].split('').reverse().join('')),
    );
    const blocks =
      id === 'source-chamber'
        ? {
            c: 'gtnhlanth:casing.shielded_accelerator@0',
            d: 'gtnhlanth:casing.shielded_accelerator@0',
            k: 'gtnhlanth:tile.casing.shielded_accelerator_glass@0',
            e: 'gtnhlanth:casing.electrode@0',
            i: 'gt.hatch.inputBus',
            o: 'gt.hatch.outputBus',
            b: 'gregtech:gt.blockmachines@10504',
          }
        : {
            A: 'bartworks:BW_TieredGlass@0',
            B: 'gtnhlanth:casing.shielded_accelerator@0',
            C: 'gregtech:gt.blockmachines@10503',
            D:
              id === 'beam-crafter'
                ? 'gregtech:gt.blockcasings3@10'
                : `gregtech:gt.blockmachines@${id === 'beam-splitter' ? 3014 : 10504}`,
            ...(id !== 'beam-crafter' ? { E: 'gregtech:gt.blockcasings3@10' } : {}),
          };
    let controllerPos;
    layers.forEach((layer, y) =>
      layer.forEach((row, z) =>
        [...row].forEach((char, x) => {
          if (char === '~') controllerPos = [x, y, z];
          else if (char !== ' ' && char !== '-' && !blocks[char])
            throw new Error(`Unknown source cell ${char}`);
        }),
      ),
    );
    if (!controllerPos) throw new Error(`No controller ${id}`);
    return { size: [width, height, depth], layers, blocks, controllerPos };
  });
  const first = forms[0];
  if (
    JSON.stringify(first.size) !== JSON.stringify(dump.size) ||
    JSON.stringify(first.controllerPos) !== JSON.stringify(dump.controller.pos)
  )
    throw new Error(`Source frame differs from dump for ${id}`);
  first.layers.forEach((layer, y) =>
    layer.forEach((row, z) =>
      [...row].forEach((char, x) => {
        const dumped = dump.layers[y][z][x];
        const block = dump.legend[dumped]?.blockId;
        if (char === ' ' || char === '~' || char === '-') {
          if (dumped !== char && !(char === ' ' && dumped === '-'))
            throw new Error(`Dump/source occupancy differs at ${id} ${x},${y},${z}`);
        } else if (
          block !== first.blocks[char] &&
          !(block === 'gt.hatch.special' && first.blocks[char].startsWith('gregtech:gt.blockmachines@'))
        )
          throw new Error(`Dump/source block differs at ${id} ${x},${y},${z}`);
      }),
    ),
  );
  entries[id] = { source, sha256: createHash('sha256').update(raw).digest('hex'), forms };
}
writeFileSync(
  'src/data/beam-structures.rc2.generated.json',
  JSON.stringify({ rulesVersion: '2.9.0-RC-2', entries }, null, 2) + '\n',
);
console.log(`Generated ${Object.keys(entries).length} pinned beam controllers.`);
