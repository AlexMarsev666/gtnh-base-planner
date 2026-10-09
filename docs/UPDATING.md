# Обновление каталога для следующей версии GTNH

Инструкция отделяет дамп формы от правил контроллера и игровых свидетельств. Обновление не требует
нового аудита всех машин: сравниваются изменившиеся формы и уже имеющиеся адаптеры. Непроверенная
запись получает ограниченную поддержку с причиной и не блокирует завершение обновления.

В этапе 7 подготовлена только документация. Дамп, `*-rc2.mjs`, native-сценарии, probe-скрипты и
симуляция не запускались. Их запуск при будущем обновлении требует отдельного согласования объёма;
эта инструкция не отменяет текущую заморозку. Работа над Boldarnator и зеркало отдельного юнита
остаются отложенными. Рецепты планировщик не ищет.

## Текущая привязка

| Компонент      | Зафиксированная версия                                                               | Где проверяется                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| GTNH           | `2.9.0-RC-2`                                                                         | [rc2-source-lock.json](../tools/game-dump/rc2-source-lock.json)                                                                |
| GT5-Unofficial | `5.09.54.205`, commit `a3e1e11241a814c9fa0dd0973d5699548428f689`                     | Тот же lock; [rc2-source-hashes.json](../tools/gt-source/rc2-source-hashes.json) закрепляет байты Java-файлов                  |
| StructureLib   | `1.4.45`, commit `4fdea655379db43443223aa448255144b76d85ca`                          | [structurelib-rc2-hashes.json](../tools/gt-source/structurelib-rc2-hashes.json); хэш dev JAR в lock                            |
| Экстрактор     | `MrBruh/gtnh-process-line-solver`, commit `19deba995e2bd8d74050aee80653949a0af1ad6f` | [extractor.patch](../tools/game-dump/extractor.patch), порядок подготовки в [README экстрактора](../tools/game-dump/README.md) |

SHA-256 dev JAR: GT5U `8bada681d3190188bcef8583ae7c9bb447d6fd4ef8dc7ac50bcf4a744daf4b5a`,
StructureLib `d6eb9b4bc09efd0fc4d39a14e5000254b75fdae4b2eee7d2f51135d7dbe8cc5e`.
Это хэши именно development-артефактов стенда, не любых JAR с той же версией в имени.

Часть ручных форм и четыре сохранённые записи происходят из старого конвертера для GT5U
`5.09.54.133`. Отсутствие интеграционного мода в экстракторе не означает удаление машины из GTNH.
Extreme Entity Crusher, Large Essentia Smeltery, Research Completer и Space Elevator сохраняются;
их ограничения перечислены в [таблице этапа 6](plan-v3-stage-6-status.md).

## Поток данных и граница доказательств

Экстрактор вызывает `construct()` и пишет физическую форму, подсказки и разрешённые в клетках
типы люков. [build.mjs](../tools/game-dump/build.mjs) преобразует дамп в
`src/data/multiblocks/*.json`, блоки и текстуры. `construct()` не доказывает успешный `checkMachine`
или правильную обработку ресурсов.

[catalog.ts](../src/data/catalog.ts) применяет строго в этом порядке:
`withSourceCounts` → `withReviewedStructure` → `withRequiredDefaults`. Первый слой берёт извлечённые
количества, второй восстанавливает проверенные зоны, формы и специальные интерфейсы, третий задаёт
набор люков для новых планов. Сохранённые настройки не становятся новыми defaults.

Runtime сейчас применяет адаптеры по ID машины, без выбора версии GTNH из сохранённого плана.
Нельзя подмешать новый дамп к старым RC2-поправкам и объявить результат поддержкой новой версии.
Файлы с `generated: true` обновляются своим генератором; поправки сохраняются отдельно от сырого каталога.

Сохранённые [native-results.rc2.json](../tools/game-dump/native-results.rc2.json) подтверждают только
описанные в них адресные случаи. [catalog-results.rc2.json](../tools/game-dump/catalog-results.rc2.json)
содержит частичную диагностику форм по умолчанию. Ни один реестр не доказывает все варианты,
режимы, общие стены и обработку рецептов всех машин.

## Порядок обновления

### 1. Зафиксировать целевую версию и подготовить экстрактор

В отдельной ветке сохранить исходные реестры, формы и эталонные планы. Записать версию сборки,
точные GT5U/StructureLib tag и commit, состав интеграционных модов, SHA-256 реально используемых JAR
и Java-файлов. На Windows хэш файла читается командой `Get-FileHash <полный-путь> -Algorithm SHA256`.

Команды планировщика требуют Node.js 24 и установленных зависимостей из lockfile (`npm ci`).
Для браузерных проверок нужен Chromium: `npx playwright install chromium`.

Подготовка экстрактора — по [tools/game-dump/README.md](../tools/game-dump/README.md): checkout,
патч, JDK, `setupCIWorkspace`, файлы MCP в `run/conf` и scratch-сервер. Текущий воспроизводимый
RC2-вариант использует JDK 25. Для другой версии требования проверяются по её зависимостям.
В `extractor.patch` зафиксированы GT5U/StructureLib и обходы зависимостей RC2; перед переносом патча
нужно сверить их с новым стендом. Параметр `modVersions` не заменяет обновление зафиксированных
строк `dependencies.gradle` в этом патче.

После этой подготовки пример запуска в PowerShell из `tools/gtnh-extractor` отдельного checkout:

```powershell
$updatePack = '<версия-GTNH>'
$updateGt = '<версия-GT5U>'
$updateSl = '<версия-StructureLib>'
$updateDump = 'D:/gtnh-update/structures'
.\gradlew.bat runServer "-PdatasetOut=$updateDump" "-PpackVersion=$updatePack" "-PmodVersions=GT5-Unofficial=$updateGt,StructureLib=$updateSl"
```

В Bash используется `./gradlew` с теми же параметрами. Сохранить метаданные запуска, журнал
пропущенных/ошибочных контроллеров и каталог `<datasetOut>/multiblocks`; не заполнять пропуски
догадками. Это снятие форм, а не native-проверка корректности.

### 2. Обновить конвертер и проверить изменения до записи

В `tools/game-dump/build.mjs` константа `TAG` сейчас равна `5.09.54.205`; она задаёт ссылки `source`
в выходном каталоге. У конвертера **нет** параметров `--pack` или `--tag`, и метаданные дампа не
переключают эту константу автоматически. Для новой версии изменить её в ветке обновления вместе
с источниками версии; сверить `source_class` и регистрацию переименованных контроллеров.

Далее команды из корня checkout планировщика. Значения путей заменяются на реальные абсолютные
пути, JAR — от того же стенда и источников:

```powershell
$updateStructures = 'D:/gtnh-update/structures/multiblocks'
$updateSources = 'D:/gtnh-update/GT5-Unofficial'
$updateJar = 'D:/gtnh-update/jars/GT5-Unofficial-dev.jar'
node tools/game-dump/build.mjs --structures $updateStructures --gt5u $updateSources --jars $updateJar
```

Без `--write` конвертер только сообщает новые, удаляемые и пропущенные записи, отсутствующие
текстуры. Вместо `--gt5u` можно передать `--textures <manifest.json>` из клиентского дампа;
`--jars` принимает несколько конкретных файлов/каталогов в порядке приоритета. Не передавать
неразвёрнутую маску пути к JAR.

Сверить diff с прежними ID и формами. Ручные определения имеют приоритет и автоматически не
переписываются. Старые generated-записи отсутствующих в дампе классов сохраняются. Это сохранение
совместимости, а не доказательство их пригодности для новой версии.

### 3. Записать каталог и обновить затронутые правила

После проверки отчёта использовать тот же набор аргументов:

```powershell
node tools/game-dump/build.mjs --structures $updateStructures --gt5u $updateSources --jars $updateJar --write
```

`--write` заменяет присутствующие generated-формы, удаляет их прежние файлы/неиспользуемые dump-тайлы
и записывает следующие артефакты:

| Артефакт                                                                      | Назначение                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/data/multiblocks/<id>.json`                                              | Сырые формы и легенды; generated-записи не править руками |
| `src/data/blocks.generated.json`                                              | Названия и цвета физических блоков                        |
| `tools/game-dump/textures.generated.json`, `tools/texture-sources/DUMP_*.png` | Слои граней и тайлы                                       |
| `ATTRIBUTION.md`                                                              | Источники текстур между маркерами `tools/game-dump`       |

Сопоставить изменённые `checkMachine`, adders, регистрации и методы распределения ресурсов
с таблицей адаптеров ниже. Для неизменившегося источника сохранить проверенные правила; изменившееся
условие нельзя заменять предположением из hologram hints. Сложная или отсутствующая семантика
остаётся ограничением с причиной. Новые адаптеры нужны только для согласованных случаев, мешающих
работе планировщика; полный новый аудит каталога не является частью процедуры.

RC2-генераторы из [tools/gt-source/README.md](../tools/gt-source/README.md) проверяют исходники через
`pinned-source.mjs`; `single-tiers.mjs` тоже использует эту проверку. Они не являются универсальными
генераторами следующей версии. Сохранить исторические RC2-lock, хэши и свидетельства; для нового
набора подготовить соответствующий version lock и читатели/выходные данные, затем явно переключить
активные runtime-импорты и источники версии. Не отключать проверку хэшей и не переписывать старый
успешный отчёт, чтобы новый источник выглядел как RC2.

Без native-проверки новой версии ограничиться исходниками, тестами модели и честным статусом
поддержки. Если отдельная игровая проверка разрешена, её случаи и loaded-JAR hashes должны относиться
к этой версии. Нынешние `native-fixtures.mjs`, `native-jars.mjs` и publishers требуют конкретные
RC2 dev JAR и не примут другие артефакты. Изменение размещения не позволяет просто пересохранить
старую native evidence: нужен соответствующий игровой результат.

Имена импорта обновляются через `tools/gt-source/machine-types.mjs <GT5U source root>`;
это чтение типов из tooltip, не поиск рецептов. Регистрируемые тиры/специальные люки — через
адаптированный к целевой версии `tools/game-dump/single-tiers.mjs`. При новых вручную описанных
block ID сверить `src/data/blocks.ts` и `src/render/textures.json`. Новые источники и зависимости
записать с лицензией, сохранив `LICENSE` и `ATTRIBUTION.md`: экстрактор Apache-2.0, текстуры GT5U LGPL-3.0.

## Где находятся привязанные к RC2 адаптеры

Пути в таблице отсчитываются от `src/model/multiblock/`, если не указан другой каталог.
Сгенерированные JSON в таблице лежат в `src/data/`. Имена генераторов — в `tools/gt-source/`;
это указатели происхождения, не список команд к запуску.
Константы `REVIEWED_*` и JSON содержат конкретные ID машин и ссылки на проверенные Java-файлы.

| Машина / семейство                                                                                      | Код и данные                                                                                                                                                                                | Что сверять при смене версии                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Извлечённые стандартные количества и корпуса                                                            | [rules.ts](../src/model/multiblock/rules.ts), `constraints{.rc2,.runtime}.generated.json`, `casings{.rc2,.runtime}.generated.json`; `constraints-rc2.mjs`, `casings-rc2.mjs`                | Условность helper calls, `kind`/`anyOf`, минимумы/максимумы, отдельные счётчики и `hatchableOnly`. Извлечение частичное                                                                                       |
| Oil Cracking Unit                                                                                       | [oil-cracking-unit.json](../src/data/multiblocks/oil-cracking-unit.json), `rules.ts`, [resourcePlacement.ts](../src/model/site/resourcePlacement.ts)                                        | Левые/правые adders, средний агент, минимум 18 корпусов; общая ёмкость 7 люков, из них 2 обязательных. Индивидуальное зеркало X, совместимость ролей общих стен; сохранён native-сценарий пары                |
| Mega Oil Cracker                                                                                        | [structureAdapters.ts](../src/model/multiblock/structureAdapters.ts), `cracking-zones.rc2.generated.json`; `cracking-zones-rc2.mjs`                                                         | По 9 клеток в трёх зонах, обратимые боковые роли, отдельный средний агент; physical casing `gregtech:gt.blockcasings14@5`                                                                                     |
| Distillation Tower, Mega Distillation Tower, Dangote, Sparge Tower                                      | `structureAdapters.ts`, [distillation-tower.json](../src/data/multiblocks/distillation-tower.json), `tower-slots.rc2.generated.json`; `tower-slots-rc2.mjs`                                 | Порядок слоёв/выходов, завершение верхом, разрешённые faces. У обычной башни минимум корпусов `7 × height − 5`; у Mega секции 6 блоков, высота 30–54. Tower и distillery modes не взаимозаменяемы             |
| Fusion-контроллеры                                                                                      | `structureAdapters.ts`, `fusion-slots.rc2.generated.json`; `fusion-slots-rc2.mjs`                                                                                                           | Конкретные энергетические injector cells и их минимальные тиры, а не один универсальный LV люк                                                                                                                |
| Beam Mirror T1/T2, Splitter, Stabilizer, Crafter, Source Chamber                                        | [beamStructures.ts](../src/model/multiblock/beamStructures.ts), `beam-structures.rc2.generated.json`; `beam-structures-rc2.mjs`                                                             | T1/T2 — разные формы; required/skipped cells и направления фиксированных beam-интерфейсов. Source Chamber: вход item OR fluid, отдельный выход снизу                                                          |
| LINAC                                                                                                   | [linearAccelerator.ts](../src/model/multiblock/linearAccelerator.ts), `linear-accelerator.rc2.generated.json`; `accelerator-sections-rc2.mjs`                                               | BASE/LAYER/END, полные нечётные длины 17–135, default 19, две обязательные fluid cells. RC2 loop escape без конца не предлагается как рабочая форма                                                           |
| Assembly Line, Advanced Assembly Line                                                                   | [assemblyLine.ts](../src/model/multiblock/assemblyLine.ts), [dataInterfaces.ts](../src/model/multiblock/dataInterfaces.ts), `assembly-line.rc2.generated.json`; `assembly-sections-rc2.mjs` | FIRST/LATER, остановка Output Bus, длины 2–16, terminal alternatives, общая сумма Data Access/receivers не более 1. Defaults 16/5 сохраняются                                                                 |
| Circuit Assembly Line                                                                                   | [circuitAssemblyLine.ts](../src/model/multiblock/circuitAssemblyLine.ts), `circuit-assembly-line.rc2.generated.json`; `circuit-sections-rc2.mjs`                                            | FIRST/NEXT, длины 2–7, два направления роста, условный EV glass minimum и точные energy/output counts. Существующее направление роста не является зеркалом юнита этапа 3                                      |
| Data Bank                                                                                               | [dataBank.ts](../src/model/multiblock/dataBank.ts), `dataInterfaces.ts`, `data-bank.rc2.generated.json`; `data-bank-rc2.mjs`                                                                | Fixed core отдельно от service cells, wired/wireless adders, минимум входа/выхода. Recipe-data интерфейсы не являются computational интерфейсами                                                              |
| Dyson Swarm, Quantum Computer, два QoS Switch                                                           | [computation.ts](../src/model/multiblock/computation.ts), `computation.rc2.generated.json`; `computation-rc2.mjs`                                                                           | Контрольные клетки и caps, Rack только внутри Quantum, длины Quantum 4–16 / Static 2–18, ненулевой список Uncertainty вместо exact-one                                                                        |
| Water Pump                                                                                              | [steamWaterPump.ts](../src/model/multiblock/steamWaterPump.ts), `steam-water-pump.rc2.generated.json`; `steam-pump-rc2.mjs`                                                                 | Форма 3×3×4, единые Bronze/Steel frames, 9 корпусов, по одному Steam/Water hatch; Steam и Water фиксированные роли                                                                                            |
| Industrial Arc Furnace                                                                                  | [arcFurnace.ts](../src/model/multiblock/arcFurnace.ts), `arc-furnace.rc2.generated.json`; `arc-furnace-rc2.mjs`                                                                             | Порядок обхода StructureLib: первый Electrode Hatch dedicated, следующие — Input Bus. Registry/meta электродов и detector; порядок нельзя получить сортировкой координат                                      |
| Cryogenic Freezer, Volcanus                                                                             | [lockedFluidHatches.ts](../src/model/multiblock/lockedFluidHatches.ts), `rules.ts`                                                                                                          | Dedicated coolant lists, IV-люки 967/968, минимумы корпусов 46/6; пропускаемые клетки Freezer отличаются от обязательного AIR Volcanus                                                                        |
| HTGCR, оба Heat Exchanger, Target Chamber, pH/Temperature Purification                                  | [dedicatedHatches.ts](../src/model/multiblock/dedicatedHatches.ts), `rules.ts`                                                                                                              | Source letters/координаты, dedicated fields и обязательные ordinary lists. Одинаковая текстура/placeholder не даёт общей роли                                                                                 |
| Glass/energy ограничения                                                                                | [glass.ts](../src/model/multiblock/glass.ts), `structureAdapters.ts`: `REVIEWED_GLASS_*`, `REVIEWED_ENERGY_RULES`; `glass-variants{.rc2,.runtime}.generated.json`, `glass-variants-rc2.mjs` | Registry/meta стекла и слабейший тир; минимум стекла не всегда ограничивает standard energy. Исключение TFFT T10; Plasma Forge/Synchrotron/Manual Transformer требуют отдельной проверки uniform tiers/counts |
| Manual Transformer                                                                                      | `structureAdapters.ts`, [hatches/tiers.ts](../src/model/hatches/tiers.ts), [site/resourcePlacement.ts](../src/model/site/resourcePlacement.ts)                                              | 1–8 winding layers (высота 3–10), signed разница output/input tier и up/down; не путать с обычным электрическим соединением                                                                                   |
| Driller/Backfiller/Heating Pump, XL Turbines, Drone Centre, Essentia Smeltery, Superconductive Splitter | `structureAdapters.ts`: `minimumEnergy`, `REVIEWED_INTERFACE_COUNTS`                                                                                                                        | Сумма входных напряжений, условные output/muffler counts, minima специальных интерфейсов. Все ID перечислены в константах; форму Essentia Smeltery считать ограниченной                                       |
| Четыре Godforge-модуля, Space Elevator modules                                                          | `structureAdapters.ts`: `GODFORGE_MODULE_IDS` и `space-*` selector                                                                                                                          | Front disc отдельно от похожих задних корпусов; exoticizer требует оба типа выходов. Space modules используют конкретный casing и optional classic adder                                                      |
| LFTR, Chemical Plant, Reactor Fuel/Salt Processing                                                      | `structureAdapters.ts`: `thoriumReactor`, ExxonMobil/fuel branches; `rules.ts`: `REVIEWED_RULES`                                                                                            | Required AIR, количество выходов, casing metas и ограничения люков по тиру; ME/exotic альтернативы нельзя приравнивать к standard form                                                                        |

### Конкретные регистрации люков

Это метаданные блока `gregtech:gt.blockmachines`, закреплённые текущими исходниками и данными.
При обновлении сверять регистрацию и класс adder, а не только имя или нарисованный hull.

| Интерфейс                            | RC2 meta ID              | Источник в планировщике                                                                                                          |
| ------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Data Access EV / LuV / UV            | `145 / 146 / 147`        | [single-tiers.generated.json](../src/data/single-tiers.generated.json), `tools/game-dump/single-tiers.mjs`                       |
| Recipe-data wired input / output     | `15442 / 15443`          | Тот же реестр, `dataInterfaces.ts`                                                                                               |
| Recipe-data wireless input / output  | `15446 / 15447`          | Тот же реестр                                                                                                                    |
| Computation wired input / output     | `15440 / 15441`          | [computation.rc2.generated.json](../src/data/computation.rc2.generated.json)                                                     |
| Computation wireless input / output  | `15445 / 15444`          | Тот же реестр; порядок ID не совпадает с направлением передачи                                                                   |
| Uncertainty IV / ZPM, Rack UV        | `15430 / 15431`, `15450` | Тот же реестр                                                                                                                    |
| Beam input / output, filtered output | `10503 / 10504`, `3014`  | [beam-structures.rc2.generated.json](../src/data/beam-structures.rc2.generated.json), `beamStructures.ts`, `dedicatedHatches.ts` |
| Cryotheum / Pyrotheum IV             | `967 / 968`              | `lockedFluidHatches.ts`                                                                                                          |
| Steam ULV                            | `31040`                  | [steam-water-pump.rc2.generated.json](../src/data/steam-water-pump.rc2.generated.json)                                           |
| Electrode / Detector IV              | `14203 / 14204`          | [arc-furnace.rc2.generated.json](../src/data/arc-furnace.rc2.generated.json)                                                     |

## Совместимость планов и приёмка

Сохранять ID машин/ресурсов, исторические неявные размеры, ручные пределы, `role`, `outputSlot`,
`unitId`/`unitIds` и индивидуальные тиры люков. Несуществующее ручное назначение не удалять молча:
оно игнорируется при размещении с предупреждением и остаётся в истории. Планы без новых полей
читаются со старым поведением. Типичный default не следует менять в старом плане при смене тега.

Один физический люк обслуживает одну жидкость; общий люк учитывается в ёмкости каждой обслуживаемой
машины. При автоматическом назначении сначала каждой машине полный набор ресурсов, затем
распределение при нехватке ёмкости, с соблюдением минимума ролей. Роли берутся из импорта или
выбора пользователя. Эти правила и
инварианты Arrange/Optimize/Neat сохраняются при обновлении каталога.

Обновить ограничения и статусы на основании свидетельств **целевой версии**. Текущий
`scripts/catalog-status.mjs` читает RC2-реестры и требует совпадения их pack/sourceCommit;
для следующей версии нужно явно изменить источник таблицы и решений. Один положительный default
не позволяет убрать отдельное известное ограничение. До переключения таблицы текущие команды:

```sh
npm run catalog:status
npm run catalog:status -- --check
```

Собрать атлас и выполнить действующие проверки без повышения бюджетов и без ослабления тестов:

```sh
npm run atlas
npm run format
npm run format:check
npm run check
npm test
npm run test:invariant
npm run build
npm run size
npm run e2e
git diff --check
```

Property-тест остаётся на заданном детерминированном списке (машины с адаптерами ролей плюс 20
типичных); ради него не расширять аудит и не добавлять новые адаптеры. Пять
[эталонных планов](fixtures/) сохраняют метрики и визуальные проверки. Размер main не выше
400 КБ gzip, принятая цель — 385 КБ; worker 140 КБ. Таймауты менять только с объяснённой причиной.

Для отчёта указать изменённые формы/адаптеры, происхождение новых данных, результаты команд,
что исправлено и что осталось ограничением. При коммите перечислить файлы явно (`git add <файлы>`,
без `-A`); кэши, логи, `*.cpuprofile`, архивы и файлы более 50 МБ не включать. После отчёта —
остановка до подтверждения следующего этапа.
