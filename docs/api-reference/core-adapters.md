# Core services API

**Import:** `@specter-ts/core`

Runtime dependencies are Effect `Context` services supplied by `Layer`.

## Event Log

| Export | Purpose |
| --- | --- |
| `EventLog` | Runtime service Tag. |
| `EventLogService` | `capabilities`, `query`, `readKey`, `currentVersion`, `commitsAfter`, `findCommit`, `append`. |
| `EventLogCapabilities` | `{ scopedAppend, keyedRead }`: what the adapter supports beyond appending and reading the log. |
| `EventLogDraft` | An Event to append with the `keys` core derived from its payload: one value per key name. |
| `EventLogCommit` | Durable Events, commit version/time, optional idempotency metadata. |
| `EventLogAppendResult` | Commit plus `duplicate`. |
| `EventLogAppendOptions` | `expectedVersion`, `expectedUnchanged`, `idempotencyKey`, `fingerprint`. |
| `EventLogAppendCondition` | `{ afterOrder, eventTypes, keys? }`: what a decision read. |
| `EventLogKeyPage` | `{ afterOrder?, limit? }`: a page of a keyed read. |
| `EventKey` | `{ name, value }`: one named key an Event carries. |
| `EventLogFailure` | Typed operation failure. |

`append` atomically checks its compare-and-swap, assigns Event orders, writes
Events with their keys, and records commit boundary. Core derives each Event's
keys from its payload when a Command emits it and passes them in
`EventLogDraft.keys`; an adapter stores them as given and never derives keys
itself, and a `PersistedEvent` does not carry them. Two forms of
compare-and-swap exist:

- `expectedVersion`: stale unless the log is at exactly that version (a
  caller's whole-log check).
- `expectedUnchanged: { afterOrder, eventTypes, keys? }`: stale when an Event
  of one of `eventTypes` with an order above `afterOrder` is in the log and,
  when `keys` is present, carries one of the values listed under one of its
  key names (`{ session: ['s1'], project: ['p1'] }`); with no value listed,
  nothing matches. The runtime uses it for every Command without a caller
  `expectedVersion`: `eventTypes` are the types the Command applies, and
  `keys` its consistency keys. The adapter checks it in its store from the
  stored keys: the bundled SQL adapters with one indexed query, memory and
  JSONL from their own index.

Either check runs under the same lock as the write, and a stale append fails
with `EventLogFailure('append')` whose cause is a
`SpecterVersionConflictError`, which the runtime retries. Every append creates
commit receipt, including commands without idempotency key.
`findCommit(key)` resolves idempotency receipt. When `append` receives a known
idempotency key, it appends nothing and returns the stored commit, including
its original fingerprint, with `duplicate: true` whatever fingerprint was
passed, even when `expectedVersion` is stale. The runtime decides whether a
mismatch is a conflict (`idempotencyMode: 'exact'`).
`commitsAfter(version)` returns complete commits ordered by commit version; core
uses it as durable Reaction work stream.

`readKey({ name, value }, { afterOrder, limit })` returns the Events carrying
that key, such as one aggregate's, with an order above `afterOrder` (default
0), ascending, at most `limit` (default all). A host pages through one key's
Events with it; the runtime itself does not read by key.

### Capabilities

An adapter declares `capabilities: { scopedAppend, keyedRead }`. Without a
capability it must refuse the operation rather than ignore part of it: an
append carrying `expectedUnchanged` fails with `EventLogFailure('append')`,
and `readKey` fails with `EventLogFailure('readKey')`. The runtime refuses to
start, with `SpecterEventLogCapabilityError` naming what is missing and what
uses it, on an Event Log without `scopedAppend` when the app registers a
Command, and without `keyedRead` when the host requires it
(`makeSpecterRuntime(config, { requires: { keyedRead: true } })`). An adapter
that declares no capabilities supports none. `eventLogConformance` from
`@specter-ts/core/testing` holds an adapter to its declaration: storage of
keys, the scoped check and keyed reads when declared, and the refusals when
not. Every bundled adapter declares both.

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
- Event keys are an index of the Event Log, derived by core and stored by the
  adapter with each Event.
- App Layer provides one `EventLog` and every registered Store Tag.
- Shared SQL database context lets nested Commands and outbox enqueue join active
  Reaction transaction.
- Promise API is transport edge; native Effect runtime keeps typed errors.

## Related documentation

- [Runtime API](core-runtime.md)
- [Persistence API](persistence.md)
- [Reaction outbox API](reaction-outbox.md)
