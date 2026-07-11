---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Specter features, Events, Slices, scenarios, clients, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript app composed from Vertical Features under `src/features`.
- Events are exact durable domain facts emitted by accepted Commands. Event Log IDs, order, and recorded timestamps are metadata outside Event payloads.
- A Slice Specification is the immutable "what": name, description, and executable Scenarios.
- A Slice Implementation is the "how": schemas, Reaction Plugin, private Store, typed apply handlers, and handler.
- One specification may have multiple divergent implementations. A Specter App registers exactly one completed implementation per Slice name.
- UI code calls the typed Specter Client; Specter does not own UI/frontend.
- Runtime seams are async-only. `createSpecterApp` is also async because construction validates conformance.

## Canonical Imports

- Use `@specter-ts/core/spec` in `spec.ts` for Slice specification builders and `event(type, payload)`.
- Use `@specter-ts/core` in implementations for Event Definitions and runtime types.
- Use `@specter-ts/core/client` for client contract helpers.
- Use `@specter-ts/core/testing` for `testSliceImplementation` and `testSliceImplementations`.
- Use local `src/db/*` modules for stores, scenario database setup, and Drizzle schema exports.

## Slice Files

Every Slice directory contains two files:

- `spec.ts` exports `<sliceName>Spec` and defines only `name → description → scenarios`.
- `impl.ts` imports that specification and exports `<sliceName>` after completing the implementation stages.

Specifications may import only `@specter-ts/core/spec` and implementation-independent domain constants. They must not import Event Definitions, schemas, stores, plugins, database/server modules, implementations, or sibling Slices.

Implementations follow these exact builder orders:

- Command: `.inputSchema(...) → .store(...) → .apply(...)* → .handle(...)`
- Query: `.inputSchema(...) → .outputSchema(...) → .store(...) → .apply(...)* → .handle(...)`
- Reaction: `.outputSchema(...) → .plugin(...) → .store(...) → .apply(...)* → .handle(...)`

Call `.inputSchema<Type>()` or `.outputSchema<Type>()` with no runtime value for static typing without runtime validation. Passing a Standard Schema enables runtime validation and transformation.

## Scenarios And Events

- Every Slice has at least one Scenario with a unique human-readable `description`.
- Use `event('todo-added', { todoId: 'todo-1', title: 'Ship it' })`; never call an Event Definition from `spec.ts`.
- Event types use kebab-case.
- Scenario payloads are exact. Do not use generated/reference placeholders and do not omit ID-shaped fields.
- Command Scenarios are accepted when `expect` contains one or more Scenario Events and rejected when `expect` is empty. Do not add invalid-input Scenarios.
- Across all Scenarios for one Slice, the union of `given` Event types must exactly equal the implementation's apply Event types. Given Events exist only to construct that Slice's private state.
- Register each apply handler with `.apply(eventDefinition, async (event, state) => ...)`. `event.payload` is already decoded and typed.
- Every app Event Definition and every Slice must appear in at least one Scenario.
- Command handlers may emit only Event types present in accepted outcomes for that specification.

## Determinism

- Do not generate domain IDs, domain timestamps, or random values inside Slice handlers.
- Put those values in Command input or derive them from prior Events.
- Event schemas validate payloads but must preserve every payload field and value one-to-one.

## Feature Workflow

1. Add or update kebab-case Event Definitions in the feature's `events.ts`.
2. Write or update the Slice's `spec.ts` using exact Scenario Events.
3. Complete the specification in `impl.ts`, keeping Slice State private and registering one typed apply handler per Given Event type.
4. Register the selected implementation and Event Definitions in the feature registry.
5. Await `createSpecterApp(config)` in runtime wiring.
6. Test implementations with an explicit Event Definition catalog and scenario runner.
7. Wire UI through the typed Specter Client rather than importing server/database modules.

## Boundaries

- Do not import sibling Slices. Share Events or registry-level references instead.
- Do not import server or database modules into client/UI code.
- Do not let Query Slices drive Command decisions; Command Slices own their decision state.
- Define app-specific tables in the `impl.ts` that owns the Slice State, then re-export those tables from `src/db/schema.ts`.
- Do not centralize Slice State tables or schemas merely to remove nearby duplication.
- Do not import `@specter-ts/core/schema`; core has no SQLite schema export.

## Checks

- Run `npm run lint` after changing feature boundaries or imports.
- Run `npm run typecheck` after changing Specter types, clients, or app wiring.
- Run `npm test` after changing Slice behavior or Scenarios.
- Construction diagnostics should identify the Slice, Scenario, Event position/type, and schema issue path; fix the schema or source-of-truth Scenario rather than bypassing conformance.
