# 05 — Соответствие правилам GTNH

Агент: `gtnh-expert` (Sonnet), Read/Grep/Glob/WebFetch. Версия каталога: GT:NH 2.9.0-beta-3 / GT5-Unofficial **5.09.54.133**.

**Важное ограничение метода.** WebFetch возвращает пересказ страницы маленькой моделью (цитаты ≤ ~125 символов), а не
построчный исходник; два ответа противоречили друг другу; лимит запросов исчерпан до перепроверки Assembly Line. Поэтому
**ни одна находка не помечена как подтверждённая**: все — риски, номера строк GT указаны «по данным инструмента загрузки».
Для подтверждения нужен локальный checkout `GT5-Unofficial@5.09.54.133` (`tools/gt-source/README.md`). Критических находок нет.

## Риски

### N1. Coke Oven: общий хэтч обслуживает контроллеры по очереди, а не одновременно — Medium `[catalog 5.09.54.133]`

- **Репозиторий:** `src/data/multiblocks/coke-oven.json:31` («a hatch keeps a list of controllers, so one hatch can serve several
  ovens»), `:28`.
- **GT:** `gregtech/api/metatileentity/implementations/MTEHatchCokeOven.java` — список `controllers` (~119), `addController`
  (~196-199), раз в секунду действует для активного контроллера и переходит к следующему (`nextActiveController()`, ~201-218).
- **Воспроизведение:** N коксовых печей с одним общим хэтчем → планировщик считает хэтч полностью обслуживающим всех.
- **Последствия:** в игре каждая печь получает 1/N пропускной способности хэтча; план с экономией хэтчей недорабатывает.
  Само совместное использование реально — это не ошибка формирования.
- **Исправление:** указать в `notes` и/или предупреждение в UI о делении пропускной способности.

### N2. Assembly Line: направления и лимиты хэтчей не закодированы — Low–Medium `[catalog 5.09.54.133]`

- **Репозиторий:** `src/data/multiblocks/assembly-line.json:24-25,36-40,44` — у `b` нет `disallowFaces`, `B` допускает `itemOut`
  с обеих сторон.
- **GT:** `MTEAssemblyLine.java` — `b` и `i` только вниз (~97), выходная шина `OutputBus.newAny(16, 1, ForgeDirection.DOWN)` (~109)
  только в последнем срезе с одной стороны, 1–4 входных хэтча по подсказке (~183).
- **Последствия:** планировщик может поставить хэтч боком — в игре структура не соберётся (в `notes` это частично признано).
- Совпадает с исходником: грани `e`, предел 16 срезов (`resize` 5..16), `d` только NORTH.

### N3. Сопоставление имён машин не проверено — Low `[unverified]`

`src/data/gtnhplanner-machines.ts:53-57` (`milling` → `isamill-grinding-machine`, «multiblock electrolyzer/centrifuge/mixer» →
industrial-*). Карта `gt.recipe.oremill` в `RecipeMaps.java` существует; `GTPPRecipeMaps.java` на этом теге вернул 404.

## Улучшения

- **N4. EBF: `muffler { max: 1 }` не подтверждён исходником, но на практике ни на что не влияет — Low.**
  `electric-blast-furnace.json:35`; в GT `Muffler.newAny(CASING_INDEX, 2)` — 2 это точка подсказки, а не максимум; muffler
  допустим только в одной ячейке `m`.
- **N5. Новые версии (контекст, не дефект) — Low `[newer: 5.09.54.220]`.** Последний тег GT5-Unofficial — 5.09.54.220
  (9 окт. 2026), на 87 сборок новее; модпак — `2.9.0-nightly-2026-10-09`, `2.9.0-RC-2` (4 окт.). Возможно относится к
  проверенным записям только .218 «Count recipes and runtime in the Coke Oven». Структурных изменений в Coke Oven, Distillation
  Tower, EBF, Assembly Line беглая проверка не показала (ненадёжно).

## Сверено и согласуется (по пересказу исходника)

Coke Oven (форма, контроллер, хэтч на `sBlockCasings12:0`), EBF (3×4×3, катушки, верх только `f` + `m`, допуски `b`), Vacuum
Freezer (3×3×3, минимум 16 корпусов), Distillation Tower (высота 3–12, формула корпусов `7×height−5`, хэтч на каждый слой,
`l` без UP/DOWN), Pyrolyse Oven (5×6×7, допуски `G`/`F`, минимум 60), Large Combustion Engine (зеркально по X, контроллер x=6,
минимум 10), Large Steam/Gas Turbine (база `MTELargeTurbineBase`, `requiresOutputHatch()` → `fluidOut` min 1), Implosion
Compressor, Steam Grinder (3×4×3, минимум 14).
**Глобально:** методы `add*ToMachineList` в `MTEMultiBlockBase` не проверяют владельца → один хэтч может быть в списках
нескольких контроллеров; `checkMaintenance` сбрасывает флаги → maintenance правильно не делится. Во всех 244 записях
`shareableHatches` содержат только предметы/жидкости и `steamIn` у 8 паровых. Утверждение README, что проверки структуры не
«захватывают» корпуса, исходником не опровергнуто (StructureLib не читался).

## Не проверено

Рукотворные записи: big-barrel-brewery, bricked-blast-furnace, dissection-apparatus, extreme-combustion-engine,
extreme-entity-crusher, industrial-autoclave, industrial-centrifuge, large-chemical-reactor, large-essentia-smeltery,
large-fluid-extractor, large-heat-exchanger, large-hp-steam-turbine, large-plasma-turbine, large-semifluid-generator,
large-supercritical-steam-turbine, multi-smelter, research-completer, space-elevator, паровые blender/fuser/hearth/presser/
purifier/separator/squasher, turbocan-pro; large-gas-turbine только открыт. Все 210 сгенерированных. Грани хэтчей по ячейкам,
`requiredHatches` Coke Oven, `resize.default` Distillation Tower, ~40 из 45 алиасов, диффы новых тегов.
