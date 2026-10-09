import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

// Diagnostic SSR transforms only: the application, worker and routing defaults stay unchanged.
const mode = process.argv[2] ?? 'verify';
const corrected = 'docs/fixtures/gtnh-site-site (3)-corrected.json';
const inputs = [
  ['01', 'docs/fixtures/reference-01-oil-refinery.json'],
  ['03', 'docs/fixtures/reference-03-medium.json'],
  ['04', 'docs/fixtures/reference-04-crackers-towers.json'],
  ['(3)', corrected],
];
const buildOptions = { pipes: true, cables: true, below: true };

async function modules(surfaceCost = 1) {
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    plugins: [
      {
        name: 'diagnostic-observation-only',
        enforce: 'pre',
        transform(source, id) {
          if (id.endsWith('/src/model/site/router.ts')) {
            if (!source.includes('const SURFACE_COST = 1;')) throw new Error('Surface constant moved');
            return source.replace('const SURFACE_COST = 1;', `const SURFACE_COST = ${surfaceCost};`);
          }
          if (id.endsWith('/src/model/site/optimize.ts')) {
            return (
              source
                .replace('export function optimizeSite(', 'function executeOptimizeSite(')
                .replace(
                  'const start = scoreBuild(measured);',
                  'const start = scoreBuild(measured); globalThis.__measurement?.scored(start, false);',
                )
                .replace(
                  'scores.set(key, score);',
                  'scores.set(key, score); globalThis.__measurement?.scored(score, true);',
                ) +
              '\nexport function optimizeSite(site, builder, opts = {}) {\n' +
              'const began = performance.now(); const result = executeOptimizeSite(site, builder, opts);\n' +
              'globalThis.__measurement?.finished(result, performance.now() - began); return result; }\n'
            );
          }
          if (id.endsWith('/src/ui/siteArrange.ts')) {
            return source.replace(
              'alignRows: true',
              'alignRows: globalThis.__measurement?.alignRows ?? true',
            );
          }
          if (id.endsWith('/src/model/site/anneal.ts')) {
            return (
              source.replace('export function annealGroups(', 'function executeAnnealGroups(') +
              '\nexport function annealGroups(site, sizeOf, opts = {}) {\n' +
              'const result = executeAnnealGroups(site, sizeOf, opts);\n' +
              'globalThis.__measurement?.annealed(result.iterations, !!opts.evaluate); return result; }\n'
            );
          }
        },
      },
    ],
  });
  const [codec, build, optimize, commands] = await Promise.all([
    server.ssrLoadModule('/src/share/siteCodec.ts'),
    server.ssrLoadModule('/src/model/site/build.ts'),
    server.ssrLoadModule('/src/model/site/optimize.ts'),
    server.ssrLoadModule('/src/ui/siteArrange.ts'),
  ]);
  return { server, ...codec, ...build, ...optimize, ...commands };
}

async function inputSite(m, id, file) {
  const site = m.siteFromJson(await readFile(file, 'utf8'));
  // The accepted stage-5 reference loader already applies these two approved assignments.
  // Keep the stored historical attachment unchanged, just as referencePlans() does.
  if (id === '01')
    for (const b of site.groups.find((g) => g.id === 'g9').resourceBindings)
      if (['fluid:resource', 'fluid:light-steam-cracked-napthta'].includes(b.resource)) b.unitId = 1;
  return site;
}

async function verify() {
  const original = 'D:/Downloads/gtnh-site-site (3).json';
  const raw = await readFile(original, 'utf8');
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const source = JSON.parse(raw);
  const fixed = JSON.parse(await readFile(corrected, 'utf8'));
  const restored = structuredClone(fixed);
  restored.groups.find((g) => g.id === 'g9').resourceBindings = source.groups.find(
    (g) => g.id === 'g9',
  ).resourceBindings;
  if (JSON.stringify(restored) !== JSON.stringify(source)) throw new Error('Changes outside g9 bindings');
  const m = await modules();
  try {
    const built = m.createSiteBuilder()(m.siteFromJson(JSON.stringify(fixed)), buildOptions);
    const warnings = built.warnings.filter(
      (w) => ('group' in w && w.group === 'g9') || ('groups' in w && w.groups.includes('g9')),
    );
    const result = {
      original,
      sha256,
      corrected,
      g9warnings: warnings,
      allWarnings: built.warnings,
      stats: built.stats,
      g9hatches: built.groups
        .find((g) => g.group.id === 'g9')
        .hatches.map((h) => ({ kind: h.kind, resource: h.resource, unitIds: h.unitIds })),
    };
    await writeFile(
      'docs/fixtures/corrected-plan-verification-2026-10-10.json',
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
    if (warnings.length || built.stats.connected !== built.stats.terminals)
      throw new Error('Verification failed');
    if ((await readFile(original, 'utf8')) !== raw) throw new Error('Original changed');
  } finally {
    await m.server.close();
  }
}

async function optimizeMeasurements() {
  const m = await modules();
  const rows = [];
  try {
    for (const [id, file] of inputs) {
      const original = await inputSite(m, id, file);
      for (const variant of ['a', 'b', 'c']) {
        const builder = m.createSiteBuilder();
        let best;
        let scored = 0;
        let core;
        let searchMs = 0;
        const annealRuns = [];
        globalThis.__measurement = {
          alignRows: variant === 'a',
          scored(score, candidate) {
            if (candidate) scored++;
            if (!best || m.better(score, best)) best = score;
          },
          finished(result, ms) {
            core = result;
            searchMs = ms;
          },
          annealed(iterations, routed) {
            annealRuns.push({ iterations, routed });
          },
        };
        const began = performance.now();
        let command;
        let baseline;
        let accepted = false;
        let rejection;
        if (variant !== 'b') {
          command = m.arrangeHere(original, true, builder, true);
          baseline = command.optimized?.start ?? m.scoreBuild(builder(original, buildOptions));
          accepted = !!command.optimized?.improved;
          rejection = accepted
            ? null
            : command.rejected
              ? 'canonical-layout-rejected'
              : !command.fits
                ? 'canonical-layout-does-not-fit'
                : (core?.stopped ??
                  (!core || !m.better(core.result, baseline)
                    ? 'no-strict-improvement-over-original'
                    : 'canonical-repeat-safety-guard'));
        } else {
          core = m.optimizeSite(original, builder, { below: true, alignRows: false });
          baseline = core.start;
          accepted = !core.stopped && m.better(core.result, baseline);
          rejection = accepted ? null : (core.stopped ?? 'no-strict-improvement-over-original');
        }
        const row = {
          id,
          file,
          variant,
          mode: original.routing?.mode ?? 'compact',
          budgetMs: m.DEFAULT_BUDGET_MS,
          scoredCandidates: scored,
          tried: core?.tried ?? 0,
          original: baseline,
          searchStart: core?.start ?? null,
          bestFound: best ?? null,
          returned: core?.result ?? null,
          accepted,
          rejection,
          searchMs,
          totalMs: performance.now() - began,
          annealRuns,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        delete globalThis.__measurement;
        await writeFile(
          'docs/fixtures/optimize-measurements-2026-10-10.json',
          JSON.stringify(rows, null, 2) + '\n',
        );
      }
    }
  } finally {
    delete globalThis.__measurement;
    await m.server.close();
  }
}

// An approach is an unbranched path from a hatch: at most three horizontal steps, including
// a vertical riser down to the first underground cell. Ports are not counted as hatch approaches.
function routingMetrics(built) {
  let approaches = 0;
  let surface = 0;
  let trunkSurface = 0;
  let trunkTotal = 0;
  const levels = {};
  for (const net of built.nets) {
    const cells = new Map((net.route?.paths ?? []).flat().map((p) => [p.join(','), p]));
    const leads = new Set();
    const neighbours = (p) =>
      [
        [p[0] - 1, p[1], p[2]],
        [p[0] + 1, p[1], p[2]],
        [p[0], p[1] - 1, p[2]],
        [p[0], p[1] + 1, p[2]],
        [p[0], p[1], p[2] - 1],
        [p[0], p[1], p[2] + 1],
      ].filter((q) => cells.has(q.join(',')));
    const offsets = {
      north: [0, 0, -1],
      south: [0, 0, 1],
      east: [1, 0, 0],
      west: [-1, 0, 0],
      up: [0, 1, 0],
      down: [0, -1, 0],
    };
    for (const [ti, terminal] of net.terminals.entries()) {
      if (!terminal.hatch) continue;
      const offset = offsets[net.route?.attach[ti]];
      if (!offset) continue;
      const attached = [terminal.cell.map((v, axis) => v + offset[axis])];
      if (!cells.has(attached[0].join(','))) continue;
      let previous = terminal.cell;
      let current = attached[0];
      let horizontal = Number(previous[1] === current[1]);
      const seen = new Set();
      while (current && current[1] >= 0 && horizontal <= 3 && !seen.has(current.join(','))) {
        const key = current.join(',');
        seen.add(key);
        const next = neighbours(current).filter((q) => q.join(',') !== previous.join(','));
        if (next.length > 1) break;
        leads.add(key);
        const following = next[0];
        if (following && following[1] === current[1]) horizontal++;
        previous = current;
        current = following;
      }
    }
    for (const [key, p] of cells) {
      levels[p[1]] = (levels[p[1]] ?? 0) + 1;
      if (p[1] >= 0) {
        surface++;
        if (leads.has(key)) approaches++;
        else trunkSurface++;
      }
      if (!leads.has(key)) trunkTotal++;
    }
  }
  return {
    length: built.stats.pipeBlocks + built.stats.cableBlocks,
    bends: built.stats.bends ?? 0,
    terminals: built.stats.terminals,
    connected: built.stats.connected,
    warnings: built.warnings,
    surface,
    surfaceApproaches: approaches,
    surfaceTrunks: trunkSurface,
    trunkTotal,
    surfaceTrunkShare: trunkTotal ? trunkSurface / trunkTotal : 0,
    surfaceTrunksShareOfSurface: surface ? trunkSurface / surface : 0,
    levels,
  };
}

async function neatMeasurements() {
  const rows = [];
  for (const penalty of [1, 2, 4, 8]) {
    const m = await modules(penalty);
    try {
      for (const [id, file] of inputs) {
        const original = await inputSite(m, id, file);
        const builder = m.createSiteBuilder();
        const began = performance.now();
        const command = m.arrangeHere(original, true, builder, false, undefined, true);
        const built = builder(command.site, buildOptions);
        const row = {
          id,
          file,
          penalty,
          accepted: !!command.routingSummary,
          rejected: !!command.rejected,
          fits: command.fits,
          mode: command.site.routing?.mode ?? 'compact',
          depth: command.site.routing?.depth ?? null,
          ...routingMetrics(built),
          totalMs: performance.now() - began,
        };
        rows.push(row);
        console.log(JSON.stringify(row));
        await writeFile(
          'docs/fixtures/neat-measurements-2026-10-10.json',
          JSON.stringify(rows, null, 2) + '\n',
        );
      }
    } finally {
      await m.server.close();
    }
  }
}

if (mode === 'verify') await verify();
else if (mode === 'optimize') await optimizeMeasurements();
else if (mode === 'neat') await neatMeasurements();
else throw new Error('Expected verify, optimize or neat');
