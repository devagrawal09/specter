---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Events, Slices, scenarios, envelope calls, transports, adapters, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript app composed from Vertical Features under `src/features`.
- Events are exact durable domain facts emitted by accepted Commands. Event Log IDs, global order, and recorded timestamps are metadata outside Event payloads.
- A Slice Specification is the immutable structural "what": name, description, and executable Scenarios.
- A Slice Implementation is the "how": schemas, Reaction Plugin, private Store, typed apply handlers, and handler.
- One specification may have divergent implementations. A Specter App registers exactly one completed implementation per lower-camel-case Slice name.
- The Event Log is the durable source of truth. Slice State is a disposable event-derived projection.
- Runtime seams and `createSpecterApp` are async.
- Core is transport-agnostic. Remote UIs call a project-owned typed envelope transport; in-process apps may call the Specter App directly.

## Canonical Imports

- Use `@specter-ts/core/spec` in `spec.ts` for Slice specification builders and `event(type, payload)`.
- Use `@specter-ts/core` in implementations and runtime wiring for Event Definitions, app creation, envelope/reference types, adapters, and structured errors.
- Use `@specter-ts/core/testing` for Scenario tests, focused Event catalogs, and replay helpers.
- Use local `src/db/*` and `src/transport/*` modules for stores, persistence, Scenario database setup, HTTP/SSE transport, and schema exports.
- Do not import `@specter-ts/core/client`; that subpath does not exist in Specter 0.3.

## Slice Files

Every Slice contract requires these two files:

- `spec.ts` exports `<sliceName>Spec` and defines only `name → description → scenarios`.
- `impl.ts` imports that specification and exports `<sliceName>` after completing the implementation stages.

Use named exports for both files. A generator may add adjacent Slice-owned
support files such as `events.ts`, `projection.ts`, `registry.ts`, a Scenario
test, a database-schema re-export, or a migration checklist. Those files are
optional support artifacts; they never replace the required `spec.ts` and
`impl.ts` boundary.

Specifications may import only `@specter-ts/core/spec` and implementation-independent domain constants. They must not import Event Definitions, schemas, stores, plugins, database/server modules, implementations, or sibling Slices.

Implementations follow these exact builder orders:

- Command: `.inputSchema(...) → .store(...) → .apply(...)* → .handle(...)`
- Query: `.inputSchema(...) → .outputSchema(...) → .store(...) → .apply(...)* → .handle(...)`
- Reaction: `.outputSchema(...) → .plugin(...) → .store(...) → .apply(...)* → .handle(...)`

Calling `.inputSchema<Type>()` or `.outputSchema<Type>()` supplies static typing only. Passing a Standard Schema enables runtime validation and transformation. Use runtime schemas at every untrusted transport boundary.

## Scenarios And Events

- Every Slice has at least one Scenario with a unique human-readable `description`.
- Use `event('todo-added', { todoId: 'todo-1', title: 'Ship it' })`; never call an Event Definition from `spec.ts`.
- Event types use kebab-case; Slice names use lower camel case.
- Scenario payloads are exact. Include every ID-shaped field and domain timestamp.
- Accepted Command Scenarios expect one or more Scenario Events. Rejected Command Scenarios expect no Events and may state an exact rejection reason. Invalid schema input is not a Scenario.
- Across a Slice's Scenarios, the union of Given Event types exactly equals the implementation's apply Event types.
- Register apply handlers with `.apply(eventDefinition, async (event, state) => ...)`; `event.payload` is already decoded and typed.
- Every registered Event Definition and Slice appears in executable Scenario coverage.
- Command handlers emit only Event types authorized by accepted outcomes.
- Query and Reaction `expect` values are final public values after output-schema transformation.
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
- Reaction effects are arbitrary plugin-defined values. Dispatching another Command is one explicit plugin pattern.
- Reaction Plugins receive a stable `context.deliveryId` and ISO `context.scheduledAt` across retries. Use them as downstream idempotency keys and retry-stable initiating timestamps; `context.attemptId` changes for each attempt.
- Same-app dispatch uses `dispatch(envelope, { idempotencyKey: context.deliveryId })`. Multiple follow-up Commands from one effect append a deterministic suffix per Command.

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
- Event Log queries return unique Events strictly ascending by global order and strictly after the requested cursor.
- Do not let Query Slices drive Command decisions; Command Slices own their decision projections.
- Define app-specific tables in the owning `impl.ts` or an adjacent Slice-owned `projection.ts` imported only by that implementation, then re-export those tables from `src/db/schema.ts`.
- Do not centralize Slice State merely to remove nearby duplication.

## Feature Workflow

1. Add or update kebab-case Event Definitions in the feature's `events.ts`.
2. Write or update exact Scenarios in `spec.ts`.
3. Complete the specification in `impl.ts`, keeping State private and applying each Given Event type.
4. Register the implementation and Event Definitions.
5. Await `createSpecterApp(config)` in runtime wiring.
6. Test with an explicit or focused Event Definition catalog and an isolated Scenario runner.
7. Wire remote UI through the project-owned envelope transport, or call envelopes directly for a documented in-process app.
8. Run focused checks, then the complete project baseline.

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
