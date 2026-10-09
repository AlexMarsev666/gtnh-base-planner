import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import hashes from './rc2-source-hashes.json' with { type: 'json' };

/** Labels and directory names do not prove a source version. Compare the actual source bytes before
 * generating RC2 evidence, including archive checkouts that do not contain a Git repository.
 */
export function verifySourceHash(path, source, expected = hashes.files) {
  const known = expected[path];
  if (!known) throw new Error(`RC2 source is not pinned: ${path}`);
  if (createHash('sha256').update(source).digest('hex') !== known)
    throw new Error(`Source differs from GT5U RC2 ${hashes.commit}: ${path}`);
  return source;
}

export function readPinnedSource(root, path) {
  return verifySourceHash(path, readFileSync(join(root, path), 'utf8'));
}
