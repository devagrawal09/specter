# Specter Runtime

The Specter runtime assembles Event Definitions, one completed implementation
per Slice, an Event Log, and a Reaction scheduler into a typed Specter App. It
is asynchronous because construction runs executable conformance checks before
returning the app.

## Construct the app

The Todo server uses a persistence preset and registers all selected domain
parts explicitly:

```ts
const persistence = createSpecterSqlitePersistence(sqliteClient)

const app = await createSpecterApp({
  events: todoEvents,
  eventLog: persistence.eventLog,
  schedule: durableSchedule,
  slices: todoSlices,
  observe,
})
```

The `events` catalog must contain the Event Definitions used by Scenarios and
apply handlers. `slices` contains completed Command, Query, and Reaction Slice
implementations, not specifications. `observe` is optional and deliberately
best effort.

## Command timeline

For `app.command(envelope, options)`, core:

1. finds the registered Command and validates its options and input;
2. starts the Event Log transaction;
3. resolves an idempotent duplicate or reads the current Event Log version;
4. catches the Command Slice State up inside that transaction;
5. runs the handler and validates its Event types and payloads;
6. appends with compare-and-swap and commits;
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

For each Reaction Slice with unread Events, core applies them to staged State,
runs the handler, validates any output, and invokes the Reaction Plugin. The
plugin receives `deliveryId` and `scheduledAt`, which are stable across retries,
plus attempt-specific `attemptId` and `attemptNumber`.

The immediate memory scheduler is deterministic but not crash-safe. For
persistent apps, connect a durable outbox scheduler and worker. A failed
projection does not advance its cursor, so a later pass can replay safely.

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

For cross-language boundaries, Specter also publishes a versioned,
language-neutral description of observable runtime behavior and a reference
JSON HTTP/SSE binding. It standardizes capability negotiation, Commands,
Queries, subscriptions, Reaction-completion tickets, structured errors, and
runtime-observation batches without moving application Slice definitions,
handlers, schemas, or persistence layouts across languages.

Protocol implementations require matching major versions, negotiate named
capabilities, tolerate unknown optional fields, and reject unsupported required
capabilities. TypeScript and Go conform independently against shared fixtures.
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
