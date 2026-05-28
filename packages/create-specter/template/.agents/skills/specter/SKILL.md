---
name: specter
description: Teaches coding agents how to add and change Specter features in generated Specter Projects. Use when adding or changing Specter features, Events, Slices, Views, scenarios, generated refs, or app wiring.
---

# Specter

## Mental Model

- A Specter Project is a TypeScript/Solid app built from Vertical Features under `src/features`.
- Events are domain facts emitted by accepted commands or reactions.
- A Slice is one command, query, or reaction unit with private event-derived Slice State.
- Views compose generated command/query refs from `virtual:specter/refs`.
- Scenarios are executable examples for Slices only; do not add View scenarios.
- Use `src/features/todos` as the worked example for file placement and naming.

## Canonical Imports

- Use `@specter-ts/core` for Events, Slices, app creation, and command rejection.
- Use `@specter-ts/core/view` for `createView`.
- Use `@specter-ts/core/client` for the client provider and RPC client creation.
- Use `@specter-ts/core/schema` for Specter persistence schema exports.
- Use `@specter-ts/core/vite` for `specterRefsPlugin`.

## Feature Workflow

1. Start from the domain fact: add or update Event Definitions in the feature's `events.ts`.
2. Add or update Slices near the feature: Command Slices decide and emit Event Drafts, Query Slices serve reads, and Reaction Slices produce follow-up effects.
3. Add Slice scenarios for changed behavior. For Command Slices, expecting no events means the command is rejected.
4. Register new Event Definitions and Slices in the feature registry, then wire that config into the Specter App.
5. Use generated refs in Views via `virtual:specter/refs`; never edit `src/specter-refs.generated.d.ts` manually.
6. Prefer Events and Slices before database changes. Add app-specific database schema only when the user explicitly asks for durable data outside the Specter event/slice model.

## Boundaries

- Do not import sibling Slices from another Slice in the same feature. Share Events or registry-level refs instead.
- Do not import server or database modules into client/view code.
- Do not let Query Slices drive Command Slice decisions; Command Slices own their own decision state.
- Do not emit error Events for rejected commands; use `rejectCommand`.

## Checks

- Run `npm run lint` after changing feature boundaries or imports.
- Run `npm run typecheck` after changing Specter types, refs, or app wiring.
- Run `npm test` after changing Slice behavior or scenarios.
- Run `npm run build` when touching server, client, Vite, or View integration.
