# `@specter-ts/jsonl`

Append-only JSONL file Event Log for Specter. One file holds one Event Log, so
an application can keep a separate log per session, document, or tenant
without a database.

```ts
import { createJsonlEventLogLayer } from '@specter-ts/jsonl'
import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import { Layer } from 'effect'

const dependencies = Layer.mergeAll(
  createJsonlEventLogLayer({ path: `data/sessions/${sessionId}.jsonl` }),
  createMemorySliceStoreLayer(SessionStore, () => ({})),
)
```

`createJsonlEventLog({ path })` returns the Event Log service directly, with a
`close()` method. `createJsonlEventLogLayer` opens the file when the Layer is
built and closes it when the Layer scope ends, for example on `app.close()`.

## Format

Each line is one commit:

```json
{"version":2,"committedAt":"…","idempotencyKey":"…","fingerprint":"…","events":[{"id":"…","order":1,"type":"…","payload":{},"recordedAt":"…"},…]}
```

A line boundary is the atomic commit boundary, so `commitsAfter`, `findCommit`,
and idempotent receipts need no second file. Event payloads must be
JSON-serializable; values are returned as decoded JSON, both before and after a
reopen.

## Behavior

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
