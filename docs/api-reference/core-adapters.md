# Core services API

**Import:** `@specter-ts/core`

Runtime dependencies are Effect `Context` services supplied by `Layer`.

## Event Log

| Export | Purpose |
| --- | --- |
| `EventLog` | Runtime service Tag. |
| `EventLogService` | `query`, `currentVersion`, `commitsAfter`, `findCommit`, `append`. |
| `EventLogCommit` | Durable Events, commit version/time, optional idempotency metadata. |
| `EventLogAppendResult` | Commit plus `duplicate`. |
| `EventLogFailure` | Typed operation failure. |

`append` atomically checks expected version, assigns Event orders, writes Events,
and records commit boundary. Every append creates commit receipt, including
commands without idempotency key. `findCommit(key)` resolves idempotency receipt.
`commitsAfter(version)` returns complete commits ordered by commit version; core
uses it as durable Reaction work stream.

## Slice Store

| Export | Purpose |
| --- | --- |
| `SliceStoreService<TRead, TWrite, TError>` | Per-Slice `read` and `transaction`. |
| `SliceStoreTag` | Structural Effect Tag accepted by `.store`. |
| `SliceStoreRead/Write/Error/Requirement` | Infer types from Store Tag. |

```ts
import { implementQuery } from '@specter-ts/core'

import specification from './spec.json' with { type: 'json' }

class TodosStore extends Context.Service<
  TodosStore,
  SliceStoreService<Readonly<TodosState>, TodosState, TodosStoreFailure>
>()('app/TodosStore') {}

const todos = implementQuery(specification)
  .inputSchema<TodosQuery>()
  .outputSchema<readonly Todo[]>()
  .store(TodosStore, { eager: true })
  .apply(todoAdded, applyTodo)
  .handle(handleTodos)
```

Store owns State representation, ORM access, persistence, and concurrency.
`transaction` must:

- acquire adapter-owned exclusion before invoking callback;
- invoke callback exactly once; optimistic callback replay is forbidden;
- commit State and cursor atomically on success;
- roll back State and cursor on failure;
- prevent visible cursor regression.

Reaction Plugin executes inside this callback. Adapter may use compare-and-swap
or last-write-wins publication internally, but cannot rerun developer code.

`{ eager: true }` catches Slice up at startup. Default catches up before handle.

## Reaction scheduler

| Export | Purpose |
| --- | --- |
| `ReactionScheduler` | Optional Effect Reference with a process-local default. |
| `ReactionSchedulerService` | Binds one executor; `schedule(throughOrder)` acknowledges acceptance and returns a separate completion Effect. |
| `ReactionSchedulerFailure` | Typed bind, scheduling, or completion failure. |

Event Log commits and Reaction Slice cursors own correctness. A scheduler only
wakes and serializes processing, so its coordination state must be rebuildable.
Single-process runtimes use the default in-memory implementation; stateless or
distributed runtimes supply a persistent adapter such as SQLite or Redis. A
durable adapter must let any bound worker discover accepted work after the
originating runtime exits.

## Reaction delivery context

`ReactionDeliveryContext` contains stable `deliveryId`, commit `throughOrder`,
and durable `scheduledAt`. Attempt IDs belong only to an optional outbox worker.
Runtime processing reads Event Log commits and uses the Reaction Slice cursor as
the completion checkpoint.

## Invariants

- Event Log is authority; Slice Stores are rebuildable views/checkpoints.
- App Layer provides one `EventLog` and every registered Store Tag.
- Shared SQL database context lets nested Commands and outbox enqueue join active
  Reaction transaction.
- Promise API is transport edge; native Effect runtime keeps typed errors.

## Related documentation

- [Runtime API](core-runtime.md)
- [Persistence API](persistence.md)
- [Reaction outbox API](reaction-outbox.md)
