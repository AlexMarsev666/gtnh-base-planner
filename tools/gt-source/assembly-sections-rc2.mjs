/** FIRST/LATER are the pieces checked by both controllers; LAST is only a construction hint. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';

const sources = [
  'src/main/java/gregtech/common/tileentities/machines/multi/MTEAssemblyLine.java',
  'src/main/java/ggfab/mte/MTEAdvAssLine.java',
];
let segments;
const evidence = sources.map((source) => {
  const raw = readPinnedSource(process.argv[2], source);
  const pieces = {};
  for (const call of findCalls(stripComments(raw), 'addShape')) {
    const args = splitArgs(call.args);
    const name = args[0].replace('STRUCTURE_PIECE_', '').toLowerCase();
    const shape = string2D(args[1].replace(/^transpose\(/, '').replace(/\)$/, ''));
    if (!shape || shape.length !== 4 || shape.some((row) => row.length !== 3))
      throw new Error('Unsupported Assembly Line piece');
    pieces[name] = { size: [1, 4, 3], layers: shape.toReversed().map((row) => [...row]) };
  }
  if (Object.keys(pieces).join() !== 'first,later,last') throw new Error('Missing Assembly Line pieces');
  if (segments && JSON.stringify(segments) !== JSON.stringify(pieces))
    throw new Error('Assembly Line controllers no longer share their topology');
  segments = pieces;
  return { source, sha256: createHash('sha256').update(raw).digest('hex') };
});
writeFileSync(
  'src/data/assembly-line.rc2.generated.json',
  JSON.stringify({ rulesVersion: '2.9.0-RC-2', sources: evidence, segments }, null, 2) + '\n',
);
console.log('Generated pinned Assembly Line FIRST/LATER/LAST pieces for both controllers.');
