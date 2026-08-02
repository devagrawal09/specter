# Support legacy Event commit tables

## Goal

Allow the current Effect-native SQLite Event Log to use databases created by
the earlier idempotency-key commit table without changing their schema.

## Scope

- In: detect the existing commit table shape, read commit boundaries, and
  append receipts using either the current or legacy columns.
- Dependency: Worklog uses this support to run current application code
  against its existing production database.
- Out: schema migrations, table rebuilds, data backfills, scoring changes, and
  compatibility for any other historical schema.

## Required behavior

- Preparing a database with the legacy `specter_event_commits` table leaves
  that table unchanged.
- Queries, idempotency checks, appends, and commit-boundary reads work with
  both supported table shapes.
- Legacy commit boundaries use `last_event_order` as their ordered version.
- New databases continue to use the current `commit_version` schema.
- Events and their commit receipt remain atomic in both modes.

## Tasks

- [ ] Add cached commit-table shape detection and legacy SQL paths.
- [ ] Test legacy preparation, append, duplicate detection, and commit reads.
- [ ] Run the package checks and a Worklog production test against a copy of
  the live database backup.
- [ ] Document the two supported commit table shapes in the package README.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/sqlite test`
- `pnpm --filter @specter-ts/sqlite typecheck`
- `pnpm --filter @specter/worklog build`
- `pnpm check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
