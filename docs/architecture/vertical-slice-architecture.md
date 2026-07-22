# Vertical Slice Architecture

Vertical Slice Architecture organizes code around use cases rather than
technical layers. In Specter, each Command, Query, or Reaction is a Slice with
an executable behavioral contract and one selected implementation.

## Mechanics

Every Slice has two required files:

```text
src/features/todos/add-todo/
├── spec.ts   # immutable Slice Specification: what
└── impl.ts   # schemas, state, apply handlers, and handler: how
```

`spec.ts` default-exports `<sliceName>Spec`. It defines only the Slice name,
description, and Scenarios, and imports builders and `event(...)` from
`@specter-ts/spec`.

`specter-spec export` writes the portable contract to adjacent `spec.json`.
`impl.ts` imports only that JSON, starts the matching kind-specific implementation
builder, and exports the named `<sliceName>` Slice Implementation. It completes the staged builder with runtime schemas, a private
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
Command:  inputSchema -> store -> apply* -> handle
Query:    inputSchema -> outputSchema -> store -> apply* -> handle
Reaction: outputSchema -> plugin -> store -> apply* -> handle
```

Calling `inputSchema<Type>()` or `outputSchema<Type>()` provides static typing
only. Passing a Standard Schema also performs runtime validation and
transformation. Use runtime schemas at untrusted transport boundaries.

## Invariants and pitfalls

- Use lower camel case for Slice names and kebab-case for Event types.
- Give every Slice at least one uniquely described Scenario.
- Across a Slice's Scenarios, the union of `given` Event types must exactly
  match its registered `.apply(...)` Event types.
- A Command emits only Events authorized by accepted Scenario outcomes.
- Create domain IDs and timestamps at the initiating boundary, not inside Slice
  handlers.
- Avoid extracting a shared schema or state abstraction merely because nearby
  Slices look similar; preserve explicit ownership until a real boundary exists.
- Do not let a Query projection drive a Command decision. A Command that needs
  history owns its own decision projection.

## Related documentation

- [File structure](file-structure.md)
- [CQRS](cqrs.md)
- [Event sourcing](event-sourcing.md)
- [Writing specifications](../specifications/writing-specifications.md)
- [`@specter-ts/spec` API](../api-reference/spec.md)
