# Persistence API

**Imports:** `@specter-ts/memory`, `@specter-ts/sqlite`, `@specter-ts/postgres`

**Status:** `0.3.0` main-branch preview; the published npm release remains `0.2.1`.

Specter provides deterministic memory adapters and persistent SQLite and
Postgres presets. All three implement the contracts from `@specter-ts/core`.
The Event Log remains authoritative; Slice Stores remain disposable
projections.

## Choose a package

| Package | Intended use |
| --- | --- |
| `@specter-ts/memory` | Unit tests, Scenario runners, examples, and local tools that do not need restart durability. |
| `@specter-ts/sqlite` | Default single-process persistent applications using a libSQL client. |
| `@specter-ts/postgres` | Multi-process services that need database transactions, advisory locking, and concurrent outbox claiming. |

## `@specter-ts/memory`

### Values

| Export | Purpose |
| --- | --- |
| `createMemoryEventLog(options?)` | Creates a serialized, rollback-safe in-memory Event Log with inspection and reset controls. |
| `createMemorySliceStore(createState, options?)` | Creates a per-Slice staged State adapter with inspection and reset controls. |
| `createImmediateReactionScheduler(options?)` | Creates a serialized immediate scheduler with injectable delivery IDs and clock. |
| `immediateReactionScheduler` | Default immediate scheduler singleton. |

### Types

| Export | Purpose |
| --- | --- |
| `MemoryEventLog` | `EventLogAdapter` plus `inspect()` and `reset()`. |
| `MemoryEventLogOptions` | Optional deterministic Event ID and recorded-time functions. |
| `MemorySliceStoreAdapter` | `SliceStoreAdapter` plus `inspect(sliceName)` and `reset(sliceName?)`. |
| `MemorySliceStoreOptions` | Optional State clone function and write-to-read capability mapper. |
| `ImmediateReactionSchedulerOptions` | Optional deterministic delivery-ID function and clock. |

```ts
import {
  createImmediateReactionScheduler,
  createMemoryEventLog,
  createMemorySliceStore,
} from '@specter-ts/memory'

const eventLog = createMemoryEventLog()
const store = createMemorySliceStore(() => ({ todos: [] }))
const schedule = createImmediateReactionScheduler()
```

The memory adapters clone staged State and roll failed transactions back, but
all data disappears with the process. The immediate scheduler retries nothing
after a crash.

## `@specter-ts/sqlite`

### Values

| Export | Purpose |
| --- | --- |
| `createSqliteDatabaseContext(client)` | Creates shared async-scoped connection, serialization, and transaction context. |
| `prepareSqliteEventLog(client)` | Creates Event and idempotent-commit tables and indexes. |
| `createSqliteEventLog(client, options?)` | Creates the SQLite `EventLogAdapter`. |
| `prepareSqliteSliceStore(client)` | Creates the Slice State/cursor table. |
| `createSqliteSliceStore(client, createState, options?)` | Creates a JSON-backed or custom-codec Slice Store. |
| `prepareSqliteReactionOutbox(client)` | Creates Reaction outbox tables and indexes. |
| `createSqliteReactionOutboxStore(client, options?)` | Creates a durable outbox store for the Reaction worker. |
| `prepareSpecterSqlite(client)` | Enables WAL/busy timeout and prepares all bundled Specter tables. |
| `createSpecterSqlitePersistence(client, options?)` | Creates one shared context, Event Log, and factories for Slice Stores and outbox stores. |

### Types

| Export | Purpose |
| --- | --- |
| `SqliteConnection` | libSQL `Client | Transaction` used by scoped operations. |
| `SqliteDatabaseContext` | Client plus `connection`, `serialize`, and `transaction` operations. |
| `SqliteEventCodec` | String encoder/decoder for Event payloads. |
| `SqliteEventLog` | `EventLogAdapter` plus its database context. |
| `SqliteEventLogOptions` | Optional shared context, Event ID/clock, and payload codec. |
| `SqliteSliceStateCodec` | String encoder/decoder for one Slice State type. |
| `SqliteSliceStoreOptions` | Optional shared context, State codec, and read-capability mapper. |
| `SqliteReactionOutboxOptions` | Optional shared database context. |

Prepare first, create the preset once, then derive Slice Stores from it:

```ts
import { createClient } from '@libsql/client'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'

const client = createClient({ url: 'file:./data/app.db' })
await prepareSpecterSqlite(client)

const persistence = createSpecterSqlitePersistence(client)
const todoStore = persistence.createSliceStore(() => ({ todos: [] }))
```

The preset shares context so nested Event Log, State, and outbox operations use
the active transaction correctly. Use a separately prepared operational client
and context when the durable worker must run independently of request/domain
database work.

## `@specter-ts/postgres`

### Values

| Export | Purpose |
| --- | --- |
| `createPostgresDatabaseContext(pool, options?)` | Creates async-scoped transaction context and local serialization around a structural pool. |
| `preparePostgresEventLog(pool)` | Creates Event and idempotent-commit tables and indexes. |
| `createPostgresEventLog(pool, options?)` | Creates the advisory-locking Postgres `EventLogAdapter`. |
| `preparePostgresSliceStore(pool)` | Creates the JSONB Slice State/cursor table. |
| `createPostgresSliceStore(pool, createState, options?)` | Creates a JSONB-backed Slice Store. |
| `preparePostgresReactionOutbox(pool)` | Creates Reaction outbox tables and indexes. |
| `createPostgresReactionOutboxStore(pool, options?)` | Creates an atomic, concurrent-safe outbox store. |
| `prepareSpecterPostgres(pool)` | Prepares all bundled Specter tables. |
| `createSpecterPostgresPersistence(pool, options?)` | Creates one shared context, Event Log, and factories for Slice Stores and outbox stores. |

### Types

| Export | Purpose |
| --- | --- |
| `PostgresQueryResult` | Structural query result with rows and optional row count. |
| `PostgresConnection` | Minimal `query(sql, parameters?)` contract. |
| `PostgresPoolClient` | Connection with `release()`. |
| `PostgresPool` | Connection with `connect()`; compatible with `pg`-style pools. |
| `PostgresDatabaseContext` | Advisory-lock key plus scoped connection, serialization, and transaction operations. |
| `PostgresDatabaseOptions` | Optional advisory-lock key. |
| `PostgresEventLog` | `EventLogAdapter` plus its database context. |
| `PostgresEventLogOptions` | Database options plus optional context, Event ID function, and clock. |
| `PostgresSliceStoreOptions` | Database options plus optional context and read-capability mapper. |
| `PostgresReactionOutboxOptions` | Database options plus optional context. |

```ts
import { Pool } from 'pg'
import {
  createSpecterPostgresPersistence,
  prepareSpecterPostgres,
} from '@specter-ts/postgres'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
await prepareSpecterPostgres(pool)

const persistence = createSpecterPostgresPersistence(pool)
const todoStore = persistence.createSliceStore(() => ({ todos: [] }))
```

The Event Log uses a transaction-scoped Postgres advisory lock to serialize
versioned decisions across processes. The outbox uses row locking with
`SKIP LOCKED` so workers can claim jobs concurrently.

## Lifecycle and constraints

1. Create the database client or pool.
2. Run the package's `prepareSpecter...` function during explicit startup or
   migration setup.
3. Create one persistence preset for the app.
4. Give `persistence.eventLog` to `createSpecterApp(...)` and derive private
   Slice Stores through `createSliceStore(...)`.
5. Connect `createReactionOutboxStore(...)` to the durable scheduler when
   Reaction work must survive restarts.
6. Close the underlying client or pool during application shutdown.

Payloads and default persistent Slice State must be JSON-serializable. SQLite
accepts custom Event and State codecs; Postgres persists payloads and State as
JSONB. Do not share one mutable projection across Slices merely to reduce
nearby duplication.

## Related documentation

- [Core adapters API](core-adapters.md)
- [Reaction outbox API](reaction-outbox.md)
- [Event Sourcing](../architecture/event-sourcing.md)
- [Runtime](../architecture/runtime.md)
- [API reference](README.md)
