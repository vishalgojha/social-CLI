# TypeScript Migration

## Goal

Move the repository to **full TypeScript source** and keep JavaScript as compile artifacts only.

## Current guardrails

- `npm run ts:migration-guard`
  - Fails if first-party `.js` file count grows above baseline.
  - Fails if `.js` appears inside TS-native roots (`cli/`, `core/`, `executors/`, `utils/`).
- `npm run quality:check` runs migration guard in CI/release.

## Migration order

1. `scripts/` and `test/` runners
2. `commands/`
3. `lib/`
4. `bin/`
5. Remaining legacy utility modules

## Working rules

- Convert in vertical slices (feature by feature), not giant rewrites.
- Keep behavior identical first; do not mix feature changes with language migration.
- After each slice:
  - run `npm run quality:check`
  - lower `max_js_files` in `scripts/ts-migration-baseline.json`
  - commit with explicit migration note

## Done definition

- First-party source `.js` count is `0`.
- Entrypoints execute from compiled TypeScript output.
- CI/release enforce no source JS regressions.
