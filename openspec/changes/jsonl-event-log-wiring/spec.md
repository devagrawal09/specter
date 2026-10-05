# Wire the JSONL Event Log package into the workspace

## Goal

Make the new `@specter-ts/jsonl` package part of the repository build, test,
and typecheck baseline, and list it in the persistence API reference.

## Scope

- In: root `package.json` `build:publishable`, `test`, and `typecheck` filters;
  `docs/api-reference/README.md` and `docs/api-reference/persistence.md`.
- Out: adapter behavior (owned by the packages/jsonl change
  `jsonl-event-log`); release scripts (`release:*`,
  `scripts/verify-release-auth.mjs`) until maintainers decide to publish it.

## Required behavior

- `pnpm build`, `pnpm test`, and `pnpm typecheck` include `@specter-ts/jsonl`.
- The persistence reference documents the JSONL exports, durability default,
  single-writer rule, and trailing-line recovery.

## Tasks

- [x] Add `--filter @specter-ts/jsonl` to the root build, test, and typecheck scripts.
- [x] Document the package in the API reference.
- [ ] Decide on release script inclusion.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm check`
- `pnpm typecheck`
- `pnpm test`
- `node scripts/validate-openspec.mjs`
