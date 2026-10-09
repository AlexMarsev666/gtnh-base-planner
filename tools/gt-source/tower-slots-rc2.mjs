/** Source-reviewed output slots for the default (tower) mode of Mega Distillation Tower. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const [root] = process.argv.slice(2);
if (!root) throw new Error('Expected pinned GT5U checkout.');
const source = 'src/main/java/gregtech/common/tileentities/machines/multi/MTEMegaDistillationTower.java';
const raw = readPinnedSource(root, source);
const calls = findCalls(stripComments(raw), 'addShape');
const shape = (index) =>
  string2D(
    splitArgs(calls[index].args)[1]
      .replace(/^transpose\(/, '')
      .replace(/\)$/, ''),
  );
const def = JSON.parse(readFileSync('src/data/multiblocks/mega-distillation-tower.json', 'utf8'));
const cells = [];
for (const [part, char, offset, region] of [
  [1, '4', 15, 'lower'],
  [1, '5', 15, 'upper'],
  [2, '6', 27, 'final'],
]) {
  const found = [];
  shape(part).forEach((rows, y) =>
    rows.forEach((row, z) =>
      [...row].forEach((value, x) => {
        if (value !== char) return;
        // World translation used by checkPiece: controller + (horizontalOffset-x, verticalOffset-y, z).
        const pos = [def.controller.pos[0] + 6 - x, def.controller.pos[1] + offset - y, z];
        const [cx, cy, cz] = pos;
        if (def.legend[def.layers[cy]?.[cz]?.[cx]]?.blockId !== 'gregtech:gt.blockcasings2@12')
          throw new Error(`Output ${char} at ${pos} does not match the RC2 dump.`);
        found.push(pos);
      }),
    ),
  );
  if (found.length !== 1) throw new Error(`Expected one output ${char}, found ${found.length}.`);
  cells.push({ pos: found[0], region });
}
writeFileSync(
  'src/data/tower-slots.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      // Base 12 blocks + 1..5 middle slabs of 6 + top 12 blocks.
      repeat: { from: 12, to: 18, min: 30, max: 54 },
      cells,
    },
    null,
    2,
  ) + '\n',
);
console.log('Mega Distillation Tower: two slots per 6-block slab and one final slot.');
