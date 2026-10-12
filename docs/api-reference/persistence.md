# Persistence API

**Imports:** `@specter-ts/memory`, `@specter-ts/jsonl`, `@specter-ts/sqlite`,
`@specter-ts/sqlite-node`, `@specter-ts/postgres`

Event Log stores authoritative commits. Slice Stores own app-defined State,
cursor, ORM access, and transaction policy.

## Memory

| Export | Purpose |
| --- | --- |
| `createMemoryEventLog` / `createMemoryEventLogLayer` | In-memory Event Log. |
| `createMemorySliceStoreService` / `createMemorySliceStoreLayer` | Typed Store; `initial(slice)` seeds a Slice (`{ folded: { state, cursor }, reached }`), `inspect(name)` reads it back with its cursor, version and `reached`. |
| `createSnapshotSliceStores(snapshots)` | Memory Stores whose Slices start from snapshots of their version, and `snapshot()` of the Slices that moved. |
| `persistSliceSnapshots(store, { interval, slices })` | Scoped: memory Stores loaded from a `SliceSnapshotStore`, saved back every `interval` (one minute) and when the scope closes; with `slices`, the names the runtime serves, the snapshots of every other Slice are removed as it loads. |
| `createMemorySliceSnapshotStore` | A `SliceSnapshotStore` in this process, for tests. |

Memory Store clones staged State and rolls failure back. Data disappears with
process. It keeps one State per Slice name, with the version of the Slice it
was folded for; a call for another version starts the Slice again, keeping
the highest cursor the name reached. The memory Event Log keeps each Event's
keys in its own index, which its scoped check, keyed reads and purges use.

Slices that fold in memory need not fold the whole log at every boot:

```ts
const stores = yield* persistSliceSnapshots(
  createSqliteSliceSnapshotStore(context),
)
const app = yield* makeSpecterRuntime(config).pipe(
  Effect.provide(stores.layer(TodosStore, () => ({ todos: [] }))),
)
```

Each Slice starts from its saved snapshot when the snapshot's version is the
Slice's, and catches up after its cursor; a Slice whose specification or
`stateVersion` changed folds the log instead, so a snapshot of an old shape is
never read, but keeps the snapshot's `reached`, so a Reaction of a new version
does not deliver again what it delivered. Make the runtime after
`persistSliceSnapshots`, in the same scope: the last save then runs after the
runtime closes. A failed save is logged and retried with the next one; a lost
snapshot only costs its Slice a fold. Pass the Slices the runtime serves
(`slices: Object.keys(config.slices)`) and the snapshots of Slices it no
longer registers are removed when it loads.

## JSONL

| Export | Purpose |
| --- | --- |
| `createJsonlEventLog` | Open one JSONL file as an Event Log service with `close()`. |
| `createJsonlEventLogLayer` | Scoped Event Log Layer that closes the file with the app; `onOpen` reports what the open recovered. |
| `createJsonlSliceStoreService` / `createJsonlSliceStoreLayer` | JSON file Store, one file per Slice. |
| `createJsonlReactionOutboxStore` | Reaction outbox Store backed by a JSONL journal of job transitions. |

The JSONL Event Log keeps one Event Log per file, one commit per line, so an
app can open a separate log per session without a database. Opening reads the
file once into an in-memory index; appends only add lines and are serialized in
the process. Opening takes an exclusive `<path>.lock` file that `close()`
removes, so a second open in the process or in another live process fails.
The lock records the opener's pid, hostname, random token, and on Linux its
start time, pid namespace, and boot id. A lock whose holder ran on this host
and has exited, such as after `SIGKILL` (or ran before the host's last boot),
is taken over and reported as `recoveredStaleLock: { pid, hostname }`; a live
holder, this same process (another worker thread or a symlinked directory),
another host, another pid namespace, or unreadable content fails the open with
the reason. A symlink or hard link to the file itself gets its own lock file, so
always open a JSONL file through one path. Concurrent openers that find the same stale lock serialize the
takeover through an exclusive claim file, so at most one wins, and `close()`
removes the lock only while it still holds its own token. Opening is
synchronous and can block for about 100 ms while it retries a contended
takeover. A reused pid only makes the open refuse (on Linux the start time
detects reuse). Locks use local process ids, so never share these files
across hosts or over NFS.
The `onOpen` option of both Event Log constructors and of
`createJsonlReactionOutboxStore` is called once after a successful open with
`recoveredStaleLock` and `discardedTrailingBytes` (and the outbox's
`releasedOnOpen`), so apps using the Layer can log recoveries too.
Expected versions and idempotency receipts match the SQLite adapters, and
`query` returns Events with `order > afterOrder`. A purge rewrites the file
without the Events it removes, through `<path>.purge` renamed over it, under a
first line that keeps the log's version and, by type, the highest order a
purge removed (`{"purged":{"note-written":5},"version":5}`); the rewritten
file holds no payload of a removed Event, and the next appends follow it as
before. Each Event in a commit line
keeps its keys (`"keys": { "session": "s1" }`, omitted when it has none); the
open builds an in-memory index of them, which the scoped check and keyed reads
use. `fsync` is off by default, so
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
`<directory>/<sliceName>.json`, with the version of the Slice that folded it
and the highest cursor its name reached (`reached`).
It reads a Slice's file on first use and then serves reads from memory; a
file of another version (or one written before Slices had versions) is not
read, and the Slice folds the log until its first commit replaces the file. A transaction that publishes a cursor writes the
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
`<path>.lock` writer lock, with the same stale-lock takeover and
`recoveredStaleLock`, and handles `fsync`, malformed lines, trailing
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
| `SqliteDatabaseContext<TConnection>` | The host's database: `execute` a statement, `use` the connection a statement runs on now, run a nestable `transaction`. |
| `createSqliteDatabaseContext(client)` | The database over a libSQL client; `use` gives the libSQL connection. |
| `createSqlClientDatabaseContext(sql, { transaction })` | The database over an Effect `SqlClient` (`effect/sql`), with the host's transaction runner. |
| `createSqliteEventLogService` / `createSqliteEventLogLayer` | Event Log, with the `onAppend` and `onPurge` hooks. |
| `createSqliteSliceStoreService` / `createSqliteSliceStoreLayer` | JSON Store, versioned. |
| `createSqliteSliceSnapshotStore` | `SliceSnapshotStore` in `specter_slice_snapshots`. |
| `createSqliteReactionOutboxStore` | Durable outbox Store, one queue per Plugin. |
| `createSqliteReactionSchedulerService` / `createSqliteReactionSchedulerLayer` | Durable, multi-runtime Reaction coordination. |
| `sqliteEventLogSchema`, `sqliteSliceStoreSchema`, `sqliteSliceSnapshotSchema`, `sqliteReactionOutboxSchema`, `sqliteReactionSchedulerSchema` | The statements that create each store's tables and indexes. |
| `specterSqliteSchema` | All of them. |
| `prepareSpecterSqlite` and `prepareSqlite*` | Run them (the first also turns on WAL and a busy timeout). |
| `createSpecterSqlitePersistence` | Every store on one database. |

Specter's SQLite stores run on a database the host provides, so they share
its connection and its transactions. A host on libSQL hands Specter its
client:

```ts
const context = createSqliteDatabaseContext(client)
await Effect.runPromise(prepareSpecterSqlite(context))
const persistence = createSpecterSqlitePersistence(context)

const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, persistence.eventLog),
  createSqliteReactionSchedulerLayer(context),
  Layer.succeed(
    TodosStore,
    persistence.createSliceStoreService(() => ({ todos: [] })),
  ),
)
```

A host on an Effect `SqlClient` (`@effect/sql-sqlite-bun`,
`@effect/sql-sqlite-node`, a Durable Object's storage, or its own driver)
hands Specter the client, and its own transaction runner when it has one,
such as its ORM's:

```ts
const context = createSqlClientDatabaseContext(db.$client, {
  transaction: (effect) => db.transaction(() => effect, { behavior: 'immediate' }),
})
```

Statements run through the client, so inside any transaction the client knows,
the host's or Specter's, they run on its connection: an Event Log append, a
Slice Store transaction, an outbox enqueue and the host's own writes inside one
transaction commit or roll back together. Without a runner the context uses
`sql.withTransaction`, which begins a deferred transaction; begin it
immediately when several processes write the database. `context.transaction`
nests: inside an active transaction it joins it (libSQL) or opens a savepoint
(`SqlClient`).

### Who creates the tables

The host does, when it owns the database's migrations: the migration that
introduces Specter runs the statements of the stores it uses
(`sqliteEventLogSchema` and the others, `CREATE ... IF NOT EXISTS`). A host
without migrations runs `prepareSpecterSqlite(context)`, or a store's
`prepareSqlite*`, at startup. Table names are fixed (`specter_events`,
`specter_event_keys`, `specter_event_commits`, `specter_event_purges`,
`specter_slice_states`,
`specter_slice_snapshots`, `specter_reaction_outbox`,
`specter_reaction_scheduler`), so one database holds one Specter app's
tables; the host's own tables sit beside them and may reference them (an
index of the log by `specter_events.event_order`). A Specter release that
changes these statements says what moves an existing database.

### Event Log

`specter_events` holds each Event, `specter_event_keys (event_order, name,
value)`, keyed by `(event_order, name)` and indexed on `(name, value,
event_order)`, its keys, and `specter_event_commits` each commit. The scoped
check is one indexed query over the keys, and so is a keyed read; every read
returns each Event's keys from them, as one JSON object a subquery aggregates
per Event. A page of `commitsAfter` reads its commits' Events in one query.

An append runs in one `context.transaction`, joining the host's when it runs
inside one. `onAppend` runs in that transaction once the commit's Events and
keys are stored, with the commit and the metadata each Event's draft carried
(the dispatch's `eventContext`), by position:

```ts
const eventLog = createSqliteEventLogService(context, {
  onAppend: ({ commit, metadata }) =>
    Effect.gen(function* () {
      yield* projectReadModels(commit.events, metadata)
      // Run once the transaction has committed.
      return notifyListeners(commit.events)
    }),
})
```

A host writes its own read models there, so they change with the log or not
at all: a failing hook rolls the append back and fails it. What the hook
returns, if anything, runs after the commit and before `append` returns; the
append is uninterruptible, so a committed append always runs it. A duplicate
(a known idempotency key) appends nothing and runs no hook. The Event Log
keeps every guarantee of the contract (stored keys, the scoped
compare-and-swap, keyed reads, idempotency, paged reads, purges) and declares
every capability.

A purge runs in one `context.transaction` too. `onPurge` runs in it before
anything is deleted, with the key, the kept types and the orders of the
Events it removes, so a host removes its own rows that refer to them (an
index of the log by `specter_events.event_order`) with them:

```ts
const eventLog = createSqliteEventLogService(context, {
  onPurge: ({ orders }) =>
    sql`DELETE FROM event_index WHERE log_order IN ${sql.in(orders)}`,
})
```

A failing hook rolls the purge back and fails it; a purge that finds nothing
to remove runs none. `specter_event_purges (type, through_order)` keeps, by
Event type, the highest order a purge removed: the log's version is the
highest of its Events' orders and those, and the scoped check reads it.

### Slice Stores and snapshots

The JSON Slice Store keeps each Slice's State in `specter_slice_states` with
its cursor, version and `reached`, written in the database's transaction.
State kept under another version is not read: the Slice folds the log, and
its first commit replaces the row, keeping the highest cursor the Slice
reached. `createSqliteSliceSnapshotStore` keeps snapshots of Slices that fold
in memory (`persistSliceSnapshots` in `@specter-ts/memory`), one row per Slice
with its version and `reached`, all of a save in one transaction; `remove`
deletes rows by Slice.

### Reaction outbox

Each Store is one queue of `specter_reaction_outbox`
(`createSqliteReactionOutboxStore(context, { queue: 'emails' })`, `default`
when omitted); a worker claims every job of its queue, so give each wrapped
Plugin its own. Every operation is one statement: a claim picks and leases
the first available job in one `UPDATE`, so workers in several processes never
claim one job twice. The Store keeps each job's concurrency key (a job never
runs while another job of its queue with its key runs), renews leases, and
wakes this process's workers when an enqueue or a retried dead letter makes
work claimable. `release(now, { deadLetters })` returns the jobs an earlier
process left running (and its dead letters) to pending with a fresh attempt
count, for a process starting as the queue's only worker; `prune(before)`
deletes the jobs that completed by then.

### Scheduler

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

Nested Effect transactions join active `BEGIN IMMEDIATE` transaction. The
Event Log keeps keys in `specter_event_keys` and its purges in
`specter_event_purges`, as the SQLite adapter does, and pages its reads; the
Slice Store keeps each Slice's version and `reached` in `specter_slice_states`
and ignores State of another version.

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
`prepareSpecterPostgres` creates `specter_event_keys (event_order, name,
value)` with the same key and index as SQLite; the scoped check matches its
`(name, value)` pairs against the condition's in one query, and
`specter_event_purges` keeps a purge's high-water marks as in SQLite; a purge
takes the append's advisory lock. Reads are paged with `LIMIT`. The JSONB
Store keeps each Slice's version and `reached` beside its State and ignores
State of another version. The outbox Store has one queue per table
and no concurrency keys, lease renewal or wake-ups.

## Adapter rules

- Prepare schema before runtime acquisition.
- Use one shared database context for atomic nested operations.
- Lock before invoking Store transaction callback.
- Invoke callback exactly once; never optimistic-replay developer code.
- Commit State and cursor together; rollback both on failure.
- Prevent visible cursor regression.
- Persist every Event Log commit boundary for `commitsAfter`.
- Honor the `limit` of `query` and `commitsAfter`: at most that many Events or
  whole commits, the first after where the read starts.
- Keep a Slice's State under its `SliceStoreSlice.version`, and never return
  State kept under another version; keep under its name the highest cursor it
  published under any version and pass it to `read` as `reached`.
- Check `expectedVersion` and `expectedUnchanged` in the store, under the
  append lock, after the idempotency lookup; a stale append fails with a
  `SpecterVersionConflictError` cause.
- Store each Event's keys exactly as `append` receives them, never derived by
  the adapter, index them by `(name, value, order)` for the scoped check
  and `readKey`, and return them with the Event from every read.
- Store an Event under the host's `id` and `recordedAt` when its draft carries
  them, and refuse an ID already in the log; `metadata` is the host's.
- Purge under the append lock: remove the key's Events but the kept types,
  their keys, and the commits left empty with their receipts; never reuse an
  order or move the version back; keep, by type, the highest order a purge
  removed and treat it as an Event for `expectedUnchanged`.
- Declare `capabilities`, and refuse what is not supported rather than ignore
  it.

## Related documentation

- [Core services](core-adapters.md)
- [Reaction outbox](reaction-outbox.md)
- [Runtime](core-runtime.md)
