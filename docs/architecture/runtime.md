# Specter Runtime

Specter runtime assembles Event Definitions and one completed implementation
per Slice into typed app. Effect Layer supplies Event Log, Reaction scheduler,
and every Slice Store at runtime. Construction runs executable conformance
checks before exposing app.

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

For each Reaction Slice, core reads Event Log commits after its cursor. It runs
projection, handler, and plugin once per commit inside the Slice Store
transaction, then advances the cursor. Failure rolls back state and cursor, so
restart retries the same commit with the same `deliveryId`, derived from
Reaction name and commit version.

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
effects with `withReactionOutbox`; enqueue then commits atomically, while the
outbox worker owns leases, retries, dead-lettering, and replay outside the Slice
transaction.

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

For cross-language observability, Specter publishes a versioned,
language-neutral description of runtime-observation metadata and a one-endpoint
JSON HTTP binding. Runtimes send `observations.batch` messages to a collector;
the collector returns `observations.ack`. Matching major versions are required,
and unknown optional fields are tolerated.

This protocol observes Command, Query, subscription, projection, and Reaction
activity but does not invoke them. Application Slice definitions, handlers,
schemas, persistence layouts, and remote APIs remain language-native. The
dashboard and CLI query the collector's separate read API. TypeScript and Go
telemetry implementations conform independently against shared fixtures.
See the [protocol overview](../../protocol/README.md),
[behavioral contract](../../protocol/behavior.md), and
[HTTP binding](../../protocol/http-binding.md).

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
- Observability failures are swallowed by core and cannot turn a successful
  domain operation into a failure.

Expected contract failures use stable `SpecterError` codes. Unexpected adapter,
schema, and scheduler failures become `SpecterInfrastructureError`. Construction
failures use `SpecterConformanceError` with detailed diagnostics.

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
