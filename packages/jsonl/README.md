# `@specter-ts/jsonl`

File-backed persistence for Specter without a database: an append-only JSONL
Event Log, a JSON file Slice Store, and a JSONL Reaction outbox Store. One
directory can hold one app's data, so an application can keep a separate app
per session, document, or tenant.

```ts
import {
  createJsonlEventLogLayer,
  createJsonlSliceStoreLayer,
} from '@specter-ts/jsonl'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import { Layer } from 'effect'

const directory = `data/sessions/${sessionId}`
const dependencies = Layer.mergeAll(
  createJsonlEventLogLayer({ path: `${directory}/events.jsonl` }),
  createJsonlSliceStoreLayer(SessionStore, createSessionState, {
    directory: `${directory}/slices`,
  }),
  createImmediateReactionSchedulerLayer(),
)
```

## Event Log

`createJsonlEventLog({ path })` returns the Event Log service directly, with a
`close()` method. `createJsonlEventLogLayer` opens the file when the Layer is
built and closes it when the Layer scope ends, for example on `app.close()`.

### Format

Each line is one commit:

```json
{"version":2,"committedAt":"…","idempotencyKey":"…","fingerprint":"…","events":[{"id":"…","order":1,"type":"…","payload":{},"recordedAt":"…"},…]}
```

A line boundary is the atomic commit boundary, so `commitsAfter`, `findCommit`,
and idempotent receipts need no second file. Event payloads must be
JSON-serializable; values are returned as decoded JSON, both before and after a
reopen.

### Behavior

- Opening reads the whole file once and keeps an in-memory index of Events,
  commits, and idempotency keys. Reads never touch the file; appends only add
  lines. Memory use grows with the log.
- A missing file is an empty log. Parent directories are created.
- Appends are serialized in the process. Expected versions behave like the
  SQLite adapters. A known idempotency key returns the stored commit, with its
  original fingerprint, as a duplicate; the runtime decides whether a changed
  fingerprint is a conflict (`idempotencyMode: 'exact'`).
- One writer per file. Opening creates `<path>.lock` exclusively (it holds the
  opener's process id) and `close()` removes it; a second open of the same
  path in the process, or while the lock file exists, fails. A lock file left
  by a crashed process is reported with its path and never taken over: delete
  it only after confirming no process uses the log.
- `fsync` is off by default. Without it, a commit survives a process crash but
  may be lost if the machine or operating system fails before the page cache
  is flushed. Use this default only when final facts are also recorded
  somewhere authoritative. Pass `fsync: true` to flush every append.
- Opening validates every complete line before changing anything; a malformed
  or non-contiguous line fails the open and leaves the file untouched. Bytes
  after the last newline are then either a whole valid commit whose newline
  was lost, which is kept and terminated, or a write interrupted by a crash
  (the start of a commit line that is not valid JSON) that no caller saw
  succeed, which is removed and reported as `discardedTrailingBytes`. Any
  other trailing text fails the open without modifying the file.
- A failed write truncates its partial line so the next append starts on a
  line boundary. If that truncate also fails, the log refuses every later
  append with an `EventLogFailure('append')` whose cause is an
  `AggregateError` holding both errors; close and reopen it to recover.
- `query(afterOrder, …)` returns Events with `order > afterOrder`, like the
  other adapters, so `NaN` matches nothing.

## Slice Store

`createJsonlSliceStoreService(createState, { directory })` returns a Slice
Store service; `createJsonlSliceStoreLayer(tag, createState, { directory })`
provides it for a Store Tag. Like the memory Store, one service serves every
Slice bound to the Tag, and each Slice gets its own file:

```text
data/sessions/<id>/slices/autoApproveReadTools.json
{"cursor":902,"state":{"created":true,"toolCalls":{}}}
```

- The first read or transaction for a Slice reads its file once; later reads
  come from memory. A missing file is `createState()` with cursor 0. A Slice
  that never publishes a cursor, for example a Command Slice with no `apply`
  handlers, never gets a file.
- Transactions are serialized per Slice in the process and start from a fresh
  decode of the committed State. When a transaction publishes a cursor, the
  Store writes `{ cursor, state }` to `<sliceName>.json.tmp` and renames it
  over `<sliceName>.json` before the new State becomes visible. A crash leaves
  the previous or the new document, never a mix. A failed transaction, or one
  that publishes no cursor, does not touch the file.
- Reaction cursors survive a restart, so reopening an app does not run
  Reactions again for commits they already handled. A Reaction Plugin runs
  inside the transaction, before the write: if the process dies between the
  two, that commit's Reaction runs again on the next open.
- Cursors must not move backwards; a malformed Slice file fails the read with
  `JsonlSliceStoreFailure`. A leftover `<sliceName>.json.tmp` from a crash is
  overwritten by the next write.
- State must be JSON-serializable and is returned as decoded JSON, both before
  and after a reopen. A `Map` or `Set` anywhere in State fails the write
  instead of being stored as `{}`; use plain objects or arrays. Slice names
  must match `[A-Za-z0-9_-]+`.
- `fsync` is off by default. Pass `fsync: true` to flush the file and its
  directory on every commit.
- The process that opens the directory must be its only writer.

### Durability with the Event Log

A Slice cursor is only as durable as the Event Log commits it points at. With
`fsync: true` on the Slice Store but not on the Event Log, an operating-system
crash can keep a synced cursor while losing the unsynced log tail. New commits
then reuse those orders, and the Slice skips them as already applied. Enable
`fsync: true` on both, or on neither when a process crash is the only failure
you need to survive.

The Slice Store cannot see the Event Log, so the check belongs to the app:
after opening, a cursor greater than the log's `currentVersion` means the two
diverged and the Slice file must be rebuilt or removed.

```ts
const version = yield* eventLog.currentVersion
const cursor = yield* store.read('autoApproveReadTools', (_state, cursor) =>
  Effect.succeed(cursor),
)
if (cursor > version) throw new Error('Slice is ahead of the Event Log')
```

### Cost

The whole State is rewritten on every commit, and Reactions publish a cursor
for every commit, even one with no Events they apply, so each Command costs
one small file write per Reaction. This suits small State: Reaction decisions,
session metadata, pending work. For large State that grows with the log, such
as a full transcript, either use a memory Store, which rebuilds from the log on
startup, or a database Store.

## Reaction outbox Store

`createJsonlReactionOutboxStore({ path })` returns a Store for
`withReactionOutbox` from `@specter-ts/reaction-outbox`, with a `close()`
method. Use one file per wrapped Reaction Plugin: each wrapper runs its own
worker, and a worker claims every job in its Store.

```ts
import { createJsonlReactionOutboxStore } from '@specter-ts/jsonl'
import {
  type OutboxedReaction,
  withReactionOutbox,
} from '@specter-ts/reaction-outbox'

const outbox = createJsonlReactionOutboxStore<OutboxedReaction<Reply>>({
  path: `${directory}/outbox/sendReply.jsonl`,
  fsync: true,
})
const sendReply = implementReaction(spec)
  .plugin(withReactionOutbox(replyPlugin, { store: outbox }))
  // …
// After app.close():
outbox.close()
```

### Format

Each line is one job transition; only `enqueued` carries the payload:

```json
{"type":"enqueued","id":"sendReply:7","idempotencyKey":"sendReply:7","payload":{"output":{},"context":{}},"requestedAt":"…","availableAt":"…"}
{"type":"claimed","id":"sendReply:7","attemptId":"sendReply:7:attempt:1","attemptCount":1,"leaseExpiresAt":"…"}
{"type":"completed","id":"sendReply:7","attemptId":"sendReply:7:attempt:1","completedAt":"…"}
```

The other transitions are `renewed` (lease heartbeat), `failed` (rescheduled
with backoff), `dead-lettered`, `released` (lease expired, or interrupted by a
restart), and `retried` (dead-letter replay). Payloads must be
JSON-serializable unless a `codec` maps them to a JSON value.

### Behavior

- Opening replays every line into an in-memory index of jobs and idempotency
  keys. Pending, running, and dead-lettered jobs keep their payload in memory;
  a completed job keeps only its id, key, state, and the location of its
  `enqueued` line, so reading a completed job's payload reads that line from
  the file. Each Store operation is synchronous and
  appends its lines in one write, so operations in the process never
  interleave and a claim is atomic.
- Lock file, `fsync`, malformed-line, trailing-write, and failed-write
  handling match the Event Log: one `<path>.lock` writer, opens that reject a
  malformed journal without changing it, `discardedTrailingBytes` for an
  interrupted last line, and a Store that refuses writes after a partial line
  it could not truncate.
- Attempts left `running` by an earlier open are released while opening,
  without waiting for their lease, and listed in `releasedOnOpen`. The lock
  means no other open of the file exists, so a crashed or closed owner can no
  longer finish those attempts through it. Close the Store only after its
  workers stop: `withReactionOutbox` waits for a running attempt when its
  scope closes (`shutdownTimeoutMs`, 30 seconds by default), so close the
  Store after `app.close()`. An attempt still running after `close()` runs
  again after the next open. The released attempt counts toward
  `maxAttempts`.
- `subscribe` wakes this process's workers after an enqueue or a dead-letter
  retry, so a job starts without waiting for `pollIntervalMs`. `renewLease`
  lets the worker heartbeat a slow attempt.
- Completed and dead-lettered jobs stay in the file, so a replayed enqueue of
  the same idempotency key stays a no-op after any number of reopens.

### Enqueue and the Reaction cursor

SQL outbox Stores join the Slice Store transaction: the outbox row and the
Reaction cursor commit or roll back together. Two files cannot commit
together, so this Store makes the enqueue durable first. A Reaction Plugin
runs inside the Slice transaction, `withReactionOutbox` enqueues as its last
step, and the JSON Slice Store renames the cursor document only after the
transaction body returns. Every crash therefore lands in one of these windows:

1. Before the enqueue line is complete: no caller saw the enqueue succeed and
   the cursor did not move. A torn line is removed on open, and the Reaction
   runs again and enqueues.
2. After the enqueue line, before the cursor document is renamed (including a
   failed cursor write): the job survives without the cursor. The worker runs
   it, and core reruns the Reaction for the same commit with the same
   `deliveryId`, whose enqueue returns the existing job with `created: false`.
   The first enqueued payload wins.
3. After the rename: both are durable.

Delivery itself stays at least once, as with every Store: a crash after the
handler's external effect but before the `completed` line is complete (or
with a torn `completed` line, which opening removes) leaves the attempt
`running`, so the next open releases it and the job runs again. Use the
`deliveryId` as the provider's idempotency key.

No window loses a job whose cursor advanced. The difference from SQL Stores
is window 2: a job can run before, or without, its Reaction's cursor write,
and the Reaction transaction is retried until the cursor advances. The worker
may also start a job as soon as it is enqueued, before the cursor is written.

Ordering on disk needs `fsync: true` on the outbox. Without it, a process
crash keeps both writes, but an operating-system crash can persist the cursor
rename and lose the unsynced enqueue line, which is the lost job this design
avoids. The Slice Store's own `fsync` decides whether the cursor survives, not
the ordering.

Recording the enqueue inside the Reaction's Slice document would make the two
atomic, but the outbox would then have to scan Slice files on open and carry
unjournaled entries forward across commits; the idempotent replay above gives
the same no-loss guarantee without coupling the two adapters.

### Growth

The journal is never rewritten: it grows by about three lines per delivered
job (`enqueued`, `claimed`, `completed`), plus one line per retry and one per
heartbeat (every `heartbeatMs`, a third of `leaseMs` by default, while a
handler runs). Open time grows with it, memory grows with the number of jobs
(payloads only for jobs not yet completed), and claiming scans every indexed
job. Heartbeats rarely protect anything here: one process owns the file, and
its worker never reclaims its own running attempt, so they mainly add lines.
They matter for multi-worker Stores, and the SQL Stores do not renew leases
yet. Pass a `heartbeatMs` close to `leaseMs`, or a long `leaseMs`, to keep
the journal small. Rewrite the file when it is large relative to its live jobs, with
the Store closed: keep every `pending`, `running`, and `dead-letter` job, and
keep the idempotency key of each completed job until no Reaction cursor can
still replay its commit, or a replayed enqueue would run the job again.

## Not included

- File-backed Reaction schedulers.
- Outbox journal compaction.
- Incremental or per-key Slice State storage for large State.
- Multi-writer access, Event Log compaction, snapshots, or log rotation.

## Open items

- The package is built, tested, and typechecked with the workspace but is not
  yet part of the `release:*` scripts, so it is not published.
- Whether Reaction cursor writes for commits with no relevant Events get a
  cheaper path (core batching or an append-based Store) is undecided.
