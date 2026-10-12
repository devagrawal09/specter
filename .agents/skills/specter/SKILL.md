---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Events, Slices, scenarios, envelope calls, transports, adapters, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript app composed from Vertical Features under `src/features`.
- Events are exact durable domain facts emitted by accepted Commands. Event Log IDs, global order, recorded timestamps, and stored keys are metadata outside Event payloads; apply handlers can read them, and a host may supply an Event's ID and recorded time when it dispatches.
- A Slice Specification is the immutable structural "what": name, description, and executable Scenarios.
- A Slice Implementation is the "how": schemas, Reaction Plugin, private Store, typed apply handlers, and handler.
- One specification may have divergent implementations. A Specter App registers exactly one completed implementation per lower-camel-case registry key. That key owns the TypeScript operation name and must exactly match the loaded JSON specification name.
- The Event Log is the durable source of truth. Slice State is a disposable event-derived projection.
- Runtime seams and `createSpecterApp` are async.
- Core is transport-agnostic. Remote UIs call a project-owned typed envelope transport; in-process apps may call the Specter App directly.

## Canonical Imports

- Use `@specter-ts/spec` in `spec.ts` for Slice specification builders, portable specification types, and `event(type, payload)`.
- Use `@specter-ts/core` in implementations and runtime wiring for Event Definitions, app creation, envelope/reference types, adapters, and structured errors.
- Use `@specter-ts/core/testing` for Scenario tests, focused Event catalogs, and replay helpers.
- Use local `src/db/*` and `src/transport/*` modules for stores, persistence, Scenario database setup, HTTP/SSE transport, and schema exports.
- Do not import `@specter-ts/core/client`; that subpath does not exist in Specter 0.4.

## Slice Files

Every Slice contract requires these two files:

- `spec.ts` default-exports exactly one specification and defines only `name → description → scenarios`.
- `impl.ts` imports adjacent generated `spec.json`, passes it to the kind-specific `implementCommand`, `implementQuery`, or `implementReaction` function, and exports `<sliceName>` after completing the implementation stages.

The implementation never imports or executes `spec.ts`. Run `specter-spec export src/features` before TypeScript build, test, or typecheck so every `spec.ts` produces an adjacent ignored `spec.json`. A generator may add adjacent Slice-owned
support files such as `events.ts`, `projection.ts`, `registry.ts`, a Scenario
test, a database-schema re-export, or a migration checklist. Those files are
optional support artifacts; they never replace the required `spec.ts` and
`impl.ts` boundary.

Specifications may import only `@specter-ts/spec` and implementation-independent domain constants. They must not import Event Definitions, schemas, stores, plugins, database/server modules, implementations, or sibling Slices. Their exported value must contain only strict portable JSON data.

Start implementations with the matching kind-specific loader:

```ts
import { implementCommand } from '@specter-ts/core'
import specification from './spec.json' with { type: 'json' }

export const addTodo = implementCommand(specification)
```

Implementations follow these exact builder orders:

- Command: `.inputSchema(...) → .store(...) → .consistencyKeys(...)? → .apply(...)* → .handle(...)`
- Query: `.inputSchema(...) → .outputSchema(...) → .store(...) → .apply(...)* → .handle(...)`
- Reaction: `.outputSchema(...) → .plugin(...)? → .store(...) → .apply(...)* → (.handle(...) | .handleEachKey(...))`

`createEventDefinition(type, schema, { keys: { todo: (payload) => payload.todoId } })` declares the named keys an Event carries (the IDs it is about, each under the name of its kind; a function returns `undefined` for an Event without that key). Core stores them with the Event when it is appended. `.consistencyKeys({ todo: (command, state) => command.todoId })` makes a Command's append conflict only with new Events of its applied types that carry one of those values under that name; declare every key the decision reads, and Scenarios check it. Every applied Event type must declare one of its key names, and every such Event must carry one. Without it, any new Event of an applied type conflicts. `.handleEachKey('todo', (state, todoId) => effect)` makes a keyed Reaction: one handler run, and one delivery (`reaction:version:value`), per value of that key a commit carries; every applied Event type must declare the key, and it must decide each value from that value's State alone.

A Command handler rejects by throwing `new CommandRejection(code, message, details?)` from `@specter-ts/core`: a stable kebab-case `code` hosts match on (`error.rejection.code` of the `SpecterCommandRejectedError`), a message, and optional JSON `details`. Every code must appear in one of the Command's rejected Scenarios. Any other thrown error, or no Events, is a failure, not a rejection. `specter-spec export` writes `spec.d.json.ts` beside each `spec.json` (keep `allowArbitraryExtensions` on in `tsconfig.json`), so `SpecterRejectionCode<typeof config>` is the union of every code the app's Commands reject with; match on it rather than a hand-kept list.

A host that owns an Event's ID or time (its records named after the Event, its clock at the request) passes `eventContext: (draft, index) => ({ id, recordedAt, metadata })` to `app.command`; it runs after the decision and never reaches it. A test registers a test-only Slice with `extendSpecterConfig(config, { slices, events })` instead of casting the production config.

Calling `.inputSchema<Type>()` or `.outputSchema<Type>()` supplies static typing only. Passing a Standard Schema enables runtime validation and transformation. Use runtime schemas at every untrusted transport boundary.

## Scenarios And Events

- Every Slice has at least one Scenario with a unique human-readable `description`.
- Use `event('todo-added', { todoId: 'todo-1', title: 'Ship it' })`; never call an Event Definition from `spec.ts`.
- Event types use kebab-case; Slice names use lower camel case.
- Scenario payloads are exact. Include every ID-shaped field and domain timestamp.
- Accepted Command Scenarios expect one or more Scenario Events. Rejected Command Scenarios expect no Events and name the rejection: `reject: { code: 'title-required' }`, adding the exact `message` and `details` where they matter. Invalid schema input is not a Scenario.
- Across a Slice's Scenarios, the union of Given Event types exactly equals the implementation's apply Event types.
- Register apply handlers with `.apply(eventDefinition, async (event, state) => ...)`; `event.payload` is already decoded and typed, and `event.order`, `event.recordedAt` and `event.keys` are the Event's position, recorded time and stored keys.
- In a Scenario, Given Event N has order N and is recorded N seconds after the Unix epoch, so a Scenario that compares times writes them from positions (`3000` for the third Given Event).
- Every registered Event Definition and Slice appears in executable Scenario coverage.
- Command handlers emit only Event types authorized by accepted outcomes.
- Query and Reaction `expect` values are final public values after output-schema transformation. A keyed Reaction's `expect` lists one effect per value of its key the Given Events carry, in the order the values first appear.
- Specter freezes specification wrappers and arrays structurally; it does not clone or deep-freeze caller-owned payload values.

## Envelopes And Completion

Call in-process apps through envelopes:

```ts
const execution = await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})

const todos = await app.query({ type: 'todosQuery', payload: {} })

for await (const todos of app.subscribe({
  type: 'todosQuery',
  payload: {},
})) {
  // latest query state
}

await execution.reactions
```

- A Command resolves after its Events commit. `execution.reactions` separately reports aggregate Reaction completion or failure.
- Subscriptions emit current state, fan out per subscriber, coalesce intermediate states for slow consumers, and retain the newest value.
- A Reaction without an explicit Plugin must return a Command envelope; core dispatches it in the same app with `context.deliveryId` as the idempotency key. Explicit Plugins may define other effect values.
- Reaction Plugins receive a stable `context.deliveryId` and ISO `context.scheduledAt` across retries. Use them as downstream idempotency keys and retry-stable initiating timestamps. Retry-attempt identities belong to an optional outbox, not the core Reaction contract.
- A Plugin factory receives `{ command, query }`. Same-app dispatch uses `command(envelope, { idempotencyKey: context.deliveryId })` and resolves to `{ events, version, duplicate }`; it does not wait for nested Reactions. Multiple follow-up Commands from one effect append a deterministic suffix per Command.
- A repeated idempotency key returns the first commit with `duplicate: true` regardless of payload, so a retried effect that produces different output still keeps the first outcome; the receipt's `events` and `version` are that first commit's. Pass `idempotencyMode: 'exact'` only when a changed payload under the same key must fail with `SpecterIdempotencyConflictError`.
- `query(querySlice, input)` runs a registered Query in the same app with types from the Query Slice; pass the registered Slice value. Direct Plugins run inside the Reaction's Slice Store transaction and their Queries fail permanently with `SPECTER_PLUGIN_QUERY_IN_TRANSACTION` (the Reaction cursor stays blocked until the Plugin changes); wrap a Plugin that queries with `withReactionOutbox`. Never read the Event Log directly from a Plugin.
- In a direct Plugin, a `command` receipt is not final until the Reaction commits; do not trigger external side effects on `!receipt.duplicate` there.
- Annotate Plugins as `ReactionPlugin<Output, Services>` when the factory reads Effect services, so `createSpecterApp` fails to compile unless the dependency Layer provides them. Read services in the factory, not in the executor.
- Keep Plugins Effect-native. Compose the supplied capabilities directly; do not escape with `Effect.runPromise`, which loses active transaction context.

## Determinism And Transport

- Create domain IDs and domain timestamps at the initiating boundary and include them in Command payloads.
- Never generate domain IDs, domain timestamps, or randomness inside Slice handlers.
- Event schemas validate payloads and preserve every field and value one-to-one.
- Remote Command payloads and Query outputs use JSON-compatible values only. Encode Dates as ISO strings; reject `undefined`, `bigint`, `Map`, functions, and class instances at the transport boundary.
- Project transports allowlist registered Commands and Queries and map structured Specter errors without leaking internal failures.
- Keep request/database context alive for subscription activation, iteration, cancellation, and cleanup.

## State And Persistence

- Apply handlers receive write-capable Slice State. Command, Query, and Reaction handlers receive read-only Slice State capabilities. Adapters may expose the same runtime object for both.
- Event Log Command transactions cover catch-up, decision, and append and serialize conflicting decisions or enforce an expected version.
- Applying Events and advancing a Slice cursor is locally atomic or safely idempotent. Failed projections are repaired by replay.
- Event Log queries return unique Events strictly ascending by global order and strictly after the requested cursor. `query` and `commitsAfter` take a page (`{ limit }`) and catch-up reads one page at a time, so an adapter must honor the limit.
- A Store keeps a Slice's State under its version (`SliceStoreSlice.version`: the specification digest and the implementation's `stateVersion`) and never reads State of another version, so the Slice folds the log again. Raise `.store(Tag, { stateVersion })` when the State changes shape and the specification does not. A Reaction of a new version folds its State up to the highest cursor its name reached (`reached`) without delivering, and delivers only later commits.
- A host purges a deleted aggregate's Events with `eventLog.purge({ name, value }, { keep: [tombstoneTypes] })` and requires `{ purge: true }`. Make every Slice that keeps anything about the aggregate fold its tombstone and forget it but for what a rule needs (its ID was deleted), and make the aggregate's Commands refuse after the tombstone: such folds reach the same State from the purged log, and their cursors and snapshots stay valid.
- SQLite stores run on the host's connection (`createSqliteDatabaseContext` for libSQL, `createSqlClientDatabaseContext` for an Effect `SqlClient`, `createNodeSqliteDatabaseContext` for `node:sqlite`) and share its transactions; a host writes its own read models in the Event Log's `onAppend` hook, inside the append's transaction.
- Each SQL store's tables are versioned migrations (`sqliteEventLogMigrations` and the others, `postgres*Migrations`), numbered from 1 per store; a released one never changes. A host without migrations calls `prepareSpecterSqlite(context)` or `migrateSpecterSqlite(context, list)` (Postgres: `migrateSpecterPostgres(pool, list)`), which applies what the database lacks and records it in `specter_migrations`. A host with its own migrations runs the statements of the versions it brings in from one of its own, checks that it applies every version of the stores it uses, and adds a migration when a Specter release adds one. Table names are fixed: one Specter app per database.
- Do not let Query Slices drive Command decisions; Command Slices own their decision projections.
- Define app-specific tables in the owning `impl.ts` or an adjacent Slice-owned `projection.ts` imported only by that implementation, then re-export those tables from `src/db/schema.ts`.
- Do not centralize Slice State merely to remove nearby duplication. Fold code many Slices repeat may live once in a non-Slice module of the feature (`src/features/<feature>/<module>.ts`); each Slice still registers its own `.apply` calls and keeps its own State.

## Feature Workflow

1. Add or update kebab-case Event Definitions in the feature's `events.ts`.
2. Write or update exact Scenarios in `spec.ts`.
3. Export the specifications with `specter-spec export src/features`.
4. Load adjacent `spec.json` with the kind-specific implementation function in `impl.ts`, keeping State private and applying each Given Event type.
5. Register the implementation and Event Definitions.
6. Await `createSpecterApp(config)` in runtime wiring.
7. Test with an explicit or focused Event Definition catalog and an isolated Scenario runner.
8. Wire remote UI through the project-owned envelope transport, or call envelopes directly for a documented in-process app.
9. Run focused checks, then the complete project baseline.

Register Slices as an object whose keys exactly match specification names:

```ts
export const registrations = { addTodo, todosQuery } as const
```

Registry keys preserve literal Command and Query envelope types even though runtime JSON loading produces a `string` name. Startup conformance rejects any key/document mismatch.

The Event Log and each Reaction Slice cursor are durable truth. The scheduler is a rebuildable coordination adapter: it binds one executor per app, reconciles from durable truth, accepts commit boundaries, and lets callers await completion. The default in-memory scheduler is app-scoped. Stateless or distributed deployments provide a shared durable adapter.

When an Event payload changes, run `analyzeEventPropagation(...)` from
`@specter-ts/core/testing` and use `formatEventPropagation(...)` to enumerate
every Command producer, Scenario Given/outcome example, and apply consumer that
must change. Generate an executable persistent harness for restart, replay,
cursor-failure, and durable Reaction retry coverage when changing persistence.

## Boundaries

- Do not import sibling Slices. Share Events or registry-level references instead.
- Do not import server or database modules into remote client/UI code.
- Keep framework-specific transport code outside core.
- Do not import `@specter-ts/core/schema`; core has no application database schema export.

## Checks

- Run the package's lint/boundary checks after changing imports or wiring.
- Run typecheck after changing schemas, envelopes, adapters, or transport.
- Run Scenario and runtime tests after changing Slice behavior.
- Run browser tests after changing project transport or subscriptions.
- Construction diagnostics identify Slice, Scenario, Event position/type, and schema path; fix the source contract rather than bypassing conformance.
