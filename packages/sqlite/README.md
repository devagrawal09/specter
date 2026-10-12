# `@specter-ts/sqlite`

SQLite persistence for Specter on the host's own connection: an Event Log,
JSON Slice Stores, Slice snapshots, a Reaction outbox and a Reaction scheduler.

Every store runs on a `SqliteDatabaseContext`, which the host provides over its
driver, so the stores share the host's connection and transactions:

```ts
// libSQL (`@libsql/client`)
const context = createSqliteDatabaseContext(client)
await Effect.runPromise(prepareSpecterSqlite(context))

// An Effect SqlClient (`effect/sql`), with the host ORM's transaction
const context = createSqlClientDatabaseContext(db.$client, {
  transaction: (effect) => db.transaction(() => effect, { behavior: 'immediate' }),
})

const persistence = createSpecterSqlitePersistence(context)
const todosStore = persistence.createSliceStoreService(() => ({ todos: [] }))
const outboxStore = persistence.createReactionOutboxStore({ queue: 'emails' })
```

A host that runs its own migrations creates the tables by running the
statements it needs (`sqliteEventLogSchema`, `sqliteReactionOutboxSchema`,
`sqliteSliceSnapshotSchema`, `sqliteSliceStoreSchema`,
`sqliteReactionSchedulerSchema`) in a migration; others call
`prepareSpecterSqlite(context)` at startup.

The Event Log enforces expected versions and the scoped compare-and-swap in
SQL, stores durable idempotency receipts and each Event's keys in the same
transaction as its Events, and pages its reads. Its `onAppend` hook runs in
the append's transaction with each Event and the metadata its dispatch gave
it, so a host's read models change with the log, and may return work to run
once the commit is durable. A purge (`purge({ name, value }, { keep })`)
removes a key's Events but the kept types in one transaction, and its
`onPurge` hook runs in it, before it deletes, with the removed Events' orders,
so a host removes its own rows that refer to them. Slice Stores and snapshots
keep each Slice's State under its version and ignore State of another, and
keep the highest cursor each Slice's name reached under any version. The Reaction outbox keeps
one queue per Store, with atomic claims, concurrency keys, lease renewal,
in-process wake-ups, retries, dead letters, replay, release of what an earlier
process left running, and pruning. Event payloads, Slice State and outbox
payloads must be JSON-serializable unless a codec says otherwise.

The Event Log can also open the earlier commit table whose primary key is
`idempotency_key` and which has no `commit_version` column. It detects that
shape without migrating or rebuilding the table, and uses `last_event_order`
as the ordered commit boundary. New databases use the `commit_version` table.
