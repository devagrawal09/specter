---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Specter features, Events, Slices, scenarios, clients, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript/Solid app built from Vertical Features under `src/features`.
- Events are domain facts emitted by accepted commands or reactions.
- A Slice is one command, query, or reaction unit with private event-derived Slice State.
- UI code calls the typed Specter client; Specter core does not own Views.
- Scenarios are executable examples for Slices.
- SQLite is app infrastructure. Specter core owns runtime contracts, not persistence tables or database setup.
- Use `src/features/todos` as the worked example for file placement and naming.

## Canonical Imports

- Use `@specter-ts/core` for Events, Slices, app creation, and command rejection.
- Use `@specter-ts/core/client` for client contract helpers.
- Use `@specter-ts/core/testing` for scenario helpers.
- Use local `src/db/*` modules for SQLite adapters, scenario database setup, and Drizzle schema exports.

## Feature Workflow

1. Start from the domain fact: add or update Event Definitions in the feature's `events.ts`.
2. Add or update Slices near the feature: Command Slices decide and emit Event Drafts, Query Slices serve reads, and Reaction Slices produce follow-up effects.
3. Add Slice scenarios for changed behavior. For Command Slices, expecting no events means the command is rejected.
4. Register new Event Definitions and Slices in the feature registry, then wire that config into the Specter App.
5. Wire UI through the typed Specter client rather than importing server/database modules.
6. Prefer Events and Slices before database changes. Define app-specific Drizzle tables in the Slice file that owns that Slice State, then re-export those tables from `src/db/schema.ts` for migrations.
7. Do not centralize Slice State table definitions in a shared schema/helper file. If two Slices need similar state, duplicate the table definition with slice-specific table names so each Slice keeps private state.
8. Add shared Specter persistence tables only in local app infrastructure, such as `src/db/specter-schema.ts`.

## Boundaries

- Do not import sibling Slices from another Slice in the same feature. Share Events or registry-level refs instead.
- Do not import server or database modules into client/UI code.
- Do not let Query Slices drive Command Slice decisions; Command Slices own their own decision state.
- Do not emit error Events for rejected commands; throw an `Error`.
- Do not import `@specter-ts/core/schema`; core has no SQLite schema export.
- Do not use `process.env` mutation for scenario database injection. Use the app's scoped SQLite scenario helper.

## Checks

- Run `npm run lint` after changing feature boundaries or imports.
- Run `npm run typecheck` after changing Specter types, clients, or app wiring.
- Run `npm test` after changing Slice behavior or scenarios.
- Run `npm run build` when touching server, client, or Vite integration.
