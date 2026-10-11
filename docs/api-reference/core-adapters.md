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
| `EventLogAppendOptions` | `expectedVersion`, `expectedUnchanged`, `idempotencyKey`, `fingerprint`. |
| `EventLogAppendCondition` | `{ afterOrder, eventTypes, matches? }`: what a decision read. |
| `EventLogFailure` | Typed operation failure. |

`append` atomically checks its compare-and-swap, assigns Event orders, writes
Events, and records commit boundary. Two forms of compare-and-swap exist:

- `expectedVersion`: stale unless the log is at exactly that version (a
  caller's whole-log check).
- `expectedUnchanged: { afterOrder, eventTypes, matches? }`: stale when an
  Event of one of `eventTypes` with an order above `afterOrder` is in the log
  and `matches(event)` (every such Event, when `matches` is omitted). The
  runtime uses it for every Command without a caller `expectedVersion`:
  `eventTypes` are the types the Command applies, and `matches` keeps the
  Events carrying one of its consistency keys or none. `matches` is a function
  of the stored Event, so an adapter reads the candidate Events (an indexed
  query by type and order) and filters them in process.

Either check runs under the same lock as the write, and a stale append fails
with `EventLogFailure('append')` whose cause is a
`SpecterVersionConflictError`, which the runtime retries. An adapter that
ignores `expectedUnchanged` would let conflicting decisions through, so the
Event Log conformance checks it. Every append creates commit receipt, including
commands without idempotency key. `findCommit(key)` resolves idempotency receipt.
When `append` receives a known idempotency key, it appends nothing and returns
the stored commit, including its original fingerprint, with `duplicate: true`
whatever fingerprint was passed, even when `expectedVersion` is stale. The runtime decides whether a mismatch is a
conflict (`idempotencyMode: 'exact'`).
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
| `ReactionSchedulerBinding<E>` | What `bind` receives: `{ execute }`, the executor run for each scheduled boundary. |
| `BoundReactionScheduler<E>` | What `bind` returns: `{ schedule }`. |
| `ReactionExecutor<E>` | `(context: ReactionScheduleContext) => Effect<void, E>`. |
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
the completion checkpoint. Core opens a Reaction Slice Store transaction only
for a commit containing an Event type that Reaction applies, plus one cursor
publish per 256 skipped Event Log orders and one on graceful shutdown, so a
Slice Store must not assume one transaction per commit.

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
