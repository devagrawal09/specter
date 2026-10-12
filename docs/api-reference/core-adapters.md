# Core services API

**Import:** `@specter-ts/core`

Runtime dependencies are Effect `Context` services supplied by `Layer`.

## Event Log

| Export | Purpose |
| --- | --- |
| `EventLog` | Runtime service Tag. |
| `EventLogService` | `capabilities`, `query`, `readKey`, `currentVersion`, `commitsAfter`, `findCommit`, `append`. |
| `EventLogCapabilities` | `{ scopedAppend, keyedRead }`: what the adapter supports beyond appending and reading the log. |
| `EventLogDraft` | An Event to append with the `keys` core derived from its payload (one value per key name) and the host's context: an optional `id`, `recordedAt` and opaque `metadata`. |
| `EventLogCommit` | Durable Events, commit version/time, optional idempotency metadata. |
| `EventLogAppendResult` | Commit plus `duplicate`. |
| `EventLogAppendOptions` | `expectedVersion`, `expectedUnchanged`, `idempotencyKey`, `fingerprint`. |
| `EventLogAppendCondition` | `{ afterOrder, eventTypes, keys? }`: what a decision read. |
| `EventLogPage` | `{ limit? }`: a page of `query` or `commitsAfter`. |
| `EventLogKeyPage` | `{ afterOrder?, limit? }`: a page of a keyed read. |
| `EventKey` | `{ name, value }`: one named key an Event carries. |
| `EventLogFailure` | Typed operation failure. |

`append` atomically checks its compare-and-swap, assigns Event orders, writes
Events with their keys, and records commit boundary. Core derives each Event's
keys from its payload when a Command emits it and passes them in
`EventLogDraft.keys`; an adapter stores them as given, never derives keys
itself, and returns them with the Event (`PersistedEvent.keys`, empty for an
unkeyed Event) from `append` and every read: `query`, `commitsAfter`,
`findCommit` and `readKey`. Core refuses an Event read back without them.

A draft may carry the host's context. An adapter stores the Event under
`EventLogDraft.id` and `recordedAt` when present, and under an ID it generates
and its own clock's time when not; an ID already in the log fails the append,
which then appends nothing. `metadata` is the host's, for its own adapter's
use in the append (a projection, a hook); the bundled adapters keep none of
it, and it is never part of a `PersistedEvent`. The commit's `committedAt`
stays the Event Log's own time. Two forms of compare-and-swap exist:

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

### Paged reads

`query(afterOrder, eventTypes, { limit })` returns at most `limit` Events and
`commitsAfter(version, { limit })` at most `limit` whole commits (a page
counts commits, not their Events), each the first after where the read
starts; without a `limit` every remaining one. Core reads the log one page at
a time while a Slice catches up (Events) and while a Reaction catches up
(commits), starting each read after the last item of the page before, so a
first boot on a long log never holds more than a page; the page size is the
runtime's `readPageSize` (1000 by default). An adapter must honor `limit`;
the conformance checks it.

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
keys and their return with every read, the host's IDs and times and the
refusal of an ID already in the log, the scoped check and keyed reads when
declared, and the refusals when not. Every bundled adapter declares both.

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

Both operations receive the Slice as `SliceStoreSlice`: its `name` and its
State's `version`. The version changes with the Slice's specification digest
and with the `stateVersion` its implementation declares
(`.store(Tag, { stateVersion: 2 })`, 1 by default), so a State of another
shape has another version. A Store that keeps State across processes keeps
the version with it and never returns State kept under another version: it
starts that Slice empty at cursor 0, so the Slice folds the log from its
start, and the Slice's next commit replaces the old State. A Store whose
schema the host migrates itself (a Drizzle projection) may ignore it.

A Reaction is a Slice like any other: a new version starts its cursor at 0,
so it handles every relevant commit of the log again under its usual
`deliveryId`, and its deliveries must stay idempotent.

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

## Slice snapshots

| Export | Purpose |
| --- | --- |
| `SliceSnapshot` | `{ slice, version, state, cursor }`: one Slice's State as of its cursor, under its version. |
| `SliceSnapshotStore` | `load` and `save(snapshots)`: where a host keeps snapshots between processes. |

A host whose Slices fold in memory saves their snapshots so that a later
process catches each Slice up after its cursor instead of folding the log
from its start (`persistSliceSnapshots` in `@specter-ts/memory`). A snapshot
is a cache of the log, never authority: a Slice whose version differs from
its snapshot's ignores it and folds the log. `save` replaces a Slice's
snapshot unless the saved one has the same version and a later cursor, and a
snapshot of another version always replaces it. `sliceSnapshotStoreConformance`
holds a store to it.

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

- Event Log is authority; Slice Stores are rebuildable views/checkpoints, and
  State kept under another version of its Slice is never read.
- Event keys are an index of the Event Log, derived by core when an Event is
  appended, stored by the adapter with it and returned with it on every read.
- App Layer provides one `EventLog` and every registered Store Tag.
- Shared SQL database context lets nested Commands and outbox enqueue join active
  Reaction transaction.
- Promise API is transport edge; native Effect runtime keeps typed errors.

## Related documentation

- [Runtime API](core-runtime.md)
- [Persistence API](persistence.md)
- [Reaction outbox API](reaction-outbox.md)
- [Core testing API](core-testing.md)
