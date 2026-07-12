---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Specter features, Events, Slices, scenarios, clients, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript app built from Vertical Features under `src/features`.
- Events are domain facts emitted by accepted commands or reactions.
- A Slice is one command, query, or reaction unit with private event-derived Slice State and a human-readable description.
- UI code calls the typed Specter client; Specter does not own UI/frontend.
- Scenarios are executable examples for Slices, and each scenario has a human-readable description used as its test name.
- SQLite is app infrastructure. Specter core owns runtime contracts, not persistence tables or database setup.
- Specter runtime seams are async-only: Slice handlers, apply handlers, Reaction Plugins, and local adapters return Promises even when work is immediately available.
- Each Slice directory contains `spec.ts` and `impl.ts`; `slice.ts` is retired.

## Canonical Imports

- Use `@specter-ts/core/spec` for specification builders and `event(...)`.
- Use `@specter-ts/core` for Event Definitions, implementations, app creation, and command rejection.
- Use `@specter-ts/core/client` for client contract helpers.
- Use `@specter-ts/core/testing` for scenario helpers.
- Use local `src/db/*` modules for SQLite adapters, scenario database setup, and Drizzle schema exports.

## Feature Workflow

1. Start from the domain fact: add or update Event Definitions in the feature's `events.ts`.
2. Define each Slice in `spec.ts` with only `create*Slice(name)`, `description(...)`, and one or more scenarios. Specs may import only their builder and `event` from `@specter-ts/core/spec`.
3. Write Given and expected Events as `event('kebab-case-type', exactPayload)`. The union of Given Event types must exactly match the implementation's `apply` Event Definitions.
4. Implement the spec in `impl.ts`: import the spec, add input/output schemas (and a Reaction Plugin when applicable), store, repeated `apply(EventDefinition, async (event, state) => ...)` calls, then `handle(...)`. `event.payload` is already decoded.
5. Register new Event Definitions and Slices in the feature registry, then wire that config into the Specter App.
6. Wire UI through the typed Specter client rather than importing server/database modules.
7. Prefer Events and Slices before database changes. Define app-specific Drizzle tables in the `impl.ts` file that owns that Slice State, then re-export those tables from `src/db/schema.ts` for migrations.
8. Do not centralize Slice State table definitions in a shared schema/helper file. If two Slices need similar state, duplicate the table definition with slice-specific table names so each Slice keeps private state.
9. Add shared Specter persistence tables only in local app infrastructure, such as `src/db/specter-schema.ts`.
10. Event types are kebab-case. Scenario payloads are exact: IDs and timestamps must come from command inputs or prior Events, never from randomness or the clock inside a handler.
11. Await `createSpecterApp(...)`. Test implementations with `testSliceImplementations(registrations, { events, runScenario })` and an Event catalog covering exactly those registrations' scenarios.

## Boundaries

- Do not import sibling Slices from another Slice in the same feature. Share Events or registry-level refs instead.
- Do not import Event Definitions, schemas, stores, plugins, or implementation types into `spec.ts`.
- Do not import server or database modules into client/UI code.
- Do not let Query Slices drive Command Slice decisions; Command Slices own their own decision state.
- Do not import `@specter-ts/core/schema`; core has no SQLite schema export.

## Checks

- Run `npm run lint` after changing feature boundaries or imports.
- Run `npm run typecheck` after changing Specter types, clients, or app wiring.
- Run `npm test` after changing Slice behavior or scenarios.
