import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { format, resolveConfig } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
// Existing retained forms documented in tools/game-dump/README.md; not a new audit queue.
export const retainedShapes = [
  'extreme-entity-crusher',
  'large-essentia-smeltery',
  'research-completer',
  'space-elevator',
];
const statuses = ['default-formed', 'default-rejected', 'native-exception', 'unresolved'];

export function problemEntries(report) {
  if (report.semanticAudit !== 'partial') throw new Error('Expected the existing partial catalog evidence.');
  const ids = new Set();
  for (const entry of report.entries) {
    if (ids.has(entry.machine) || !statuses.includes(entry.status))
      throw new Error('Duplicate or unknown catalog entry.');
    ids.add(entry.machine);
  }
  if (ids.size !== report.count) throw new Error('Catalog count does not match its evidence.');
  for (const [status, field] of [
    ['default-formed', 'formed'],
    ['default-rejected', 'rejected'],
    ['native-exception', 'exceptions'],
    ['unresolved', 'unresolved'],
  ])
    if (report.entries.filter((e) => e.status === status).length !== report[field])
      throw new Error(`Stale ${field} count.`);
  const required = [...retainedShapes, 'boldarnator'];
  if (required.some((id) => !ids.has(id))) throw new Error('Missing a retained or deferred catalog entry.');
  return report.entries
    .filter((e) => e.status !== 'default-formed' || required.includes(e.machine))
    .sort((a, b) => (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0));
}

export function supportCode(entry) {
  if (entry.machine === 'boldarnator') return 'liquid-zones';
  if (retainedShapes.includes(entry.machine)) return 'retained-shape';
  return {
    'default-rejected': 'rejected-default',
    'native-exception': 'check-exception',
    unresolved: 'no-game-check',
  }[entry.status];
}

export function supportStatus(entry) {
  if (entry.machine === 'boldarnator') return 'limited';
  return ['default-rejected', 'native-exception'].includes(entry.status) ? 'known-problem' : 'unverified';
}

const cell = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', '<br>');
const json = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

export async function generateStatus() {
  const report = await json('tools/game-dump/catalog-results.rc2.json');
  const native = await json('tools/game-dump/native-results.rc2.json');
  if (native.pack !== report.pack || native.sourceCommit !== report.sourceCommit)
    throw new Error('Catalog and targeted evidence belong to different game versions.');
  const entries = problemEntries(report);
  const fixtureUse = new Map();
  for (const file of (await readdir(resolve(root, 'docs/fixtures'))).sort()) {
    if (!/^(reference-|user-shared).*\.json$/.test(file)) continue;
    for (const g of (await json(`docs/fixtures/${file}`)).groups ?? []) {
      const files = fixtureUse.get(g.multiblockId) ?? new Set();
      files.add(file);
      fixtureUse.set(g.multiblockId, files);
    }
  }
  // Load the same existing decorators as catalog.ts, only for the bounded problem list.
  // No placement, routing, native export or JVM checks run here.
  const server = await createServer({
    root,
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  try {
    const rules = await server.ssrLoadModule('/src/model/multiblock/rules.ts');
    const adapters = await server.ssrLoadModule('/src/model/multiblock/structureAdapters.ts');
    const rows = [];
    const support = {};
    for (const entry of entries) {
      const raw = await json(`src/data/multiblocks/${entry.machine}.json`);
      const counted = rules.withSourceCounts(raw);
      const reviewed = adapters.withReviewedStructure(counted);
      const def = rules.withRequiredDefaults(reviewed);
      const changed = Object.keys(reviewed).filter(
        (k) => JSON.stringify(reviewed[k]) !== JSON.stringify(counted[k]),
      );
      const requirements = Object.entries(def.requiredHatches ?? {}).map(
        ([kind, r]) => `${kind} ${r.min}–${r.max ?? '∞'}${r.regions ? ` (${r.regions.join(', ')})` : ''}`,
      );
      requirements.push(
        ...rules
          .countRules(def.id)
          .map(
            (r) =>
              `${r.kind ?? r.anyOf?.join(' + ') ?? 'неизвестный вид'} ${r.min ?? 0}–${r.max ?? '∞'} [${r.helper}]`,
          ),
      );
      requirements.push(
        ...rules
          .casingRules(def)
          .map(
            (r) =>
              `корпус ${r.min}${r.hatchableOnly ? ' (только заменяемые клетки)' : ''}: ${r.blocks.join(', ')}`,
          ),
      );
      const positive = native.results.filter(
        (r) => r.machine === def.id && r.passed && r.formed && !r.exception,
      );
      const code = supportCode(entry);
      if (!code) throw new Error(`No support decision for ${def.id}.`);
      const status = supportStatus(entry);
      support[def.id] = { reason: code, status };
      const reason =
        code === 'liquid-zones'
          ? 'Зоны воды/лавы каталога не согласованы с динамическим поведением RC2; работа над Boldarnator остановлена пользователем.'
          : code === 'retained-shape'
            ? 'Сохранена форма старого конвертера: необходимые интеграционные моды отсутствовали в дампе RC2.'
            : (entry.reason ??
              entry.exception ??
              `Форма по умолчанию отвергнута; ошибки: ${(entry.errors ?? []).map((e) => e.id).join(', ') || 'диагностика отсутствует'}.`);
      const shape = `${def.size.join(' × ')}${def.resize ? `; ${def.resize.label} ${def.resize.min}–${def.resize.max}` : ''}${raw.generated ? '; generated' : '; ручная'}`;
      rows.push([
        `[${def.name}](../src/data/multiblocks/${def.id}.json) (${def.id})`,
        shape,
        [...new Set(requirements)].join('; ') ||
          'Нет извлечённых минимумов; отсутствие данных не означает нулевой спрос',
        changed.length
          ? `withReviewedStructure: ${changed.join(', ')}`
          : 'Отдельной поправки withReviewedStructure нет; базовая форма и извлечённые количества',
        `${entry.status}; положительных адресных сценариев в сохранённом реестре: ${positive.length}`,
        [...(fixtureUse.get(def.id) ?? [])].join(', ') || 'Нет в сохранённых эталонах',
        status === 'limited'
          ? 'Ограниченная поддержка'
          : status === 'known-problem'
            ? 'Известная проблема'
            : 'Не проверено в игре',
        reason,
      ]);
    }
    const text =
      `# Этап 6: статусы ограниченного списка\n\n` +
      `Сгенерировано командой \`npm run catalog:status\`. Проверка актуальности: \`npm run catalog:status -- --check\`.\n\n` +
      `Источник: [catalog-results.rc2.json](../tools/game-dump/catalog-results.rc2.json), ${report.pack}, commit \`${report.sourceCommit}\`.\n` +
      `Данные частичные: по одной форме по умолчанию. Отказ или исключение сохранённого стенда не устанавливают ошибку всех вариантов; отсутствие экспорта не доказывает ошибку планировщика.\n\n` +
      `В списке **${entries.length} уникальных записей**: ${report.rejected} отказов, ${report.exceptions} исключения, ${report.unresolved} без экспорта. Boldarnator и четыре сохранённые формы уже входят в список; не прибавляются повторно. Отказы формы и исключения отмечены «Известная проблема»; ограничения экспорта и старые формы — «Не проверено в игре». Boldarnator сохраняет «Ограниченная поддержка». Причины сохранены.\n\n` +
      `Форма и количества ниже — текущие данные планировщика с уже имеющимися адаптерами. Игровая колонка — историческая диагностика, её отказ не считается исправленным наличием адаптера. Ресурсы, рецепты, динамическое поведение мира и все конфигурации здесь не проверяются.\n\n` +
      `Реестры: [количества](../src/data/constraints.runtime.generated.json), [корпуса](../src/data/casings.runtime.generated.json), [правила](../src/model/multiblock/rules.ts), [адаптеры](../src/model/multiblock/structureAdapters.ts), [адресные игровые результаты](../tools/game-dump/native-results.rc2.json), [происхождение сохранённых форм](../tools/game-dump/README.md).\n\n` +
      `| Механизм | Форма | Количества на машину | Имеющийся адаптер | Игровая проверка | Эталонные планы | Статус | Причина |\n` +
      `| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
      rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n') +
      '\n';
    const config = await resolveConfig(resolve(root, 'package.json'));
    return {
      'docs/plan-v3-stage-6-status.md': await format(text, { ...config, parser: 'markdown' }),
      'src/data/catalog-support.generated.json': await format(JSON.stringify(support), {
        ...config,
        parser: 'json',
      }),
    };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.slice(2).includes('--check');
  if (process.argv.slice(2).some((arg) => arg !== '--check')) throw new Error('Only --check is accepted.');
  for (const [path, contents] of Object.entries(await generateStatus())) {
    if (check) {
      if ((await readFile(resolve(root, path), 'utf8')) !== contents)
        throw new Error(`Stale generated status: ${path}. Run npm run catalog:status.`);
    } else await writeFile(resolve(root, path), contents);
    console.log(`${check ? 'Verified' : 'Generated'} ${path}`);
  }
}
