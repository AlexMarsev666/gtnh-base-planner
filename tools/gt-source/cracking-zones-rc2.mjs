/** Mega Oil Cracker's adders, rather than its survival hints, define the resource regions. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const [root] = process.argv.slice(2);
if (!root) throw new Error('Expected pinned GT5U checkout.');
const source = 'src/main/java/gregtech/common/tileentities/machines/multi/MTEMegaOilCracker.java';
const raw = readPinnedSource(root, source);
const call = findCalls(stripComments(raw), 'addShape')[0];
const shape = string2D(
  splitArgs(call.args)[1]
    .replace(/^transpose\(/, '')
    .replace(/\)$/, ''),
);
const cells = { l: [], m: [], r: [] };
const roles = { L: 'l', M: 'm', R: 'r' };
const def = JSON.parse(readFileSync('src/data/multiblocks/mega-oil-cracker.json', 'utf8'));
shape.forEach((rows, y) =>
  rows.forEach((row, z) =>
    [...row].forEach((char, x) => {
      const role = roles[char];
      if (!role) return;
      const cell = [row.length - 1 - x, shape.length - 1 - y, z];
      const [cx, cy, cz] = cell;
      if (def.legend[def.layers[cy]?.[cz]?.[cx]]?.blockId !== 'gregtech:gt.blockcasings14@5')
        throw new Error(`Source zone ${role} at ${cell} does not match the RC2 dump.`);
      cells[role].push(cell);
    }),
  ),
);
for (const [role, zone] of Object.entries(cells))
  if (zone.length !== 9) throw new Error(`Unexpected zone ${role}: ${zone.length} cells.`);
writeFileSync(
  'src/data/cracking-zones.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      cells,
    },
    null,
    2,
  ) + '\n',
);
console.log('Mega Oil Cracker: 9 middle, 9 left and 9 right source cells.');
