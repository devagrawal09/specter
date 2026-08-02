# `@specter-ts/sqlite`

Production SQLite persistence for Specter using `@libsql/client`.

```ts
const client = createClient({ url: 'file:data/app.db' })
await prepareSpecterSqlite(client)

const persistence = createSpecterSqlitePersistence(client)
const todosStore = persistence.createSliceStoreService(() => ({ todos: [] }))
const outboxStore = persistence.createReactionOutboxStore()
```

Use the combined persistence factory when the Event Log and Slice Stores share
one database. Command callbacks are logically serialized and reentrant, but do
not hold a SQLite write transaction while Slice State catches up or handlers
run. Slice publication remains independent. Event append opens its own short
atomic write transaction and automatically checks the version captured when
the command callback started, detecting competing processes without blocking
project-owned state writes.

The Event Log enforces expected versions and stores durable idempotency
receipts in the same transaction as its Events. The Reaction outbox uses atomic
claims, deterministic attempt IDs, leases, retries, dead letters, and replay.
Event payloads, Slice State, and outbox payloads must be JSON-serializable.

The Event Log can also open the earlier commit table whose primary key is
`idempotency_key` and which has no `commit_version` column. It detects that
shape without migrating or rebuilding the table, and uses `last_event_order`
as the ordered commit boundary. New databases continue to use the current
`commit_version` table.
