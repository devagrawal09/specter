# JSONL Reaction outbox Store

## Goal

Apps that run one small Specter app per session with files only can wrap slow
Reaction Plugins with `withReactionOutbox` without losing a queued job when
the process crashes after the Reaction cursor advanced. The memory outbox
loses it; `@specter-ts/jsonl` gets a file-backed outbox Store.

## Scope

- In: `createJsonlReactionOutboxStore` in `packages/jsonl`, an append-only
  JSONL journal of job transitions with an in-memory index rebuilt on open;
  the Event Log's lock-file, `fsync`, torn-tail, and failed-write conventions
  (shared lock helper); release of attempts left running on open; the
  optional `subscribe` and `renewLease` Store capabilities; tests and docs.
- Out: journal compaction or rewrite tooling, multi-process access, atomic
  enqueue-with-cursor across files, a file-backed Reaction scheduler.
- Depends on `packages/reaction-outbox` (Store contract, worker wake-up and
  lease heartbeat); that package carries its own change.

## Required behavior

- Implements the `ReactionOutboxStore` contract with the SQLite Store's
  semantics: idempotent enqueue by key, ordered atomic claims with
  deterministic attempt ids, lease-guarded transitions that fail with
  `ReactionOutboxLeaseLostError`, expired-lease requeue, dead-letter replay.
- The enqueue line is written (and synced with `fsync: true`) before the JSON
  Slice Store renames the Reaction cursor document. A crash between the two
  keeps the job; the replayed enqueue of the same `deliveryId` returns
  `created: false`, also after the job completed and after reopen.
- One writer per file through `<path>.lock`; attempts left `running` by an
  earlier open are released at once on open and listed in `releasedOnOpen`.
- `subscribe` fires after enqueue and dead-letter retry; `renewLease` extends
  the active attempt's lease.
- README documents the format, crash windows, `fsync` requirement, and
  journal growth with the rule for a safe rewrite.

## Tasks

- [x] Add the Store, shared lock helper, and exports.
- [x] Mirror the SQLite Store tests (with and without `fsync`), plus reopen,
      released running jobs, torn and malformed journals, lock enforcement,
      write failures, duplicate-enqueue no-op, worker wake-up, and
      enqueue-versus-cursor crash windows with the JSON Slice Store and an app.
- [x] Update `packages/jsonl/README.md`, `docs/api-reference/persistence.md`,
      and `docs/api-reference/reaction-outbox.md`.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/reaction-outbox build`
- `pnpm --filter @specter-ts/jsonl test`
- `pnpm --filter @specter-ts/jsonl typecheck`
- `node scripts/validate-openspec.mjs`
