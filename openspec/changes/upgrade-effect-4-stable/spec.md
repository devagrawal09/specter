# Upgrade Effect to 4.0.1 stable

## Goal

Move every workspace and the generated starter from the `effect@4.0.0-beta.78`
pre-release to the stable `effect@4.0.1` release (npm `latest`), so published
Specter packages and new projects depend on a supported Effect line.

This belongs at repository scope because one shared dependency pin changes
across all publishable packages, the reference apps, and the `create-specter`
template in a single coordinated release step. No app or package behavior
changes, so no per-workspace OpenSpec change is needed.

## Scope

- In: `effect` pins in `packages/core`, `packages/memory`, `packages/sqlite`,
  `packages/sqlite-node`, `packages/postgres`, `packages/reaction-outbox`
  (`peerDependencies` and `devDependencies`); `packages/create-specter/template`;
  `apps/reference`, `apps/booking-reference`, `apps/threadplane-reference`,
  `apps/specter-code`, `apps/narayan-ai`, `apps/colonybench-reference`,
  `apps/worklog`, `apps/last-lantern`, `apps/personal-mail`; `pnpm-lock.yaml`;
  the `minimumReleaseAgeExclude` entry pnpm adds while `effect@4.0.1` is
  younger than the release-age window.
- Out: refactoring Effect usage beyond what compiles and passes on 4.0.1;
  adopting new 4.0.x APIs; adding `@effect/*` companion packages; changing any
  Slice contract, Event, or Scenario.

## Required behavior

- Every `effect` pin in the workspace and starter template is exactly `4.0.1`.
- The full validation baseline and the generated-starter check pass with no
  source changes.
- The `minimumReleaseAgeExclude` entry for `effect@4.0.1` is removed once the
  release is older than the pnpm release-age window.

## Tasks

- [x] Root: bump all `effect` pins to `4.0.1` and refresh `pnpm-lock.yaml`.
- [x] Root: confirm no source changes are needed (`pnpm typecheck`).
- [x] Root: run `pnpm check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build`.
- [ ] Root: run `pnpm verify:starter` where npm and Playwright browsers are
      available.
- [x] No lasting documentation names the Effect version; nothing to update.
- [ ] Root: drop the `effect@4.0.1` `minimumReleaseAgeExclude` entry when it
      is no longer needed.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm typecheck`
- `pnpm test`
- `pnpm verify:starter`
- `node scripts/validate-openspec.mjs`
