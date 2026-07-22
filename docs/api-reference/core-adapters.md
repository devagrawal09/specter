# Core services API

**Import:** `@specter-ts/core`

**Status:** `0.4.0` main-branch preview.

Specter runtime dependencies are Effect `Context` services. Applications satisfy
them with `Layer`; Slice code names its State capability with `.store(StoreTag)`.

## Event Log

| Export | Purpose |
| --- | --- |
| `EventLog` | Context service Tag required by runtime. |
| `EventLogService` | Effect-native `query`, `currentVersion`, `findCommit`, and `append` operations. |
| `EventLogFailure` | Typed persistence failure with failing operation and cause. |
| `EventLogCommit` | Durable Event receipt and version. |
| `EventLogAppendResult` | Commit receipt plus `duplicate`. |
| `EventLogAppendOptions` | Optional `expectedVersion`, `idempotencyKey`, and fingerprint. |

`append` is atomic. It validates `expectedVersion`, reserves strictly increasing
global orders, writes all Events, and persists any idempotency receipt together.
Concurrent Command decisions may diverge; only matching expected version commits.
Runtime catches a Slice up again before retrying conflicted work.

`query(afterOrder, eventTypes)` returns matching Events with unique, strictly
ascending orders greater than `afterOrder`. `findCommit(key)` returns durable
receipt for earlier idempotent append.

## Slice Store

| Export | Purpose |
| --- | --- |
| `SliceStoreService<TRead, TWrite, TError>` | Effect-native per-Slice `read` and `transaction` capability. |
| `SliceStoreTag` | Structural Effect Context Tag accepted by `.store(...)`. |
| `SliceStoreRead<TTag>` | Infers read State from Tag. |
| `SliceStoreWrite<TTag>` | Infers write State from Tag. |
| `SliceStoreError<TTag>` | Infers typed adapter error from Tag. |
| `SliceStoreRequirement<TTag>` | Infers Effect environment requirement from Tag. |

Applications define a typed Tag and provide its implementation at runtime:

```ts
import { SliceStoreService } from '@specter-ts/core'
import { Context, Layer } from 'effect'

class TodosStore extends Context.Service<
  TodosStore,
  SliceStoreService<Readonly<TodosState>, TodosState, TodosStoreFailure>
>()('app/TodosStore') {}

const todos = todosSpec
  .store(TodosStore, { eager: true })
  .apply(todoAdded, applyTodo)
  .handle(handleTodos)

const TodosStoreLive = Layer.succeed(TodosStore, service)
```

Store owns persistence and concurrency policy. `transaction` must publish State
and cursor atomically. Visible cursor must not regress. Optimistic stores may
discard stale commits or retry callback, so apply handlers must avoid external
effects. `{ eager: true }` requests startup catch-up; default is lazy catch-up
before each handle.

## Reaction Scheduler

| Export | Purpose |
| --- | --- |
| `ReactionScheduler` | Context service Tag required by runtime. |
| `ReactionSchedulerService` | Effect-native `schedule` and startup `recover`. |
| `ReactionSchedulerFailure` | Typed schedule/recovery failure. |
| `ReactionDeliveryContext` | Stable delivery metadata plus attempt metadata. |

`schedule(throughOrder, execute)` must accept work before succeeding, then
returns an Effect that waits for that delivery. `recover(execute)` drains work
accepted by an earlier runtime. Immediate Layer gives process-local execution;
durable scheduler Layer persists passes.

## Invariants

- Event Log is authority. Slice Stores are rebuildable projections.
- App wiring provides one `EventLog`, one `ReactionScheduler`, and every Slice
  Store Tag through Effect Layers.
- Store State and cursor publication are locally atomic.
- Reaction Plugins use stable `deliveryId` for downstream idempotency.
- Promise API exists only as transport edge; service failures remain typed in
  native Effect runtime.

## Related documentation

- [Persistence API](persistence.md)
- [Reaction outbox API](reaction-outbox.md)
- [Core runtime API](core-runtime.md)
