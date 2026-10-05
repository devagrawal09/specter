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
  fingerprints behave like the SQLite adapters. The opening process must be
  the only writer of the file; there is no cross-process lock.
- `fsync` is off by default. Without it, a commit survives a process crash but
  may be lost if the machine or operating system fails before the page cache
  is flushed. Use this default only when final facts are also recorded
  somewhere authoritative. Pass `fsync: true` to flush every append.
- An unterminated last line is a write interrupted by a crash; no caller saw
  that commit succeed. Opening removes it and reports the removed byte count
  as `discardedTrailingBytes`. Any other malformed or non-contiguous line
  fails the open.

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
- State must be JSON-serializable and is returned as decoded JSON, both before
  and after a reopen. Slice names must match `[A-Za-z0-9_-]+`.
- `fsync` is off by default. Pass `fsync: true` to flush the file and its
  directory on every commit.
- The process that opens the directory must be its only writer.

The whole State is rewritten on every commit, and Reactions publish a cursor
for every commit, so each Command costs one small file write per Reaction.
This suits small State: Reaction decisions, session metadata, pending work.
For large State that grows with the log, such as a full transcript, either use
a memory Store, which rebuilds from the log on startup, or a database Store.
