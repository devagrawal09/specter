# Core runtime API

**Import:** `@specter-ts/core`

**Status:** `0.4.0` main-branch preview; the published npm release remains `0.2.1`.

Slice specification builders live in
`@specter-ts/spec`; test helpers live in `@specter-ts/core/testing`.

## Purpose

The root package defines Events, completed Slice implementations, typed
envelopes, Specter App construction, and structured runtime failures. It has no
network transport and no application database schema.

## Values

| Export | Purpose |
| --- | --- |
| `createEventDefinition(type, schema)` | Defines a kebab-case Event and creates/decodes its exact payload. |
| `createSpecterApp(config, dependencies)` | Promise transport edge over native Effect runtime and supplied dependency Layer. |
| `specterErrorCodes` | Stable map of public runtime error-code strings. |
| `SpecterConformanceError` | Aggregate construction error with structured conformance diagnostics. |
| `SpecterError` | Base class for structured runtime errors with a `code`. |
| `SpecterUnknownCommandError` | The Command envelope type is not registered. |
| `SpecterUnknownQueryError` | The Query envelope type is not registered. |
| `SpecterUnknownEventError` | An emitted or persisted Event type is not registered. |
| `SpecterInvalidInputError` | A Command or Query input schema rejected its payload. |
| `SpecterInvalidOutputError` | A Query or Reaction output schema rejected its result. |
| `SpecterCommandRejectedError` | A Command handler rejected an intent or emitted no Events. |
| `SpecterVersionConflictError` | `expectedVersion` or the runtime compare-and-swap did not match the Event Log version. |
| `SpecterIdempotencyConflictError` | An idempotency key was reused for a different Command fingerprint. |
| `SpecterInvalidCommandOptionsError` | Command consistency options are malformed. |
| `SpecterEventLogOrderError` | An adapter returned non-unique, non-ascending, or stale Event orders. |
| `SpecterInfrastructureError` | An unexpected schema, adapter, handler, or Plugin failure crossed the runtime boundary. |
| `ReactionRunFailure` | Aggregate failure for one or more independently run Reaction Slices. |

`specterErrorCodes` contains:

| Key | Code |
| --- | --- |
| `commandRejected` | `SPECTER_COMMAND_REJECTED` |
| `conformanceFailed` | `SPECTER_CONFORMANCE_FAILED` |
| `eventLogOrderViolation` | `SPECTER_EVENT_LOG_ORDER_VIOLATION` |
| `idempotencyConflict` | `SPECTER_IDEMPOTENCY_CONFLICT` |
| `infrastructureFailure` | `SPECTER_INFRASTRUCTURE_FAILURE` |
| `invalidCommandOptions` | `SPECTER_INVALID_COMMAND_OPTIONS` |
| `invalidInput` | `SPECTER_INVALID_INPUT` |
| `invalidOutput` | `SPECTER_INVALID_OUTPUT` |
| `reactionFailure` | `SPECTER_REACTION_FAILURE` |
| `unknownCommand` | `SPECTER_UNKNOWN_COMMAND` |
| `unknownEvent` | `SPECTER_UNKNOWN_EVENT` |
| `unknownQuery` | `SPECTER_UNKNOWN_QUERY` |
| `versionConflict` | `SPECTER_VERSION_CONFLICT` |

## Event and Slice types

| Export | Purpose |
| --- | --- |
| `EventDraft` | Domain `type` and `payload` before persistence metadata is assigned. |
| `Event` | An Event draft plus Event Log `id` and ISO `recordedAt`. |
| `PersistedEvent` | An `Event` plus its unique global `order`. |
| `EventDefinition` | Event type, Standard Schema, typed `create`, and async `decode`. |
| `ApplyEventDefinition` | Structural Event Definition accepted by an apply registration or catalog. |
| `EventForDefinition<T>` | Infers the typed `Event` produced by an Event Definition. |
| `ApplyRegistration` | An Event Definition and its async State apply handler. |
| `CommandEnvelope` | Generic `{ type, payload }` Command envelope. |
| `CommandSlice` | Completed Command Slice implementation type. |
| `QuerySlice` | Completed Query Slice implementation type. |
| `ReactionSlice` | Completed Reaction Slice implementation type. |
| `SliceRegistration` | Heterogeneous union accepted by an app's Slice registry. |
| `CommandInputOf<T>` | Infers a Command Slice's public input. |
| `QueryInputOf<T>` | Infers a Query Slice's public input. |
| `QueryOutputOf<T>` | Infers a Query Slice's decoded public output. |
| `CommandRef<T>` | Registry-oriented Command name and optional payload reference. |
| `QueryRef<T>` | Registry-oriented Query name and optional input/result reference. |
| `CommandDispatchOptions` | `expectedVersion` and optional `idempotencyKey`. |
| `CommandDispatch` | Reaction Plugin callback for dispatching a Command. |
| `ReactionExec` | Effect executor called with output and commit-stable delivery context. |
| `ReactionPlugin` | Optional Effect factory for custom/external output; same-app `CommandEnvelope` output uses default dispatcher. |
| `ConformanceDiagnostic` | Structured construction diagnostic with code, location, and remediation fields. |

## App and runtime types

| Export | Purpose |
| --- | --- |
| `SpecterAppConfig` | Pure configuration containing Events and Slices. |
| `SpecterAppConfigOf<TApp>` | Infers the configuration carried by a typed app. |
| `SpecterApp<TConfig>` | Typed `command`, `query`, `subscribe`, and idempotent `close` operations. |
| `SpecterCommandEnvelope<TConfig>` | Union of all registered Command envelopes. |
| `SpecterQueryEnvelope<TConfig>` | Union of all registered Query envelopes. |
| `SpecterCommandType<TConfig>` | Union of registered Command names. |
| `SpecterQueryType<TConfig>` | Union of registered Query names. |
| `SpecterQueryResult<TConfig, TType>` | Output type for one registered Query name. |
| `CommandExecutionOptions` | Alias of `CommandDispatchOptions` for `app.command`. |
| `CommandExecution` | Committed Events, resulting version, duplicate flag, and Reaction completion Promise. |
| `QuerySubscriptionOptions` | Optional cancellation `AbortSignal`. |
| `SpecterOperationKind` | `'command' | 'query' | 'reaction'`. |
| `SpecterErrorCode` | Union of values in `specterErrorCodes`. |
| `ReactionRunFailureDetail` | Reaction Slice name and cause for one failed run. |

## Construction and operation order

`createSpecterApp(config, dependencies)` validates the Event catalog, Scenarios,
schemas, apply coverage, and selected implementations before exposing the app.
`dependencies` is an Effect Layer providing `EventLog` and every Store Tag
named by registered Slices.

When Reactions are registered, construction catches each Reaction cursor up
through current Event Log version. This recovers commits left unfinished by a
previous process without unrelated Command. Startup Reaction failure rejects
construction.

```ts
import { EventLog, createSpecterApp } from '@specter-ts/core'
import { createMemoryEventLogLayer } from '@specter-ts/memory'
import { Layer } from 'effect'

const config = {
  events: todoEvents,
  slices: todoSlices,
} as const

const dependencies = Layer.mergeAll(
  createMemoryEventLogLayer(),
  TodosStoreLive,
)

const app = await createSpecterApp(config, dependencies)

const execution = await app.command(
  {
    type: 'addTodo',
    payload: { todoId: 'todo-1', title: 'Ship it' },
  },
  { idempotencyKey: 'request-1' },
)

// The Event commit happened before app.command resolved.
await execution.reactions
await app.close()
```

Command input schemas run before idempotency fingerprinting. Specter stores a
versioned `v2:` fingerprint of the canonical decoded payload and passes that
same decoded value to the handler.

## Effect runtime

Import Effect integration from `@specter-ts/core/effect`. Specifications remain
Effect-free.

```ts
import { createSpecterAppLayer, SpecterRuntime } from '@specter-ts/core/effect'
import { Effect } from 'effect'

const SpecterLive = createSpecterAppLayer(todoConfig).pipe(
  Layer.provideMerge(TodoDependencies),
)

const program = Effect.gen(function* () {
  const app = yield* SpecterRuntime
  return yield* app.command({ type: 'addTodo', payload })
})
```

`makeSpecterRuntime(config)` is native interpreter and exposes exact Store,
Event Log, Scope, and typed failure requirements. Slices keep plain
async apply/handle functions. `createSpecterAppLayer(config)` acquires runtime in
Scope and exposes `SpecterRuntime` through Context. Query subscriptions are
Effect `Stream` values. `createSpecterPromiseApp(config, dependencies)` is
explicit Promise boundary used by `createSpecterApp`.

`execution.reactions` is deliberately separate from the Command commit. A
Reaction failure cannot roll back durable Events. A duplicate idempotent
Command returns the original commit with `duplicate: true` and schedules
Reaction catch-up again.

Subscriptions are latest-state streams:

```ts
const controller = new AbortController()

for await (const todos of app.subscribe(
  { type: 'todosQuery', payload: { status: 'all' } },
  { signal: controller.signal },
)) {
  console.log(todos)
}
```

They emit current Query State, coalesce intermediate invalidations for slow
consumers, and retain the newest value.

## Constraints

- Register exactly one completed implementation per lower-camel-case Slice
  name and one Event Definition per kebab-case Event type.
- Command handlers must emit at least one Event and only Event types authorized
  by accepted Scenario outcomes.
- Event schema decoding must preserve payload data one-to-one.
- Use a runtime Standard Schema at every untrusted input or output boundary;
  type-only schema builder calls do not validate runtime values.
- Generate domain IDs and timestamps before dispatch. Event Log identity and
  recorded time are metadata.
- Core is transport-agnostic. Remote access belongs in project-owned envelope
  transports.

## Related documentation

- [Core adapters API](core-adapters.md)
- [CQRS](../architecture/cqrs.md)
- [Event Sourcing](../architecture/event-sourcing.md)
- [Runtime](../architecture/runtime.md)
- [Writing specifications](../specifications/writing-specifications.md)
- [API reference](README.md)
