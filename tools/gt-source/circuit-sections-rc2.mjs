/** Exact Circuit Assembly Line pieces, including the difference between checks and construction hints. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { findCalls, splitArgs, string2D, stripComments } from './java.mjs';
import { readPinnedSource } from './pinned-source.mjs';
const source = 'src/main/java/bartworks/common/tileentities/multis/MTECircuitAssemblyLine.java';
const raw = readPinnedSource(process.argv[2], source);
readPinnedSource(process.argv[2], 'src/main/java/gregtech/api/enums/HatchElement.java');
readPinnedSource(process.argv[2], 'src/main/java/gregtech/api/util/HatchElementBuilder.java');
const segments = {};
for (const call of findCalls(stripComments(raw), 'addShape')) {
  const args = splitArgs(call.args);
  const name = args[0].replace('STRUCTURE_PIECE_', '').toLowerCase();
  const shape = string2D(args[1].replace(/^transpose\(/, '').replace(/\)$/, ''));
  if (
    !shape ||
    shape.length !== 3 ||
    shape.some((row) => row.length !== 3 || row.some((s) => s.length !== 1))
  )
    throw new Error('Unsupported Circuit Assembly Line piece');
  segments[name] = { size: [1, 3, 3], layers: shape.toReversed().map((row) => [...row]) };
}
if (Object.keys(segments).join() !== 'first,next,next_hint,last')
  throw new Error('Missing Circuit Assembly Line pieces');
writeFileSync(
  'src/data/circuit-assembly-line.rc2.generated.json',
  JSON.stringify(
    {
      rulesVersion: '2.9.0-RC-2',
      source,
      sha256: createHash('sha256').update(raw).digest('hex'),
      segments,
    },
    null,
    2,
  ) + '\n',
);
