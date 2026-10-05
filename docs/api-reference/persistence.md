# Persistence API

**Imports:** `@specter-ts/memory`, `@specter-ts/jsonl`, `@specter-ts/sqlite`,
`@specter-ts/sqlite-node`, `@specter-ts/postgres`

Event Log stores authoritative commits. Slice Stores own app-defined State,
cursor, ORM access, and transaction policy.

## Memory

| Export | Purpose |
| --- | --- |
| `createMemoryEventLog` / `createMemoryEventLogLayer` | In-memory Event Log. |
| `createMemorySliceStoreService` / `createMemorySliceStoreLayer` | Typed Store. |

Memory Store clones staged State and rolls failure back. Data disappears with
process.

## JSONL

| Export | Purpose |
| --- | --- |
| `createJsonlEventLog` | Open one JSONL file as an Event Log service with `close()`. |
| `createJsonlEventLogLayer` | Scoped Event Log Layer that closes the file with the app. |
| `createJsonlSliceStoreService` / `createJsonlSliceStoreLayer` | JSON file Store, one file per Slice. |
| `createJsonlReactionOutboxStore` | Reaction outbox Store backed by a JSONL journal of job transitions. |

The JSONL Event Log keeps one Event Log per file, one commit per line, so an
app can open a separate log per session without a database. Opening reads the
file once into an in-memory index; appends only add lines and are serialized in
the process. Opening takes an exclusive `<path>.lock` file that `close()`
removes, so a second open in the process or in another process fails; a lock
left by a crashed process is reported with its path, never taken over.
Expected versions and idempotency receipts match the SQLite adapters, and
`query` returns Events with `order > afterOrder`. `fsync` is off by default, so
a commit survives a process crash but not an operating-system failure; pass
`fsync: true` when the file is the only durable record.

Opening validates every complete line before changing the file, and a
malformed line fails the open without modifying it. A valid last commit whose
newline was lost is kept; an unterminated, unparsable start of a commit line
from an interrupted write is removed and reported as `discardedTrailingBytes`;
other trailing text fails the open. A failed append truncates its partial line;
if that truncate fails too, every later append fails with an
`EventLogFailure('append')` carrying both errors until the log is reopened.

The JSON Slice Store keeps each Slice's State and cursor in
`<directory>/<sliceName>.json`. It reads a Slice's file on first use and then
serves reads from memory. A transaction that publishes a cursor writes the
whole `{ cursor, state }` document to a temporary file and renames it over the
Slice file; a failed transaction leaves the file unchanged. Reaction cursors
therefore survive a restart, and reopening an app does not run Reactions again
for handled commits. State must be JSON-serializable; `Map` and `Set` values
fail the write instead of being stored as `{}`. Because State is rewritten
whole on every commit, and Reactions publish a cursor for every commit, use it
for small State such as Reaction decisions and session metadata; for large
State that grows with the log, use memory Slice Stores, which rebuild from the
log on startup, or a database Store.

The Slice Store's durability only holds when the Event Log uses `fsync: true`
as well. After an operating-system crash, a synced Slice cursor can point past
an unsynced log tail; new commits then reuse those orders and the Slice skips
them. The Slice Store cannot see the Event Log, so apps that need the check
compare each Slice cursor with `eventLog.currentVersion` after opening and
rebuild a Slice whose cursor is ahead.

The JSONL Reaction outbox Store appends one line per job transition and
replays the file into an in-memory index on open. It takes the same
`<path>.lock` writer lock and handles `fsync`, malformed lines, trailing
writes, and failed writes like the Event Log. Two files cannot share a
transaction, so the enqueue line is written before the Slice Store renames the
Reaction cursor document; after a crash between the two, the job survives and
core's retried Reaction re-enqueues the same `deliveryId` as a no-op. Use
`fsync: true` on the outbox so an operating-system crash cannot keep the
cursor and lose the enqueue. Attempts left running by an earlier open are
released on open. The journal is not compacted. See the package README for
the crash windows and when to rewrite the file.

`@specter-ts/jsonl` is built, tested, and typechecked with the workspace but is
not yet in the `release:*` scripts.

## SQLite

| Export | Purpose |
| --- | --- |
| `prepareSpecterSqlite` | Configure DB and create tables/indexes. |
| `createSqliteDatabaseContext` | Serialized, nestable Effect transaction context. |
| `createSqliteEventLogService` / `createSqliteEventLogLayer` | Event Log. |
| `createSqliteSliceStoreService` / `createSqliteSliceStoreLayer` | JSON Store. |
| `createSqliteReactionSchedulerService` / `createSqliteReactionSchedulerLayer` | Durable, multi-runtime Reaction coordination. |
| `prepareSqliteReactionScheduler` | Creates the dedicated scheduler table and index. |
| `createSqliteReactionOutboxStore` | Durable outbox Store. |
| `createSpecterSqlitePersistence` | Shared context and factories. |

```ts
await prepareSpecterSqlite(client)
const persistence = createSpecterSqlitePersistence(client)

const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, persistence.eventLog),
  createSqliteReactionSchedulerLayer(client, {
    context: persistence.context,
  }),
  Layer.succeed(
    TodosStore,
    persistence.createSliceStoreService(() => ({ todos: [] })),
  ),
)
```

`SqliteDatabaseContext.use` uses active transaction when present.
`transaction` nests by joining active Effect context. This lets direct ORM Slice
Stores, nested default-Plugin Commands, and outbox enqueue share one transaction
without AsyncLocalStorage.

The scheduler table is a rebuildable coordination index. Event Log commits and
Reaction Slice cursors remain authoritative; a failed execution stays pending
and every bound runtime polls and claims shared pending or expired work without
requiring a later Command. An explicit request rechecks even a completed
scheduler boundary, so resetting a rebuildable Slice cursor cannot be masked by
stale coordination state.

## Native Node SQLite

| Export | Purpose |
| --- | --- |
| `openNodeSqlite` | Open `DatabaseSync` context. |
| `createNodeSqliteEventLogLayer` | Event Log Layer. |
| `createNodeSqliteSliceStoreLayer` | App Store Layer. |
| `createSpecterNodeSqliteLayer` | Scoped DB lifecycle Layer. |

Nested Effect transactions join active `BEGIN IMMEDIATE` transaction.

## Postgres

| Export | Purpose |
| --- | --- |
| `prepareSpecterPostgres` | Create tables/indexes. |
| `createPostgresDatabaseContext` | Nestable Effect transaction context. |
| `createPostgresEventLogService` / `createPostgresEventLogLayer` | Event Log. |
| `createPostgresSliceStoreService` / `createPostgresSliceStoreLayer` | JSONB Store. |
| `createPostgresReactionOutboxStore` | Concurrent durable outbox. |
| `createSpecterPostgresPersistence` | Shared context and factories. |

Event Log append uses advisory lock. Slice transactions use per-Slice advisory
lock. Outbox claims use row locking. Nested operations join active connection.

## Adapter rules

- Prepare schema before runtime acquisition.
- Use one shared database context for atomic nested operations.
- Lock before invoking Store transaction callback.
- Invoke callback exactly once; never optimistic-replay developer code.
- Commit State and cursor together; rollback both on failure.
- Prevent visible cursor regression.
- Persist every Event Log commit boundary for `commitsAfter`.

## Related documentation

- [Core services](core-adapters.md)
- [Reaction outbox](reaction-outbox.md)
- [Runtime](core-runtime.md)
