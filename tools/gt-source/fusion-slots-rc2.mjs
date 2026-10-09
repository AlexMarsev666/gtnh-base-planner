#!/usr/bin/env node
/** Source-reviewed energy injector zones missed by a low-tier hint probe. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPinnedSource } from './pinned-source.mjs';
import {
  findCalls,
  string2D,
  arrayFields1D,
  splitArgs,
  stringValue,
  stripComments,
  methodBody,
} from './java.mjs';

const [root] = process.argv.slice(2);
if (!root) throw new Error('Expected pinned GT5U checkout.');
const base = 'src/main/java/';
const smallPath = 'gregtech/common/tileentities/machines/multi/MTEFusionComputer.java';
const largePath = 'goodgenerator/blocks/tileEntity/base/MTELargeFusionComputer.java';
const read = (path) => readPinnedSource(root, base + path);
const entries = {};
for (const [path, char, variants] of [
  [
    smallPath,
    'e',
    [
      [
        'fusion-control-computer-mark-i',
        'gregtech/common/tileentities/machines/multi/MTEFusionComputer1.java',
      ],
      [
        'fusion-control-computer-mark-ii',
        'gregtech/common/tileentities/machines/multi/MTEFusionComputer2.java',
      ],
      [
        'fusion-control-computer-mark-iii',
        'gregtech/common/tileentities/machines/multi/MTEFusionComputer3.java',
      ],
      [
        'fusiontech-mk-iv',
        'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/advanced/MTEAdvFusionMk4.java',
      ],
      [
        'fusiontech-mk-v',
        'gtPlusPlus/xmod/gregtech/common/tileentities/machines/multi/processing/advanced/MTEAdvFusionMk5.java',
      ],
    ],
  ],
  [
    largePath,
    'E',
    [
      [
        'compact-fusion-computer-mk-i-prototype',
        'goodgenerator/blocks/tileEntity/MTELargeFusionComputer1.java',
      ],
      ['compact-fusion-computer-mk-ii', 'goodgenerator/blocks/tileEntity/MTELargeFusionComputer2.java'],
      ['compact-fusion-computer-mk-iii', 'goodgenerator/blocks/tileEntity/MTELargeFusionComputer3.java'],
      [
        'compact-fusion-computer-mk-iv-prototype',
        'goodgenerator/blocks/tileEntity/MTELargeFusionComputer4.java',
      ],
      ['compact-fusion-computer-mk-v', 'goodgenerator/blocks/tileEntity/MTELargeFusionComputer5.java'],
    ],
  ],
]) {
  const raw = read(path),
    source = stripComments(raw);
  const fields = arrayFields1D(source);
  const call = findCalls(source, 'addShape')[0];
  let shape;
  if (fields.size)
    shape = ['L0', 'L1', 'L2', 'L3', 'L2', 'L1', 'L0'].map((name) =>
      splitArgs(fields.get(name).slice(1, -1)).map(stringValue),
    );
  else
    shape = string2D(
      splitArgs(call.args)[1]
        .replace(/^transpose\(/, '')
        .replace(/\)$/, ''),
    );
  const cells = [];
  shape.forEach((rows, y) =>
    rows.forEach((row, z) =>
      [...row].forEach((c, x) => {
        if (c === char) cells.push([row.length - 1 - x, shape.length - 1 - y, z]);
      }),
    ),
  );
  if (cells.length !== (char === 'e' ? 16 : 32))
    throw new Error(`${path}: unexpected injector count ${cells.length}`);
  for (const [id, controller] of variants) {
    const variantSource = read(controller);
    const body = methodBody(variantSource, char === 'e' ? 'tier' : 'energyHatchTier');
    const tier = Number(/return\s+(\d+)\s*;/.exec(body)?.[1]);
    if (!Number.isInteger(tier) || tier < 0 || tier > 13)
      throw new Error(`${controller}: unresolved energy tier`);
    const def = JSON.parse(readFileSync(`src/data/multiblocks/${id}.json`, 'utf8'));
    for (const [x, y, z] of cells) {
      if (!def.legend[def.layers[y]?.[z]?.[x]]?.blockId)
        throw new Error(`${id}: energy zone does not match dump`);
    }
    entries[id] = {
      cells,
      minTier: tier,
      source: base + path,
      sha256: createHash('sha256').update(raw).digest('hex'),
      controller: base + controller,
    };
  }
}
writeFileSync(
  'src/data/fusion-slots.rc2.generated.json',
  JSON.stringify({ rulesVersion: '2.9.0-RC-2', entries }, null, 2) + '\n',
);
console.log(`${Object.keys(entries).length} reviewed fusion injector zones`);
