# `@specter-ts/jsonl`

File-backed persistence for Specter without a database: an append-only JSONL
Event Log and a JSON file Slice Store. One directory can hold one app's data,
so an application can keep a separate app per session, document, or tenant.

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
- Appends are serialized in the process. Expected versions and idempotency
  fingerprints behave like the SQLite adapters.
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

## Not included

- File-backed Reaction schedulers or outboxes.
- Incremental or per-key Slice State storage for large State.
- Multi-writer access, compaction, snapshots, or log rotation.

## Open items

- The package is built, tested, and typechecked with the workspace but is not
  yet part of the `release:*` scripts, so it is not published.
- Whether Reaction cursor writes for commits with no relevant Events get a
  cheaper path (core batching or an append-based Store) is undecided.
