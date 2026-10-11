// Fails when the build outgrows its budget. Run after `npm run build`.
//
// Budgets sit about 15-20 % above the sizes measured when they were set (September 2026: main JS 321 KB,
// site worker 87 KB, CSS 4 KB gzipped; atlas 90 KB; dist 2.5 MB), so ordinary changes pass and real growth
// (a new dependency, an unsplit data file, an atlas that doubled) is a conscious decision: raise the budget
// here in the same change, with the reason.
//
// Raised with the catalog built from the game dump (244 multiblocks, 39 of them new, several huge: Forge of the
// Gods, Large Hadron Collider, Nanochip Assembly Complex; 619 atlas tiles): site worker 111 KB, atlas 141 KB,
// dist 3.9 MB.
//
// Raised when the machine pipeline moved into the worker (October 2026; it runs in its own Worker instance of
// the same script, so the routing of a large build no longer blocks the page): site worker 129.5 KB.
//
// Raised with GT5-Unofficial 5.09.54.205 (hatch zones and tooltip text in every catalog entry), tiers, mirror,
// neat routing and transformer looks (October 2026): main JS 383 KB.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const dist = process.argv[2] ?? 'dist';

/** [what, file matcher, measure, budget in bytes] */
const budgets = [
  ['main script (gzip)', /^assets\/main-.*\.js$/, 'gzip', 395 * KB],
  ['site worker (gzip)', /^assets\/siteWorker-.*\.js$/, 'gzip', 150 * KB],
  ['styles (gzip)', /^assets\/.*\.css$/, 'gzip', 6 * KB],
  ['texture atlas', /^textures\/atlas\.png$/, 'raw', 170 * KB],
  ['whole site', /./, 'raw', 4.75 * 1024 * KB],
];

function files(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = prefix + name;
    return statSync(path).isDirectory() ? files(path, `${rel}/`) : [rel];
  });
}

if (!existsSync(dist)) {
  console.error(`No ${dist}/: run npm run build first.`);
  process.exit(1);
}
const all = files(dist);
let failed = false;
for (const [what, match, measure, budget] of budgets) {
  const hit = all.filter((f) => match.test(f));
  if (hit.length === 0) {
    console.error(`✗ ${what}: no file matches ${match}`);
    failed = true;
    continue;
  }
  const size = hit.reduce((sum, f) => {
    const bytes = readFileSync(join(dist, f));
    return sum + (measure === 'gzip' ? gzipSync(bytes).length : bytes.length);
  }, 0);
  const ok = size <= budget;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${what}: ${(size / KB).toFixed(1)} KB of ${(budget / KB).toFixed(0)} KB`);
}
// The security headers must ship with the site.
if (!all.includes('_headers')) {
  console.error('✗ _headers is missing from the build');
  failed = true;
}
process.exit(failed ? 1 : 0);
