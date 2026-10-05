# Specter Runtime

Specter runtime assembles Event Definitions and one completed implementation
per Slice into typed app. Effect Layer supplies Event Log, Reaction scheduler,
and every Slice Store at runtime. Construction runs conformance checks once
per config before exposing app.

## Construct the app

The Todo server uses a persistence preset and registers all selected domain
parts explicitly:

```ts
const persistence = createSpecterSqlitePersistence(sqliteClient)

const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, persistence.eventLog),
  durableSchedulerLayer,
  todoStoreLayers,
)

const app = await createSpecterApp(
  { events: todoEvents, slices: todoSlices },
  dependencies,
)
```

The `events` catalog must contain the Event Definitions used by Scenarios and
apply handlers. `slices` contains completed Command, Query, and Reaction Slice
implementations, not specifications. Infrastructure lives in supplied Layer,
not registry.

## Per-config and per-log work

Construction has two halves:

| Half | Work | Runs |
| --- | --- | --- |
| Per config | Conformance (names, uniqueness, Scenario examples against schemas, apply coverage, Event coverage) and the lookup maps derived from it | once per `events`/`slices` object pair |
| Per log | Store resolution from the Layer, Reaction scheduler binding, Reaction catch-up, eager-Slice catch-up | once per app |

The per-config half is cached by the identity of the `events` array and the
`slices` record. Rebuilding the outer `{ events, slices }` object per app still
hits the cache; rebuilding either inner object misses it. A content digest is
not used: conformance checks EventDefinition identity, and Slices carry handler
functions that no digest covers. Once a config validates, its `events` array
and `slices` record are frozen, so adding or replacing an Event or Slice later
throws a `TypeError` instead of being silently ignored by the cached plan;
build a new array or record to change an app's registrations. Concurrent first
use shares one in-flight validation, which runs detached from any single
caller (it has no caller span parent). A failed validation rejects every
waiting caller and is not cached.

A `PreparedSpecterApp` is branded, so only `prepareSpecterApp` and
`prepareSpecterRuntime` can create one in typed code. A look-alike wrapper that
was not created by this copy of core (hand-built, or from a duplicated package)
is unwrapped and its `config` validated through the same cache.

Apps that open many logs from one config, such as one app per session, can
validate explicitly at startup and bind the result many times:

```ts
const prepared = await prepareSpecterApp({
  events: sessionEvents,
  slices: sessionSlices,
})

// Later, per session. No conformance work runs here.
const app = await createSpecterApp(prepared, sessionDependencies(sessionId))
```

The Effect API has the same split: `prepareSpecterRuntime(config)` returns the
prepared value, which `createSpecterAppLayer` and `makeSpecterRuntime` accept in
place of a config.

## Where construction errors surface

| Error | `prepareSpecterApp` / `prepareSpecterRuntime` | `createSpecterApp` | `createSpecterAppLayer` / `makeSpecterRuntime` | `createSpecterPromiseApp` |
| --- | --- | --- | --- | --- |
| `SpecterConformanceError` (invalid config) | rejects / fails | rejects | fails the Layer or Effect | first and every later operation rejects |
| `SpecterStoreConfigurationError` (missing or malformed Store Layer) | not checked | rejects | fails the Layer or Effect | first and every later operation rejects |
| Dependency Layer, `EventLogFailure`, scheduler, startup Reaction, or eager catch-up failure | not checked | rejects | fails the Layer or Effect | first and every later operation rejects |

`createSpecterApp` resolves only after per-log startup has finished, so
application code that starts its own database work afterwards (an outbox
worker, for example) never overlaps startup catch-up. When startup fails it
disposes the partially built runtime before rejecting. `createSpecterPromiseApp`
returns synchronously; its startup failure is kept and rejects every
operation, and an app that is never called does not produce an unhandled
rejection.

## Command timeline

For `app.command(envelope, options)`, core:

1. finds the registered Command and validates its options and input;
2. resolves an idempotent duplicate or reads current Event Log version;
3. catches Command Slice State up in Store transaction;
4. runs handler against committed read State outside Store transaction;
5. validates emitted Event types and payloads;
6. atomically appends with expected-version compare-and-swap;
7. starts affected subscription invalidation and requests a Reaction pass.

The outer Promise resolves with a durable commit receipt after the Reaction pass
has been requested; it does not await subscription refresh or Reaction work.
The returned `reactions` Promise tracks those independently runnable tasks:

```ts
const execution = await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})

// The Events are already durable.
await execution.reactions
```

A rejected Command appends nothing. A Reaction failure rejects
`execution.reactions` but never reverses the commit. Retrying the Command solely
because a Reaction failed can duplicate domain intent; use an idempotency key.

## Queries and subscriptions

`app.query(envelope)` validates the input, catches up the Query's projection in
a Slice Store transaction, runs the handler, and validates the output.

`app.subscribe(envelope, { signal })` is an async iterable of latest Query
State, not Event history. Each subscriber receives an initial result and its
own subsequent invalidations. Slow consumers may skip intermediate states, but
the newest value is retained. Pass an `AbortSignal` and call the iterator's
`return()` when the consumer disconnects.

Starting and iterating a subscription can access the database. A remote
transport with request-scoped context must keep that context alive through
activation, every `next()`, cancellation, and cleanup.

## Reactions

For each Reaction Slice, core reads Event Log commits after its cursor. A
commit is relevant when it contains an Event type the Reaction applies; `handle`
only sees State built by those apply handlers, so no other commit can change
its output. For each relevant commit, core runs projection, handler, and plugin
inside the Slice Store transaction, then advances the cursor to that commit
version. Failure rolls back state and cursor, so restart retries the same
commit with the same `deliveryId`, derived from Reaction name and commit
version.

Irrelevant commits open no Slice Store transaction. The next relevant commit's
cursor covers them, and core remembers the skipped range in process so later
runs do not re-read it. Whenever a skipped run reaches 256 Event Log orders,
including inside a long startup catch-up, one transaction publishes the cursor
to the last skipped commit. Graceful shutdown publishes any shorter remembered
tail, so a clean restart starts at the head. These publishes never move a
cursor backwards and publish nothing if the cursor is older than the skipped
range.

After a crash, a Reaction re-reads the unpublished skipped tail: under 256
Event Log orders of irrelevant commits, plus at most the commit that crossed
that limit. Re-reading runs no handler, plugin, or transaction, so it has no
side effects. A Reaction without apply handlers never runs `handle`, so every
commit is irrelevant to it and its cursor moves only through these publishes.

When a deploy adds an apply handler to an existing Reaction, commits before its
cursor stay unapplied, as before. If the previous process crashed, commits of
the newly applied type inside that unpublished tail become relevant and are
delivered once with their usual `deliveryId`. Keep those deliveries idempotent,
or shut the old process down cleanly first.

The scheduler coordinates wakeups; it does not own Reaction correctness.
Single-process apps use the default in-memory scheduler. Stateless or
distributed apps provide a durable scheduler adapter backed by Redis, SQLite,
or another shared store. Scheduler state is rebuildable from Event Log commits
and Reaction cursors during startup. Every bound durable worker independently
discovers pending and expired shared work, so failover does not need another
Command.
Scheduling acknowledges adapter acceptance before Command completion and
returns a separate Effect used by `execution.reactions` to await processing.

Direct plugins hold the Slice Store transaction open. Wrap slow external
effects with `withReactionOutbox`; with SQL Stores the enqueue then commits
atomically with the Reaction cursor, and the JSONL Store writes the enqueue
before the cursor and treats a replayed `deliveryId` as a no-op. The outbox
worker owns leases, retries, dead-lettering, and replay outside the Slice
transaction. Plugin `query` is rejected inside a direct Plugin's transaction and
runs normally from the outbox worker; see [Plugins](plugins.md).

## In process and across a transport

Core is transport-agnostic. Server-side or in-process code calls typed
envelopes directly. A remote client calls a project-owned transport that
allowlists registered Commands and Queries, maps structured Specter errors,
and preserves the two-stage Command completion contract.

The generated project demonstrates HTTP for Commands and Queries and SSE for
subscriptions. Its browser transport preserves two-stage Command completion:
the outer Promise settles from the committed response, while
`execution.reactions` observes a separate completion endpoint. Subscriptions
use abortable, reconnect-capable SSE.

## Native runtime tracing

TypeScript core emits native Effect spans for Commands, Queries, Reactions, and
Slice catch-up. Applications choose and configure Effect's OpenTelemetry layer,
exporter, endpoint, and backend; core does not send telemetry by itself.

Span names are `specter.command <name>`, `specter.query <name>`,
`specter.reaction <name>` (one per relevant commit),
`specter.reaction.cursor <name>` (a skipped-tail cursor publish), and
`specter.slice.catch-up <name>`. Attributes carry
the Slice name, kind, specification digest, outcome, Event types and orders,
Event Log versions, cursor ranges, and safe error codes. Command, Event, Query,
Reaction, and Scenario payload values are never added. Successful operations
do not produce routine Specter logs. Failed spans end with a redacted Specter
error, so OpenTelemetry status text and exception events cannot expose the
original handler error or payload-derived values; callers still receive the
original typed failure.

The same `specificationDigest` is available on every completed TypeScript Slice
and in its span metadata. Standard trace tools can therefore filter by
`specter.slice.name` or `specter.spec.digest` without Specter owning trace
storage or a dashboard.

JSON boundaries must reject non-JSON values such as `undefined`, `bigint`,
non-finite numbers, functions, symbols, `Map`, `Set`, class instances, and
cyclic objects. Encode dates as ISO strings. Core can accept richer in-process
values when the application's schemas permit them.

## Schema modes

Schema builder overloads have different runtime guarantees:

| Form | TypeScript types | Runtime validation and transformation | Use |
| --- | --- | --- | --- |
| `.inputSchema<MyInput>()` | yes | no | trusted in-process input |
| `.inputSchema(schema)` | inferred | yes | HTTP, RPC, queue, webhook, or other untrusted input |
| `.outputSchema<MyOutput>()` | yes | no | trusted internal output |
| `.outputSchema(schema)` | inferred | yes | public Query or Reaction Plugin boundary |

Exact Scenarios test examples, but they do not replace a runtime Standard
Schema at an untrusted boundary.

## Operational presets and failures

- Memory adapters are deterministic and suited to tests and local tools.
- SQLite is the default single-process persistent preset.
- Postgres provides multi-process persistence and database-level
  serialization.
- Durable Reaction delivery uses `@specter-ts/reaction-outbox`.
- Trace export is application-owned and stays outside domain correctness.

Expected contract failures use stable `SpecterError` codes. Unexpected adapter,
schema, and scheduler failures become `SpecterInfrastructureError`. Invalid
configs fail with `SpecterConformanceError` and detailed diagnostics; see
[Where construction errors surface](#where-construction-errors-surface).

## Browser validation

Generated projects separate Vitest and Playwright globs and use a strict fixed
five-digit port. Run `pnpm test:e2e:preflight` before browser tests so the
installed Playwright package and browser revision are verified explicitly. A
passing preflight is only an environment check; the browser workflow must still
run before claiming end-to-end coverage.

## Related documentation

- [Introduction](../introduction.md)
- [CQRS](cqrs.md)
- [Event Sourcing](event-sourcing.md)
- [Plugins](plugins.md)
- [Core runtime API](../api-reference/core-runtime.md)
- [Persistence API](../api-reference/persistence.md)
- [Reaction outbox API](../api-reference/reaction-outbox.md)
- [Documentation](../README.md)
