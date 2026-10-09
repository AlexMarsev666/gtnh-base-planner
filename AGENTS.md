# Repository Guidelines

## Project Structure & Module Organization

This GTNH base planner is a client-side TypeScript, Svelte 5, Three.js, and Vite application.

- `src/model/`: pure geometry, packing, hatch placement, routing, and template (`site/`) logic; shared types live in domain subfolders.
- `src/ui/`, `src/state/`, `src/i18n/`: components, application state, and UI strings.
- `src/render/`: Three.js rendering and texture mappings.
- `src/data/`, `src/import/`, `src/share/`: catalog definitions, GTNH Planner import, persistence, and share codecs.
- Unit tests sit beside source files; browser tests live in `e2e/`.
- `public/` contains static assets; `tools/` and `scripts/` contain offline data and atlas tooling. `docs/` holds integration notes.

## Build, Test, and Development Commands

Use Node.js 24 LTS and `npm ci` to install locked dependencies.

- `npm run dev`: start Vite with hot reload.
- `npm run check`: run strict TypeScript and Svelte checks; warnings fail.
- `npm test`: run Vitest unit tests.
- `npx playwright install chromium`: install the browser before the first E2E run.
- `npm run e2e`: run Playwright against an automatically built preview server.
- `npm run build`: regenerate the texture atlas, then build into `dist/`.
- `npm run preview`: serve the production build locally.
- `npm run size`: check build size budgets after building.
- `npm run format` / `npm run format:check`: apply / verify Prettier formatting.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, semicolons, and Prettier's 110-character print width. Use `import type` for type-only imports. Name Svelte components in PascalCase, functions and variables in camelCase, and multiblock JSON files with stable kebab-case IDs. Keep model logic independent of UI and rendering.

## Testing Guidelines

Name Vitest files `*.test.ts` and Playwright files `e2e/*.spec.ts`. Add regression tests for changed behavior, especially routing, geometry, imports, and share decoding. No numeric coverage threshold is configured. Before submitting, run formatting, type checks, unit tests, build, size checks, and E2E tests; CI also audits production dependencies.

## Commit & Pull Request Guidelines

Recent commits use descriptive imperative subjects, such as `Test malformed site links and files`; no mandatory prefix appears. Keep commits focused. PRs should explain the behavior change, relevant issues, and validation performed. Include screenshots for visible UI changes.

## Catalog & Asset Changes

Do not hand-edit entries marked `generated: true`; follow `tools/game-dump/README.md`. Register new block IDs in `src/data/blocks.ts` and texture mappings in `src/render/textures.json`. Preserve saved-plan IDs and resize defaults. Maintain third-party attribution in `ATTRIBUTION.md`.
