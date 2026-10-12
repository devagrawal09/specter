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
| `createEventDefinition(type, schema, options?)` | Defines a kebab-case Event and creates/decodes its exact payload. `options.keys` declares the named [Event keys](../architecture/event-sourcing.md#event-keys) each Event carries: `{ name: (payload) => value \| undefined }`. |
| `eventKeys(definition, payload)` | The keys one Event carries, by name, as core stores them: for a host that appends to an Event Log itself. |
| `CommandRejection<TCode>` | What a Command handler throws to reject: `new CommandRejection(code, message, details?)`, with a stable kebab-case `code`. |
| `eventsFor(slice, fullCatalog)` | Selects the Event Definitions one Slice needs: Given/apply Events and accepted Command outcomes. An app that registers some Slices of a larger catalog registers the union over its Slices. |
| `createSpecterApp(config, dependencies)` | Promise transport edge over native Effect runtime and supplied dependency Layer. Accepts a config or a `PreparedSpecterApp`. |
| `extendSpecterConfig(config, { slices?, events? })` | A config with more Slices and the Event Definitions they need beside another's, typed as both: a test's runtime with a test-only Slice. Throws for a Slice the config already registers. |
| `prepareSpecterApp(config)` | Validates a config once (cached by `events`/`slices` identity) and returns a `PreparedSpecterApp`. |
| `specterErrorCodes` | Stable map of public runtime error-code strings. |
| `SpecterConformanceError` | Aggregate construction error with structured conformance diagnostics. |
| `SpecterError` | Base class for structured runtime errors with a `code`. |
| `SpecterUnknownCommandError` | The Command envelope type is not registered. |
| `SpecterUnknownQueryError` | The Query envelope type is not registered. |
| `SpecterUnknownEventError` | An emitted or persisted Event type is not registered. |
| `SpecterInvalidInputError` | A Command or Query input schema rejected its payload. |
| `SpecterInvalidOutputError` | A Query or Reaction output schema rejected its result. |
| `SpecterCommandRejectedError<TCode>` | A Command handler rejected an intent; `rejection` is the `CommandRejection` it threw. `TCode` narrows its code for a host that knows its Commands, such as to `SpecterRejectionCode<typeof config>`. |
| `SpecterEventLogCapabilityError` | The Event Log lacks a capability the app uses; `missing` names it. |
| `SpecterVersionConflictError` | `expectedVersion` did not match the Event Log version, or the runtime's scoped compare-and-swap kept losing to writers of Events the decision read, after its retries. |
| `SpecterIdempotencyConflictError` | Under `idempotencyMode: 'exact'`, an idempotency key was reused for a different Command fingerprint. |
| `SpecterInvalidCommandOptionsError` | Command options are malformed, including an `eventContext` that returned an invalid ID or time. |
| `SpecterEventLogOrderError` | An adapter returned non-unique, non-ascending, or stale Event orders. |
| `SpecterInfrastructureError` | An unexpected schema, adapter, handler, or Plugin failure crossed the runtime boundary. |
| `SpecterPluginQueryInTransactionError` | A direct Reaction Plugin called `query` inside its Slice Store transaction; permanent until the Plugin changes. |
| `ReactionRunFailure` | Aggregate failure for one or more independently run Reaction Slices; `permanent` is `true` when retrying cannot succeed. |

`specterErrorCodes` contains:

| Key | Code |
| --- | --- |
| `commandRejected` | `SPECTER_COMMAND_REJECTED` |
| `conformanceFailed` | `SPECTER_CONFORMANCE_FAILED` |
| `eventLogCapability` | `SPECTER_EVENT_LOG_CAPABILITY` |
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
| `PersistedEvent` | An Event as the Event Log recorded it: its draft plus `id`, ISO `recordedAt`, unique global `order`, and the `keys` stored with it. Apply handlers receive it. |
| `EventContext` | What a host supplies with one emitted Event through `eventContext`: an optional `id`, ISO `recordedAt`, and opaque `metadata` for the Event Log adapter. |
| `EventDefinition` | Event type, Standard Schema, typed `create`, async `decode`, and optional named `keys`. |
| `EventDefinitionOptions` | Optional `keys`: a function per key name returning the key's value, or `undefined` when the Event has none. |
| `EventKey` | `{ name, value }`: one named key an Event carries. |
| `EventKeyFunction<T>` / `EventKeyFunctions<T>` | One key's function, and a definition's functions by name. |
| `ApplyEventDefinition` | Structural Event Definition accepted by an apply registration or catalog. |
| `EventForDefinition<T>` | Infers the typed `PersistedEvent` an apply handler receives for an Event Definition. |
| `ApplyRegistration` | An Event Definition and its async State apply handler. |
| `CommandEnvelope` | Generic `{ type, payload }` Command envelope. |
| `CommandSlice` | Completed Command Slice implementation type; optional `consistencyKeys` names the Event keys its decision reads, each derived from the Command and the State it decided from. |
| `SliceStoreOptions` | `.store(Tag, options)`: `eager` catches the Slice up at startup, and `stateVersion` (a positive integer, 1 by default) is the version of its State, which with the specification digest makes the version its Store keeps the State under (`SliceStoreSlice`); raise it when the State changes shape and the specification does not. A Reaction of a new version folds up to what it delivered without delivering it again. A completed Slice carries both. |
| `CommandRejectionCode<T>` | The codes a Command Slice rejects with, from its Scenarios: exact when implemented from a declared `spec.json` or built in TypeScript, `string` from a plain JSON import, `never` for another kind of Slice. |
| `ConsistencyKey<C, S>` / `ConsistencyKeys<C, S>` | One consistency key's function, returning one value, several, or `undefined`; and a Command's functions by key name. |
| `QuerySlice` | Completed Query Slice implementation type. |
| `ReactionSlice` | Completed Reaction Slice implementation type; `key` names the Event key one completed with `.handleEachKey` handles. |
| `SliceRegistration` | Heterogeneous union accepted by an app's Slice registry. |
| `CommandInputOf<T>` | Infers a Command Slice's public input. |
| `QueryInputOf<T>` | Infers a Query Slice's public input. |
| `QueryOutputOf<T>` | Infers a Query Slice's decoded public output. |
| `CommandRef<T>` | Registry-oriented Command name and optional payload reference. |
| `QueryRef<T>` | Registry-oriented Query name and optional input/result reference. |
| `CommandDispatchOptions` | Optional `expectedVersion`, `idempotencyKey`, `idempotencyMode` (requires a key), and `eventContext: (draft, index) => EventContext \| undefined`. |
| `CommandIdempotencyMode` | `'first-wins'` (default) returns the first commit for a key regardless of payload; `'exact'` also requires a matching fingerprint. |
| `CommandReceipt` | Committed `events`, resulting `version`, and `duplicate` flag returned to a Plugin; no Reaction completion. On a duplicate, `events`/`version` are the first commit for the key and may differ from this call's payload. |
| `CommandDispatch` | Plugin capability dispatching a same-app Command; resolves to `CommandReceipt`. |
| `QueryDispatch` | Plugin capability `query(querySlice, input)` returning the decoded Query output; the Slice must be the registered instance; rejected permanently inside a direct Plugin's Reaction transaction. |
| `SpecterEffectError` | Union of public runtime failures; the error channel of Plugin `command` and `query`. |
| `ReactionPluginContext` | `{ command, query }` passed once to a Plugin factory. |
| `ReactionDeliveryContext` | `deliveryId` (`reaction:version`, or `reaction:version:value` for a keyed Reaction), `throughOrder`, and `scheduledAt`. |
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
| `SpecterRejectionCode<TConfig>` | Union of the codes the app's Commands reject with, from their Scenarios. |
| `ExtendedSpecterAppConfig<TConfig, TSlices>` | What `extendSpecterConfig` returns: the config's Slices and the extension's. |
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

Store resolution, the Event Log's capabilities, Reaction scheduler binding,
and Reaction and eager-Slice catch-up are per app, and `createSpecterApp`
resolves only after they finish. An app with a Command refuses an Event Log
without `capabilities.scopedAppend` with `SpecterEventLogCapabilityError`.
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

A repeated `idempotencyKey` returns the first commit for that key with
`duplicate: true`, even when the payload differs. Pass
`idempotencyMode: 'exact'` to raise `SpecterIdempotencyConflictError` instead
when the payload or Command type differs:

```ts
await app.command(envelope, {
  idempotencyKey: 'request-1',
  idempotencyMode: 'exact',
})
```

Command input schemas run before idempotency fingerprinting. Specter stores a
versioned `v2:` fingerprint of the Command type and canonical decoded payload
in both modes and passes that same decoded value to the handler. The key lookup
runs before the `expectedVersion` check, so a duplicate never reports a version
conflict. See [Runtime](../architecture/runtime.md#idempotency).

## Consistency keys and keyed Reactions

A Command appends with a compare-and-swap scoped to what it read: the Event
types it applies. Declaring `consistencyKeys` narrows it to the Events that
carry one of the returned values under that key name:

```ts
import { createEventDefinition, implementCommand } from '@specter-ts/core'

export const todoRenamed = createEventDefinition('todo-renamed', schema, {
  keys: { todo: (payload) => payload.todoId },
})

export const renameTodo = implementCommand(specification)
  .inputSchema(renameTodoSchema)
  .store(RenameTodoStore)
  .consistencyKeys({ todo: (command) => command.todoId })
  .apply(todoRenamed, applyTodoRenamed)
  .handle(handleRenameTodo)
```

Each key function also receives the read-only State the decision read, for
keys the input does not name, and returns one value, several, or `undefined`.
A stale append still runs catch-up and the decision again, up to 32 times,
scoped the same way. Every Event type the Command applies must declare one of
its key names, and every Event of those types must carry one; core checks each
emitted Event's keys before the append and stores them with it. Scenario
runners hold a Command with consistency keys to its promise; see
[Command consistency](../architecture/event-sourcing.md#command-consistency).

A Reaction completed with `.handleEachKey('todo', (state, todoId) => output)`
runs once for each value of that key the relevant commit's Events carry, each
output its own delivery (`reaction:version:value`). Every Event type it
applies must declare the key. See
[Keyed Reactions](../architecture/runtime.md#keyed-reactions).

## Command rejections

A handler rejects by throwing a `CommandRejection`:

```ts
import { CommandRejection } from '@specter-ts/core'

if (!title) throw new CommandRejection('title-required', 'Todo title is required')
if (title.length > 120) {
  throw new CommandRejection('title-too-long', 'Todo title is too long', {
    maxLength: 120,
  })
}
```

The caller receives a `SpecterCommandRejectedError` (`SPECTER_COMMAND_REJECTED`)
whose `rejection` holds the `code`, `message` and `details`. Hosts match on
`rejection.code`, which is stable; the message is for people. Every code a
Command rejects with must appear in one of its rejected Scenarios
(`reject: { code: 'title-required' }`). A code none names, any other error the
handler throws, and a handler that emits no Events fail with
`SpecterInfrastructureError` instead: they are defects, not decisions. The
rejection code is recorded on the Command's span as
`specter.command.rejection.code`.

### Rejection codes as types

The codes a Command rejects with are in its Scenarios, so they are a type.
`specter-spec export` writes `spec.d.json.ts` beside each `spec.json`, which
TypeScript reads for its import when `tsconfig.json` sets
`allowArbitraryExtensions`; `implementCommand` then knows the Slice's name and
rejection codes:

```ts
import {
  SpecterCommandRejectedError,
  type SpecterRejectionCode,
} from '@specter-ts/core'

type TodoRejection = SpecterRejectionCode<typeof todoConfig>
// 'title-required' | 'title-too-long' | 'todo-not-found' | ...

function isRejection(
  error: unknown,
): error is SpecterCommandRejectedError<TodoRejection> {
  return error instanceof SpecterCommandRejectedError
}
```

`CommandRejectionCode<typeof addTodo>` is one Command's union. A Command built
with `createCommandSlice` in TypeScript is exact too; one implemented from a
plain JSON import, without the declaration, has `string` codes.

## Host context on dispatch

`eventContext` gives each Event a Command emits the host's ID, recorded time
and metadata for the Event Log adapter:

```ts
await app.command(
  { type: 'addTodo', payload },
  {
    eventContext: (draft, index) => ({
      id: eventIds[index],
      recordedAt: new Date(requestTime).toISOString(),
      metadata: { requestId },
    }),
  },
)
```

Core calls it after the decision, once per Event with the validated draft and
its position in the commit, for each attempt that appends. An Event it
returns `undefined` for takes the Event Log's ID and time. The Event is stored
under the given `id` and `recordedAt`, which the receipt's `events` and every
later read return; `metadata` is opaque to Specter and reaches the adapter in
`EventLogDraft.metadata`, and the bundled adapters store none of it. An `id`
must be non-blank and unique in the log, and `recordedAt` an ISO-8601 UTC
timestamp as `toISOString` writes it: an invalid context fails with
`SpecterInvalidCommandOptionsError`, a throwing one with
`SpecterInfrastructureError`, and an ID already in the log fails the append,
all before anything is appended. See
[Host context on dispatch](../architecture/event-sourcing.md#host-context-on-dispatch).

## Test-only Slices

`extendSpecterConfig(config, { slices, events })` returns a config with the
extension's Slices and Event Definitions beside the config's, typed as both,
so a test's app dispatches a test-only Command and the production config's
type never names it:

```ts
const testConfig = extendSpecterConfig(todoConfig, {
  slices: { recordHistory },
  events: historyEvents,
})
```

A Slice name the config already registers throws a `TypeError`: an extension
never replaces a Slice. With no `slices`, the result has the config's type.
Each call builds a new `events` array and `slices` record, which validate on
their own, so build the extended config once.

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

`makeSpecterRuntime(config, { reactions: 'deferred' })` makes the runtime with
its Reactions held and returns a `SpecterDeferredEffectApp`: the Effect app
plus `start`, an Effect that requires the Plugins' services
(`SpecterPluginRequirements<TConfig>`), which the runtime itself then does not
(`SpecterDeferredRuntimeRequirements<TConfig>`). Until `start`, a Command's
`reactions` completes at once. `start` initializes every Plugin in the
runtime's scope, binds the scheduler and runs every Reaction through the log,
once; a later call waits for the first. See
[When Reactions start](../architecture/runtime.md#when-reactions-start).

```ts
const app = yield* makeSpecterRuntime(config, { reactions: 'deferred' })
yield* app.command(envelope) // its Reactions wait for start
yield* app.start.pipe(Effect.provideService(Notifier, notifier))
```

`makeSpecterRuntime(config, { requires: { keyedRead: true, purge: true } })`
and the same option of `createSpecterAppLayer` declare Event Log capabilities
the host relies on beside those the runtime needs (reading by key, purging a
key); the runtime refuses to start on an Event Log that lacks one.

`readPageSize` (1000 by default) is how many Events a Slice's catch-up, and
how many commits a Reaction's, reads from the Event Log at a time; see
[Paged reads](core-adapters.md#paged-reads).

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
Command returns the original commit with `duplicate: true` (first commit wins
unless `idempotencyMode: 'exact'`) and schedules Reaction catch-up again.

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
  by accepted Scenario outcomes, or throw a `CommandRejection` whose code a
  rejected Scenario names.
- Event schema decoding must preserve payload data one-to-one.
- Use a runtime Standard Schema at every untrusted input or output boundary;
  type-only schema builder calls do not validate runtime values.
- Generate domain IDs and timestamps before dispatch. Event Log identity and
  recorded time are metadata, which a host may supply per Event with
  `eventContext` and a fold may read.
- Core is transport-agnostic. Remote access belongs in project-owned envelope
  transports.

## Related documentation

- [Core adapters API](core-adapters.md)
- [CQRS](../architecture/cqrs.md)
- [Event Sourcing](../architecture/event-sourcing.md)
- [Runtime](../architecture/runtime.md)
- [Writing specifications](../specifications/writing-specifications.md)
- [API reference](README.md)
