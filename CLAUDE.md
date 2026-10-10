# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

GTNH Base Planner: a fully client-side 3D layout tool (TypeScript, Svelte 5, Three.js, Vite) that packs GregTech: New Horizons multiblocks so compatible casings share walls, places hatches and routes pipes/cables. Structures follow GT:NH 2.9.0-beta-3 (GT5-Unofficial 5.09.54.133). No backend: plans live in `localStorage` and share links carry the compressed plan in the URL fragment (`#p=` machine plan, `#s=` template).

## Commands

Node 24 (`.node-version`).

```sh
npm run dev            # Vite dev server
npm run check          # svelte-check (type-checks TS and Svelte), --fail-on-warnings (warnings fail CI)
npm test               # Vitest (src/**, tools/**, scripts/** *.test.ts), node environment
npx vitest run src/model/site/router.test.ts      # one file
npx vitest run -t "name of test"                  # by test name
PERF=1 npm test        # also run the wall-clock performance assertions (skipped by default)
npm run e2e            # Playwright; first time: npx playwright install chromium
npm run build          # npm run atlas (texture atlas) + vite build -> dist/
npm run size           # bundle size budget (after build; scripts/check-size.mjs)
npm run format         # Prettier (singleQuote, printWidth 110); CI runs format:check
```

CI (`.github/workflows/ci.yml`) runs, in order: format:check, check, test, `npm audit --omit=dev --audit-level=high`, build, size, e2e.

E2E builds with `E2E_HARNESS=1`, which adds the standalone `renderer-harness.html` / `detailed-harness.html` pages (never deployed); the port is derived from the checkout path so parallel worktrees don't collide. `e2e/screenshots/` holds reference screenshots.

## Architecture

Two views share the model code:

**Machine view (one multiblock × N units)** — `createPipeline` in `src/ui/pipeline.ts` returns a plain synchronous `run(plan, pipesOn, cablesOn, below)` function. Each step is a single-entry memo cache (`stage<T>()`) keyed by a string from `src/ui/pipelineKeys.ts`; only the exported `build` that calls `run` is a Svelte `derived` store. Steps:
packing (`model/layout/`) → hatch placement (`model/hatches/`, via `resolveLayout` / `resolveRoutedLayout` in `model/plan.ts`) → wall stats (`model/walls.ts`) → pipe/cable routing (`model/routing/`) → render model (`model/scene.ts` → `SceneModel`) → `render/renderer.ts`.
If hatches don't fit, looser layouts are tried (`layoutCandidates` in `model/layout/packer.ts`). With pipes or cables on and an automatic layout (no `manualUnits`), routing already happens inside the hatch step: `resolveRoutedLayout` routes while choosing the layout, loosening it (`loosenings` in `model/layout/variants.ts`) until every hatch connects, and the routing step reuses those nets instead of calling `routePipes` again. That is why `hatchKey` includes the routed kinds and `below` (connections from below, which also changes `placeHatches` options). **Adding an input to a step means adding it to that step's key** (`pipelineKeys.test.ts` checks this). Model functions are injected via `PipelineDeps` for tests.

**Template view ("site": groups of multiblocks linked by resources)** — `src/model/site/`. `createSiteBuilder` (`site/build.ts`) derives demand, places groups (per-group cache, so moving one group doesn't repack others), places edge ports, builds resource nets and routes them (`site/router.ts`, `site/nets.ts`), then builds the scene. Builds run in a Web Worker (`ui/siteWorker.ts`, controlled by `ui/siteWorkerController.ts`, wired up in `ui/sitePipeline.ts`) with a main-thread fallback; groups render before pipes, and routing is held while the user drags. ARRANGE (`site/arrange.ts`) is a plain layout along the flow; OPTIMIZE (`site/optimize.ts`, simulated annealing in `site/anneal.ts`) runs against a time budget (`budgetMs`, clock injectable via `now`). Undo/redo: `ui/siteHistory.ts`.

Other areas:

- `src/model/` is pure, deterministic logic with colocated `*.test.ts`; shared types live in `model/core|multiblock|plan|render/types.ts`. Coordinates follow Minecraft: X = east, Y = up, Z = south.
- `src/import/gtnhplanner.ts` turns a GTNH Planner export into a template; machine name mapping in `src/data/gtnhplanner-machines.ts`, plus GT machine types from `src/data/gt-machine-types.generated.json`. Background notes in `docs/gtnhplanner-integration.md`.
- `src/share/` — share-link codecs (`codec.ts`, `siteCodec.ts`) and `localStorage` persistence. Changing plan/site shapes affects saved plans and existing links.
- `src/state/` — Svelte stores (`store.ts` machine plan, `site.ts` template).
- `src/render/` — Three.js; SIMPLE (flat colours) and DETAILED (texture atlas via `render/textures.json`) materials.
- UI strings live in `src/i18n/en.ts`.

## Multiblock data

Each multiblock is `src/data/multiblocks/<id>.json` (type `MultiblockDef` in `src/model/multiblock/types.ts`), picked up by `import.meta.glob` in `src/data/catalog.ts` — no registry to edit. The README's "Data model" section documents every field (`layers[y][z]` strings, `~` controller, `-` must-be-air, legend, hatches, `resize`).

- Entries with `"generated": true` come from the game dump (`tools/game-dump/`) — don't edit by hand. To take one over, remove `generated`; the dump never overwrites a class covered by a hand-made entry.
- New block ids: register in `src/data/blocks.ts` (flat colour) and map textures in `src/render/textures.json`.
- Variable-size multiblocks store their smallest form plus one repeating slab (`sizedDef` in `src/model/resize.ts`). Never change a `resize.default`: plans without a size use it.
- StructureLib shapes read from GT sources must be mirrored in X (the shape's first axis runs to the controller's right seen from its front).
- `npm run atlas` regenerates `public/textures/atlas.png` and `src/render/textures.json` from `tools/texture-sources/` (offline, deterministic). Textures are LGPL-3.0 (see `ATTRIBUTION.md`); vanilla Minecraft blocks stay flat-coloured.
- `tools/gt-source/` reads a GT5-Unofficial checkout (see its README); `src/data/gt-shapes.generated.json` covers four entries the dump can't build, checked by `src/data/gt-structures.test.ts`.

## Conventions

- The README documents user-facing behaviour in detail; keep it in sync when behaviour changes.
- Deployed by Cloudflare Pages on push to `main`; `vite.config.ts` uses `base: './'` so builds work under a sub-path.

## Subagents (`.claude/agents/`, tracked in git; the rest of `.claude/` stays ignored)

| Agent                      | Model  | Edits code | Area                                                                                     |
| -------------------------- | ------ | ---------- | ---------------------------------------------------------------------------------------- |
| `code-explorer`            | haiku  | no         | Locating files, symbols, callers, dependencies; no judgements                            |
| `developer`                | sonnet | yes        | Implementing one approved task: features, refactors, fixes, tests, data                  |
| `architecture-reviewer`    | sonnet | no         | `src/ui`, `src/state`, TS/Svelte/Vite config                                             |
| `algorithms-reviewer`      | sonnet | no         | `src/model/**`: geometry, packing, wallsharing, hatches, routing, site, Arrange/Optimize |
| `graphics-reviewer`        | sonnet | no         | `src/render/**`, `Scene.svelte`, atlas and size scripts                                  |
| `qa-reviewer`              | sonnet | no         | Tests, `src/import`, `src/share`, persistence, undo history, regressions                 |
| `gtnh-expert`              | sonnet | no         | Game rules vs GT5-Unofficial 5.09.54.133 and repo data                                   |
| `algorithms-deep-reviewer` | opus   | no         | One hard, escalated `src/model/**` question; only with the user's permission (see below) |

Built-in agent types (`general-purpose`, `Explore`, `Plan`) inherit the main agent's Opus model. Use the project agents above instead; if a built-in one is truly needed, pass `model: "sonnet"` or `"haiku"`.

## Agent orchestration

The main agent (Opus) is the lead architect and orchestrator. It owns: analysing requirements and audit results, architectural decisions, writing and getting approval for the development plan, splitting it into tasks and assigning them, quality control, resolving contradictions, acceptance, and talking to the user about anything that needs their decision. Final architectural decisions are made by the main agent only; subagents propose, they do not decide.

### Workflow for an approved task

1. **Plan.** For a major task (new feature, multi-file refactor, change to plan/site shapes or share codecs), present a plan and wait for the user's confirmation. Do not start the next major task without confirmation; inside an approved task, act on your own (delegate, review, fix, re-verify) and come back only for real decisions.
2. **Explore** (if needed): `code-explorer` (Haiku) for locating code; read small things directly.
3. **Implement:** `developer` (Sonnet) gets a self-contained brief: goal, files/area, the agreed design, what "done" means.
4. **Review:** an independent Sonnet reviewer for the touched area (`algorithms-reviewer`, `architecture-reviewer`, `graphics-reviewer`, `qa-reviewer`, `gtnh-expert` for data/game rules), started fresh, with the diff and the brief but not the developer's reasoning. Pick one reviewer whose scope covers the change; add a second only when the change spans two scopes.
5. **Fix** findings via `developer` (continue the same one with `SendMessage` when it still has the context), re-review only what changed.
6. **Accept:** the main agent checks the diff and command output itself, runs `npm run build` when the task needs it, commits only when the user asked.

### Delegation policy

- Simple research (where is X, who calls Y, what imports Z) → `code-explorer` (Haiku).
- Implementation, refactoring and tests → `developer` (Sonnet). The main agent does not write large amounts of routine code itself when it can be delegated; it keeps small edits (a few lines, config, docs) and the design-critical core where writing a brief would cost more than the code.
- Routine analysis → the Sonnet reviewer for the area: architecture → `architecture-reviewer`, rendering → `graphics-reviewer`, tests/import/share → `qa-reviewer`, game mechanics → `gtnh-expert`, geometry/wallsharing/hatches/routing → `algorithms-reviewer`.
- Hard model problems (router convergence, nondeterminism, complexity blow-ups, contradictory findings, items marked `ESCALATE: algorithms-deep-reviewer`) are analysed by the main agent itself by default. `algorithms-deep-reviewer` or any other Opus subagent runs only after the user agrees, with a stated reason and one narrow question per call.

### Rules

1. The main agent does not write large volumes of routine code when `developer` (Sonnet) can do it.
2. Simple research goes to `code-explorer` (Haiku).
3. Every implementation is checked by an independent Sonnet reviewer (a fresh agent, never the one that wrote the code).
4. Do not run several agents when the task is simple enough for one, and do not delegate trivial operations when the delegation overhead exceeds the work.
5. No repeated full audit after each task: review only the areas the change touched. A full audit runs only when the user asks for one.
6. Parallel code changes only when the agents touch disjoint files, or each works in its own git worktree (`isolation: "worktree"`). Read-only agents may run in parallel freely, with disjoint scopes.
7. No Opus subagents (`algorithms-deep-reviewer`, or built-in agents left on the inherited model) without the user's permission.
8. Final architectural decisions are made by the main agent.
9. Do not start the next major task without the user's confirmation; inside an approved task, act independently.

Also:

- Reviewer agents are read-only and never edit application code; only `developer` edits, and only within its brief.
- Every finding must carry class (CONFIRMED / RISK / IMPROVEMENT), severity, `path:line`, evidence and reproduction steps.
- Do not treat subagent conclusions or "tests pass" claims as verified facts: check the diff and command output. Re-check High findings against the code yourself; escalate unresolved or contradictory findings to the main agent.
- A Critical finding is reported only after independent verification that does not reuse the original reasoning: the main agent reproduces or refutes it by its own trace or experiment, or hands the claim and its location to a fresh Sonnet reviewer for the area. `algorithms-deep-reviewer` verifies only with the user's permission (rule 7); a Critical finding from it is verified by the main agent directly, not by another Opus agent.
- Do not run two Opus agents on the same question: if the main agent analyses it, it is not also delegated, and vice versa.
- Only the main agent runs `npm run build`, or permits `qa-reviewer` to run `npm run e2e` (Chromium must already be installed). E2E rewrites the tracked `e2e/screenshots/`; restore them afterwards with `git checkout -- e2e/screenshots`.
- Do not modify source code during an audit without user approval.

### Responsibility

The main Opus agent is responsible for the final technical decisions and the overall quality of the result.
