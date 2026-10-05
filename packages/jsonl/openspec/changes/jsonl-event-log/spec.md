# JSONL Event Log adapter

## Goal

Add `@specter-ts/jsonl`, an Event Log adapter that stores one Event Log in one
append-only JSONL file. This lets an application run many small Specter apps,
one per session, each with its own log file and no database.

## Scope

- In: `createJsonlEventLog` and `createJsonlEventLogLayer` in packages/jsonl,
  their tests, the package README, and a benchmark script under `bench/` for
  per-app construction cost.
- Out: Slice Stores, Reaction schedulers, or outboxes backed by JSONL;
  cross-process locking or multi-writer support; compaction, snapshots, or log
  rotation; any change to the core `EventLogService` contract.
- Dependencies: `@specter-ts/core` (Event Log contract and conformance suite),
  `@specter-ts/memory` and `@specter-ts/spec` for the benchmark only. Root
  workspace scripts and `docs/api-reference` are wired by a separate change in
  the repository root OpenSpec scope.

## Required behavior

- Each line is one complete commit (version, committedAt, optional
  idempotencyKey and fingerprint, and its Events), so a line is the atomic
  commit boundary.
- Opening reads the file once and builds an in-memory index; appends only add
  lines. A missing file is an empty log and parent directories are created.
- Appends are serialized by a process-local semaphore. Expected-version
  conflicts and idempotency duplicates/conflicts behave like the SQLite
  adapters.
- `fsync` is off by default and optional per log.
- An unterminated trailing line is removed on open and reported as
  `discardedTrailingBytes`; other malformed or non-contiguous lines fail the
  open.
- A failed write truncates the partial line so later appends start on a line
  boundary.
- Payloads must be JSON-serializable; reads return decoded JSON both before and
  after a reopen.

## Tasks

- [x] Implement the adapter with Node `fs` only.
- [x] Run the shared Event Log conformance suite, with and without fsync.
- [x] Add reopen, truncated-trailing-line, malformed-line, CAS, idempotency,
      and non-JSON payload tests.
- [x] Add the package README.
- [x] Add `bench/app-construction.ts` (not a test).
- [ ] Decide whether the package joins the release scripts.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/jsonl test`
- `pnpm --filter @specter-ts/jsonl typecheck`
- `pnpm --filter @specter-ts/jsonl build`
- `node scripts/validate-openspec.mjs` (from the repository root)
