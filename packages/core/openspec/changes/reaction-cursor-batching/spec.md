# Batch Reaction cursor advances past irrelevant commits

## Goal

A Reaction pass currently opens a Slice Store transaction and publishes the
Reaction cursor for every Event Log commit, even when the commit contains no
Event type the Reaction applies. File- and row-backed Slice Stores then pay one
durable write per Reaction per Command for no observable change. Make an
irrelevant commit never cause its own Store transaction while keeping Reaction
delivery semantics unchanged.

## Scope

- In: the Reaction pass in `src/effect/runtime.ts`, its tests, and the lasting
  Reaction wording in `docs/architecture/{runtime,event-sourcing,plugins}.md`,
  `docs/api-reference/core-adapters.md`, and `CONTEXT.md`.
- Out: Slice Store, Event Log, and Reaction Scheduler adapter contracts; Query
  and Command catch-up; `@specter-ts/reaction-outbox`, `@specter-ts/sqlite`,
  and `@specter-ts/postgres` behavior (they keep working unchanged and need no
  change of their own); a configurable flush threshold; flushing cursors on
  shutdown.

## Required behavior

- A commit is relevant to a Reaction when it contains an Event type with one of
  the Reaction's apply handlers. `handle` only observes State built by those
  handlers, so nothing else can change its output. Only relevant commits run
  apply handlers, `handle`, and the Plugin, and only they open a Slice Store
  transaction. That transaction publishes the commit version, which also covers
  every irrelevant commit skipped before it.
- Irrelevant commits are skipped without a transaction. The runtime remembers a
  process-local skip range per Reaction so later passes do not re-read them.
  When the skipped tail after the durable cursor reaches 256 Event Log orders at
  the end of a pass, one transaction publishes the cursor to the last scanned
  version. That transaction never moves the cursor backwards and never jumps
  over a cursor older than the skip range it covers.
- A Reaction with no apply handlers never runs `handle` (unchanged); every
  commit is irrelevant to it, so its cursor only advances through the
  256-order flush.
- After a crash or restart, a Reaction may re-read the unflushed skipped tail
  from the Event Log. Re-reading irrelevant commits runs no handler, Plugin, or
  transaction, so it has no side effects.
- Preserved: at-least-once delivery once per relevant commit with stable
  `deliveryId = "<reaction>:<commitVersion>"`, `throughOrder`, and
  `scheduledAt`; commit order; failure rolls back State and cursor, leaving the
  cursor at or before the last committed relevant commit;
  `execution.reactions` completion; startup catch-up; outbox enqueue atomic
  with the relevant commit's cursor publication.
- Changing a Reaction's apply handlers can make commits inside the unflushed
  skipped tail relevant on the next run. Reset or rename the Reaction Store
  when its applied Event types change.

## Tasks

- [x] Skip irrelevant commits without a Store transaction and track the skip
  range per Reaction.
- [x] Flush the skipped tail once it reaches the threshold, with a
  `specter.reaction.cursor <name>` span.
- [x] Tests: counting Store wrapper shows no transaction for irrelevant commits
  (100 commits, 10 relevant), relevant commits deliver once, crash between
  commits recovers without duplicate side effects, threshold flush.
- [x] Replace the fixed 10 ms sleep in the native Stream test with a wait for
  the first emission; the extra Reaction tests made that race flaky.
- [x] Update `docs/architecture/runtime.md`, `event-sourcing.md`, `plugins.md`,
  `docs/api-reference/core-adapters.md`, and `CONTEXT.md`.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/core exec vitest run src/effect/runtime.test.ts`
- `pnpm check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `node scripts/validate-openspec.mjs`
