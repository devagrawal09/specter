# Vertical Slice Architecture

Vertical Slice Architecture organizes code around use cases rather than
technical layers. In Specter, each Command, Query, or Reaction is a Slice with
an executable behavioral contract and one selected implementation.

## Mechanics

Every Slice has two required source files:

```text
src/features/todos/add-todo/
├── spec.ts     # immutable TypeScript authoring source: what
├── spec.json   # generated portable contract
└── impl.ts     # schemas, state, apply handlers, and handler: how
```

`spec.ts` default-exports `<sliceName>Spec`. It defines only the Slice name,
description, and Scenarios, and imports builders and `event(...)` from
`@specter-ts/spec`.

`specter-spec export` writes the portable contract to adjacent `spec.json`.
`impl.ts` imports only that JSON, starts the matching kind-specific
implementation builder, and exports the named `<sliceName>` Slice
Implementation. It completes the staged builder with runtime schemas, a private
Slice Store, zero or more typed Event apply handlers, and the final handler. A
Reaction also supplies a Reaction Plugin.

A Slice directory may own supporting files:

- `events.ts` for Event Definitions used by the implementation;
- `projection.ts` for private Slice State tables or structures;
- `registry.ts` for explicit local registration;
- `scenarios.test.ts` for focused executable specification tests;
- `db-schema.ts` and `MIGRATION.md` for persistence integration.

Those files are organizational choices, not additional framework requirements.
They never replace `spec.ts` and `impl.ts`.

## The Todo feature

The Todo Reference application keeps related use cases under
`src/features/todos` while each use case retains its own boundary:

- `add-todo` is a Command Slice. It accepts input and emits `todo-added`.
- `todos-query` is a Query Slice. It applies Todo Events into its private list
  projection and returns filtered Todos.
- `todo-completion-cheer-reaction` is a Reaction Slice. It applies Todo Events,
  detects completion milestones, and asks its Reaction Plugin to dispatch a
  follow-up Command.

These Slices share facts through Event Definitions in the feature catalog. They
do not call one another or query one another's Slice State.

### Shared fold code, not shared State

Many Slices of one feature often fold the same facts the same way: every
Command about a Session first needs to know whether the Session exists and
whether it was deleted. Each Slice still owns its State, but the fold code
may live once, in a module of the feature that is not a Slice:

```ts
// src/features/session/lifecycle.ts
export type SessionLifecycle = { sessions: Record<string, 'live' | 'deleted'> }

export const sessionLifecycle = {
  created: async (event: EventForDefinition<typeof sessionCreated>, state: SessionLifecycle) => {
    state.sessions[event.payload.sessionId] = 'live'
  },
  deleted: async (event: EventForDefinition<typeof sessionDeleted>, state: SessionLifecycle) => {
    state.sessions[event.payload.sessionId] = 'deleted'
  },
}
```

```ts
// src/features/session/rename-session/impl.ts
export const renameSession = implementCommand(specification)
  .inputSchema(renameSessionSchema)
  .store(RenameSessionStore)
  .apply(sessionCreated, sessionLifecycle.created)
  .apply(sessionDeleted, sessionLifecycle.deleted)
  .apply(sessionRenamed, applySessionRenamed)
  .handle(handleRenameSession)
```

The Slice still registers every Event type it folds, so its Scenarios,
conformance and compare-and-swap see exactly what it reads, and its State
type extends the shared part (`RenameSessionState = SessionLifecycle & {
titles: ... }`). A module directly under the feature directory is not a
Slice, so the boundary check lets Slices import it; what it must not become
is a shared State or a sibling Slice's projection.

## Ownership and dependencies

The important boundary is ownership, not directory depth:

- A specification cannot import Event Definitions, implementations, schemas,
  stores, plugins, database modules, server modules, or sibling Slices.
- A Slice Implementation owns its decision or read projection. Other Slices
  consume Events rather than its tables or state.
- Feature-level `events.ts` and `registry.ts` may collect explicit exports, but
  they do not become service locators.
- The app registry selects exactly one completed implementation for each
  lower-camel-case Slice name.
- Remote UI code depends on project transport envelopes, not server, database,
  or core internals.

Keeping state private is what allows replay, replacement, and divergent
implementations without turning projections into shared mutable models.

## Builder shapes

The Slice kind determines the completion stages:

```text
Command:  inputSchema -> store -> consistencyKeys? -> apply* -> handle
Query:    inputSchema -> outputSchema -> store -> apply* -> handle
Same-app Command Reaction: outputSchema -> store -> apply* -> handle | handleEachKey
Custom Reaction: outputSchema -> plugin -> store -> apply* -> handle | handleEachKey
```

`consistencyKeys({ name: (command, state) => value })` names the
[Event keys](event-sourcing.md#event-keys) a Command's decision reads, so its
append conflicts only with Events carrying them. `handleEachKey(name, handler)`
completes a [keyed Reaction](runtime.md#keyed-reactions), which decides once
per value of that key a commit's Events carry. A Command rejects by throwing a
`CommandRejection` whose `code` one of its rejected Scenarios names.

Calling `inputSchema<Type>()` or `outputSchema<Type>()` provides static typing
only. Passing a Standard Schema also performs runtime validation and
transformation. Use runtime schemas at untrusted transport boundaries.

## Invariants and pitfalls

- Use lower camel case for Slice names and kebab-case for Event types.
- Give every Slice at least one uniquely described Scenario.
- Across a Slice's Scenarios, the union of `given` Event types must exactly
  match its registered `.apply(...)` Event types: every fold handler is
  exercised by a Scenario, and every Given Event reaches the Slice (see
  [Conformance](../specifications/conformance.md#apply-registrations)).
- A Command emits only Events authorized by accepted Scenario outcomes.
- Create domain IDs and timestamps at the initiating boundary, not inside Slice
  handlers.
- Avoid extracting a shared schema or state abstraction merely because nearby
  Slices look similar; preserve explicit ownership until a real boundary exists.
  Fold code many Slices repeat may live once in a non-Slice module, while each
  Slice keeps its own State and its own `.apply` registrations.
- Do not let a Query projection drive a Command decision. A Command that needs
  history owns its own decision projection.

## Related documentation

- [File structure](file-structure.md)
- [CQRS](cqrs.md)
- [Event sourcing](event-sourcing.md)
- [Writing specifications](../specifications/writing-specifications.md)
- [`@specter-ts/spec` API](../api-reference/spec.md)
