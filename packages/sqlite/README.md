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

// node:sqlite, on a `DatabaseSync` the host opens and closes
const context = createNodeSqliteDatabaseContext(new DatabaseSync(file))
await Effect.runPromise(prepareSpecterSqlite(context))

const persistence = createSpecterSqlitePersistence(context)
const todosStore = persistence.createSliceStoreService(() => ({ todos: [] }))
const outboxStore = persistence.createReactionOutboxStore({ queue: 'emails' })
```

Each store's tables are a list of versioned migrations
(`sqliteEventLogMigrations`, `sqliteSliceStoreMigrations`,
`sqliteSliceSnapshotMigrations`, `sqliteReactionOutboxMigrations`,
`sqliteReactionSchedulerMigrations`, all in `specterSqliteMigrations`),
numbered from 1 per store; a release that changes a store's tables adds a
version and never edits one. A host without migrations of its own calls
`prepareSpecterSqlite(context)` (or `migrateSpecterSqlite(context, list)` for
some stores) at startup, which applies what the database lacks in one
transaction and records it in `specter_migrations`. A host with its own
migrations runs the statements of the versions it brings in from one of
them, and adds a migration when a Specter release adds a version. See
[Migrations](../../docs/api-reference/persistence.md#migrations).

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

Table names are fixed, so one database holds one Specter app's tables.
