# `@specter-ts/postgres`

Production Postgres Event Log, Slice Store, and Reaction outbox adapters for
Specter.

The package is verified both with deterministic adapter contract tests and a
real PostgreSQL service in CI. The integration suite exercises advisory-lock
serialization, rollback, JSONB Slice State, atomic `SKIP LOCKED` claims,
leases, retry, dead-letter, and replay behavior.

Run the same integration suite locally with
`SPECTER_POSTGRES_URL=postgresql://... pnpm test`.

The package uses a small structural `PostgresPool` interface compatible with
pool clients that expose `query`, `connect`, and `release`; it does not force a
specific Postgres driver. The interface follows the usual Postgres driver
contract: JSONB columns in returned rows are already decoded to JavaScript
JSON values. A driver adapter must therefore return objects, arrays, numbers,
booleans, null, and strings as those values rather than returning raw JSON
text. This preserves top-level JSON strings such as `"null"`, `"123"`, and
`"true"` exactly.

```ts
await migrateSpecterPostgres(pool, specterPostgresMigrations)

const persistence = createSpecterPostgresPersistence(pool)
const todosStore = persistence.createSliceStoreService(() => ({ todos: [] }))
const outboxStore = persistence.createReactionOutboxStore()
```

Command callbacks are logically serialized and reentrant without holding a
Postgres transaction while Slice State catches up or handlers run. Slice
publication remains independent. Event append opens a short transaction, takes
the Event Log advisory lock, and automatically checks the version captured
when the command callback started. This provides atomic
Event/idempotency commits and detects competing application processes without
coupling project-owned state to the Event Log transaction.

A purge (`purge({ name, value }, { keep })`) takes the same advisory lock and
removes a key's Events but the kept types in one transaction.

Each store's tables are a list of versioned migrations
(`postgresEventLogMigrations`, `postgresSliceStoreMigrations`,
`postgresReactionOutboxMigrations`, all in `specterPostgresMigrations`).
`migrateSpecterPostgres` applies what a database lacks in one transaction,
under an advisory lock, and records it in `specter_migrations`; a host with
its own migrations runs the statements in one of them instead. See
[Migrations](../../docs/api-reference/persistence.md#migrations).

Outbox workers claim jobs with `FOR UPDATE SKIP LOCKED`, making multiple worker
processes safe. Expired leases are recoverable and failed deliveries remain in
dead-letter storage until explicitly replayed.

Known limits: the outbox Store is the database's whole outbox table, with no
queues, concurrency keys, lease renewal or `subscribe` (its worker polls),
so a database or schema holds one outboxed Plugin's jobs; and table names
are fixed, so a database holds one Specter app. See
[Known limits](../../docs/api-reference/persistence.md#known-limits).
