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
| `createSpecterApp(config, dependencies)` | Promise transport edge over native Effect runtime and supplied dependency Layer. Accepts a config or a `PreparedSpecterApp`. |
| `prepareSpecterApp(config)` | Validates a config once (cached by `events`/`slices` identity) and returns a `PreparedSpecterApp`. |
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
| `SpecterPluginQueryInTransactionError` | A direct Reaction Plugin called `query` inside its Slice Store transaction; permanent until the Plugin changes. |
| `ReactionRunFailure` | Aggregate failure for one or more independently run Reaction Slices; `permanent` is `true` when retrying cannot succeed. |

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
| `pluginQueryInTransaction` | `SPECTER_PLUGIN_QUERY_IN_TRANSACTION` |
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
| `CommandReceipt` | Committed `events`, resulting `version`, and `duplicate` flag returned to a Plugin; no Reaction completion. |
| `CommandDispatch` | Plugin capability dispatching a same-app Command; resolves to `CommandReceipt`. |
| `QueryDispatch` | Plugin capability `query(querySlice, input)` returning the decoded Query output; the Slice must be the registered instance; rejected permanently inside a direct Plugin's Reaction transaction. |
| `SpecterEffectError` | Union of public runtime failures; the error channel of Plugin `command` and `query`. |
| `ReactionPluginContext` | `{ command, query }` passed once to a Plugin factory. |
| `ReactionExec` | Effect executor called with output and commit-stable delivery context. |
| `ReactionPlugin<TOutput, R>` | Optional Effect factory for custom/external output; `R` lists app services it reads. Same-app `CommandEnvelope` output uses default dispatcher. |
| `ReactionPluginRequirements<T>` | Infers a Reaction Slice's Plugin service requirements, excluding `Scope`. |
| `ConformanceDiagnostic` | Structured construction diagnostic with code, location, and remediation fields. |

## App and runtime types

| Export | Purpose |
| --- | --- |
| `SpecterAppConfig` | Pure configuration containing Events and Slices. |
| `PreparedSpecterApp<TConfig>` | Validated config with derived lookup structures; accepted wherever a config is. |
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
schemas, apply coverage, and selected implementations before it resolves. An
invalid config rejects it with `SpecterConformanceError`. `dependencies` is an
Effect Layer providing `EventLog`, every Store Tag named by registered Slices,
and every service required by registered Reaction Plugins
(`SpecterRuntimeRequirements<TConfig>`). A missing Plugin service is a compile
error when the config keeps its literal Slice types, including when it is
passed as a `PreparedSpecterApp`.

Validation and the lookup maps derived from it are per config. They are cached
by the identity of `config.events` and `config.slices`, so opening many apps
from the same objects validates once, including under concurrent first use. A
failed validation is reported to every waiting caller and is not cached. A
validated config's `events` array and `slices` record are frozen; mutating
them afterwards throws.

To validate once at startup and bind many Event Logs, prepare the config
explicitly:

```ts
import { createSpecterApp, prepareSpecterApp } from '@specter-ts/core'

const prepared = await prepareSpecterApp(config)
const app = await createSpecterApp(prepared, dependenciesFor(sessionId))
```

Store resolution, Reaction scheduler binding, and Reaction and eager-Slice
catch-up are per app, and `createSpecterApp` resolves only after they finish.
When Reactions are registered, startup catches each Reaction cursor up through
current Event Log version. This recovers commits left unfinished by a previous
process without unrelated Command. A missing Store Layer, dependency Layer
failure, Event Log failure, or startup Reaction failure rejects construction
after the partially built runtime is disposed; it does not evict the validated
config from the cache.

Startup waits for the scheduler to report Reaction catch-up complete. A
permanent failure (`ReactionRunFailure.permanent`) rejects `createSpecterApp`.
The SQLite durable scheduler (`createSqliteReactionSchedulerLayer`) reschedules
any other failed Reaction pass every `retryIntervalMs` until it succeeds, so a
startup Reaction that keeps failing with a retryable error makes
`createSpecterApp` wait indefinitely instead of rejecting. Before this release
the same wait happened on the first operation. Fix the failing Reaction, or
bound the wait yourself: with the Effect API, apply `Effect.timeout` to the
Effect that builds `createSpecterAppLayer` or runs `makeSpecterRuntime`. A
built-in bound would be a small addition: an optional `startupTimeout`
accepted by `createSpecterApp` that races the startup Promise against a timer,
disposes the app, and rejects with `SpecterInfrastructureError` on expiry. It
is not implemented.

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
Plugin service, Event Log, Scope, and typed failure requirements. Slices keep plain
async apply/handle functions. `createSpecterAppLayer(config)` acquires runtime in
Scope and exposes `SpecterRuntime` through Context. Query subscriptions are
Effect `Stream` values. `createSpecterPromiseApp(config, dependencies)` is
synchronous Promise boundary: it does not wait for startup, so any
construction failure, including a raw config's conformance failure, rejects
its first and every later operation instead.

`prepareSpecterRuntime(config)` is the Effect form of `prepareSpecterApp`. It
fails with `SpecterConformanceError` and shares the same per-config cache. Each
of `createSpecterAppLayer`, `makeSpecterRuntime`, and `createSpecterPromiseApp`
accepts its `PreparedSpecterApp` in place of a config. With the Layer and
interpreter, every construction failure, including conformance, fails the
Layer or Effect.

```ts
const SessionLive = Layer.unwrap(
  prepareSpecterRuntime(sessionConfig).pipe(
    Effect.map((prepared) => createSpecterAppLayer(prepared)),
  ),
).pipe(Layer.provide(sessionDependencies))
```

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
