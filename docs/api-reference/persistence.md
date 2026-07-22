# Persistence API

**Imports:** `@specter-ts/memory`, `@specter-ts/sqlite`,
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
