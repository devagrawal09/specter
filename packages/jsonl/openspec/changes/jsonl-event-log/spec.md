# JSONL Event Log adapter

## Goal

Add `@specter-ts/jsonl`, an Event Log adapter that stores one Event Log in one
append-only JSONL file, and a Slice Store that keeps each Slice's state and
cursor in one JSON file. This lets an application run many small Specter apps,
one per session, each with its own directory and no database, and reopen a
session without replaying Reactions through its whole history.

## Scope

- In: `createJsonlEventLog` and `createJsonlEventLogLayer`;
  `createJsonlSliceStoreService` and `createJsonlSliceStoreLayer`; their
  tests, the package README, and a benchmark script under `bench/` for per-app
  construction and reopen cost.
- Out: Reaction schedulers or outboxes backed by files; incremental or
  per-key Slice State storage for large State; cross-process locking or
  multi-writer support; compaction, snapshots, or log rotation; any change to
  the core `EventLogService` or `SliceStoreService` contracts.
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

### JSON Slice Store

- One service serves every Slice bound to its Tag and keeps each Slice in
  `<directory>/<sliceName>.json` as `{ "cursor": n, "state": … }`. Slice names
  must match `[A-Za-z0-9_-]+`.
- The first read or transaction for a Slice reads its file once; later reads
  are served from memory. A missing file is `createState()` with cursor 0. A
  malformed file fails the read with `JsonlSliceStoreFailure`.
- Transactions are serialized per Slice by a process-local semaphore and run
  against a fresh decode of the committed State, like the memory Store.
- A transaction that published a cursor writes the whole document to
  `<sliceName>.json.tmp` and renames it over the Slice file, then makes the
  new State and cursor visible. A failed transaction, or one that did not
  publish a cursor, writes nothing. Cursors must not move backwards.
- State must be JSON-serializable; reads return decoded JSON both before and
  after a reopen. `fsync` (file and directory) is off by default.
- The whole State is written on every commit, so the Store suits small State
  such as Reaction decisions and session metadata. Large, accumulating State
  should use memory Stores (rebuilt from the log) or a database Store.

## Tasks

- [x] Implement the adapter with Node `fs` only.
- [x] Run the shared Event Log conformance suite, with and without fsync.
- [x] Add reopen, truncated-trailing-line, malformed-line, CAS, idempotency,
      and non-JSON payload tests.
- [x] Add the package README.
- [x] Add `bench/app-construction.ts` (not a test).
- [x] Add the JSON Slice Store with Node `fs` only.
- [x] Run the shared Slice Store conformance suite, with and without fsync.
- [x] Add reopen, rollback-leaves-file-unchanged, non-JSON State, malformed
      file, Layer, and app-level "reopen does not rerun Reaction effects"
      tests.
- [x] Let the bench choose memory or JSON Slice Stores (`STORE=memory`).
- [ ] Decide whether Reaction cursor writes for commits with no relevant
      Events need a cheaper path (core batching or an append-based Store).
- [ ] Decide whether the package joins the release scripts.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/jsonl test`
- `pnpm --filter @specter-ts/jsonl typecheck`
- `pnpm --filter @specter-ts/jsonl build`
- `node scripts/validate-openspec.mjs` (from the repository root)
