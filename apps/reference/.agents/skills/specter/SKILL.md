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
- Use `src/features/todos` as the worked example for file placement and naming.

## Canonical Imports

- Use `@specter-ts/core/spec` for dependency-free Slice specifications and scenario Events.
- Use `@specter-ts/core` for Event Definitions, Slice implementations, app creation, and command rejection.
- Use `@specter-ts/core/client` for client contract helpers.
- Use `@specter-ts/core/testing` for scenario helpers.
- Use local `src/db/*` modules for SQLite adapters, scenario database setup, and Drizzle schema exports.

## Feature Workflow

1. Start from the domain fact: add or update kebab-case Event Definitions in the feature's `events.ts`.
2. Give every Slice its own directory containing only `spec.ts` and `impl.ts`; do not add `slice.ts`.
3. In `spec.ts`, import only `createCommandSlice`, `createQuerySlice`, `createReactionSlice`, and `event` from `@specter-ts/core/spec`. Build the specification through name, description, and nonempty scenarios. Do not import schemas, Event Definitions, stores, or plugins.
4. Use `event('kebab-case-type', exactPayload)` for Given and expected scenario Events. Payload comparisons are exact, so put generated domain IDs and timestamps in command inputs or prior Events.
5. In `impl.ts`, import the specification and add `inputSchema`/`outputSchema`, the Reaction Plugin when applicable, the store, repeated `apply(EventDefinition, async (event, state) => ...)` calls, and `handle`. Apply receives the decoded payload at `event.payload`; do not decode it again.
6. Ensure the set of Given Event types in a Slice's scenarios exactly equals its set of apply Event Definitions.
7. Register Event Definitions and Slice implementations in the feature registry, then wire that config into the Specter App. `createSpecterApp` is async and must be awaited.
8. Wire UI through the typed Specter client rather than importing server/database modules.
9. Define app-specific Drizzle tables in the `impl.ts` that owns the Slice State, then re-export those tables from `src/db/schema.ts` for migrations.
10. Do not centralize Slice State table definitions in a shared schema/helper file. If two Slices need similar state, duplicate the table definition with slice-specific table names so each Slice keeps private state.
11. Add shared Specter persistence tables only in local app infrastructure, such as `src/db/specter-schema.ts`.

## Boundaries

- Do not import sibling Slices from another Slice in the same feature. Share Events or registry-level refs instead.
- Do not import server or database modules into client/UI code.
- Do not let Query Slices drive Command Slice decisions; Command Slices own their own decision state.
- Do not import `@specter-ts/core/schema`; core has no SQLite schema export.

## Checks

- Run `npm run lint` after changing feature boundaries or imports.
- Run `npm run typecheck` after changing Specter types, clients, or app wiring.
- Run `npm test` after changing Slice behavior or scenarios. Use `testSliceImplementations(registrations, { events, runScenario })`.
