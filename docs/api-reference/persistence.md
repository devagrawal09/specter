# Persistence API

**Imports:** `@specter-ts/memory`, `@specter-ts/sqlite`, `@specter-ts/sqlite-node`, `@specter-ts/postgres`

Persistence packages expose Effect-native services and Layers. Event Log stays
authoritative; Slice Stores remain app-defined, rebuildable projections.

## Memory

| Export | Purpose |
| --- | --- |
| `createMemoryEventLog(options?)` | Event Log service with inspection/reset controls. |
| `createMemoryEventLogLayer(options?)` | Fresh `EventLog` Layer. |
| `createMemorySliceStoreService(createState, options?)` | Typed Store service with inspection/reset controls. |
| `createMemorySliceStoreLayer(tag, createState, options?)` | Provides app Store Tag. |
| `createImmediateReactionSchedulerService(scope, options?)` | Process-local scheduler service. |
| `createImmediateReactionSchedulerLayer(options?)` | Scoped `ReactionScheduler` Layer. |

```ts
import {
  createImmediateReactionSchedulerLayer,
  createMemoryEventLogLayer,
  createMemorySliceStoreLayer,
} from '@specter-ts/memory'
import { Layer } from 'effect'

const dependencies = Layer.mergeAll(
  createMemoryEventLogLayer(),
  createImmediateReactionSchedulerLayer(),
  createMemorySliceStoreLayer(TodosStore, () => ({ todos: [] })),
)
```

Memory Store clones staged State and rolls failed transactions back. All data
disappears with process. Immediate scheduler has no crash recovery.

## SQLite (`@specter-ts/sqlite`)

| Export | Purpose |
| --- | --- |
| `prepareSpecterSqlite(client)` | Configures SQLite and creates bundled tables/indexes. |
| `createSqliteDatabaseContext(client)` | Shared serialized connection/transaction context. |
| `createSqliteEventLogService(client, options?)` | Effect-native Event Log service. |
| `createSqliteEventLogLayer(client, options?)` | Provides `EventLog`. |
| `createSqliteSliceStoreService(client, createState, options?)` | Typed Store service. |
| `createSqliteSliceStoreLayer(tag, client, createState, options?)` | Provides app Store Tag. |
| `createSqliteReactionOutboxStore(client, options?)` | Durable outbox store. |
| `createSpecterSqlitePersistence(client, options?)` | Shared context, Event Log service, and Store/outbox factories. |

```ts
await prepareSpecterSqlite(client)
const persistence = createSpecterSqlitePersistence(client)

const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, persistence.eventLog),
  createDurableReactionSchedulerLayer(
    persistence.createReactionOutboxStore(),
  ),
  Layer.succeed(
    TodosStore,
    persistence.createSliceStoreService(() => ({ todos: [] })),
  ),
)
```

## Native Node SQLite (`@specter-ts/sqlite-node`)

| Export | Purpose |
| --- | --- |
| `openNodeSqlite(options)` | Opens native database context. |
| `createNodeSqliteEventLogLayer(context, options?)` | Event Log Layer. |
| `createNodeSqliteSliceStoreLayer(tag, context, createState, options?)` | App Store Layer. |
| `createNodeSqliteReactionSchedulerLayer(context)` | Durable scheduler Layer. |
| `createSpecterNodeSqliteLayer(options)` | Scoped runtime factory owning database lifecycle. |

Native database Layer owns open/close lifecycle. Add app Store Layers to runtime
Layer before building Specter App Layer.

## Postgres (`@specter-ts/postgres`)

| Export | Purpose |
| --- | --- |
| `prepareSpecterPostgres(pool)` | Creates bundled tables/indexes. |
| `createPostgresDatabaseContext(pool, options?)` | Shared connection/transaction context. |
| `createPostgresEventLogService(pool, options?)` | Effect-native Event Log service. |
| `createPostgresEventLogLayer(pool, options?)` | Provides `EventLog`. |
| `createPostgresSliceStoreService(pool, createState, options?)` | Typed JSONB Store service. |
| `createPostgresSliceStoreLayer(tag, pool, createState, options?)` | Provides app Store Tag. |
| `createPostgresReactionOutboxStore(pool, options?)` | Durable concurrent outbox store. |
| `createSpecterPostgresPersistence(pool, options?)` | Shared context, Event Log service, and Store/outbox factories. |

Postgres Event Log uses transaction-level advisory locking for atomic version,
idempotency, and append decisions. Outbox claims use row locking suitable for
multiple workers.

## Rules

- Define Store Tag with Slice so State types and runtime requirement stay linked.
- Provide Store implementation only in app wiring.
- Prepare persistent schema before acquiring runtime.
- Keep one shared database context when Event Log, stores, and outbox must share
  underlying serialization/transaction resources.
- Store adapter chooses optimistic compare-and-swap or last-write-wins policy,
  but visible cursor must not regress.

## Related documentation

- [Core services API](core-adapters.md)
- [Reaction outbox API](reaction-outbox.md)
- [Core runtime API](core-runtime.md)
