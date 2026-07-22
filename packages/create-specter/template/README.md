# Specter Todo Starter

This is a Specter project generated from the todo Reference application.

## Commands

```sh
npm install
npm run dev
```

`npm run dev` applies the local SQLite migrations before starting Vite on port `41731`.

Useful checks:

```sh
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Browser or end-to-end tests can live under `tests/` or `e2e/`. Those paths are excluded from Vitest so Playwright tests do not get collected by `npm run test`. Install the pinned Chromium revision with `npm run test:e2e:install`; the preflight reports its exact expected path before Playwright starts.

The dev and preview servers use fixed port `41731` with `strictPort`; if the port is occupied, stop the conflicting process instead of switching ports.

## Agent Guidance

This starter includes a Specter Agent Skill at `.agents/skills/specter/SKILL.md` for coding agents working on Events, Slices, scenarios, client calls, and app wiring.

## Slice Scenarios

Create each Slice specification in `spec.ts` with a stable API name, a human-readable description, and nonempty scenarios:

```ts
import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios({
    description: 'Creates a todo with the provided title.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })
```

Every scenario object also needs a `description`. Scenario tests use Slice descriptions for suite names and scenario descriptions for test names.

Keep `spec.ts` free of runtime schemas, Event Definitions, stores, and plugins.
It must default-export exactly one specification. Project scripts run
`specter-spec export` before development, typecheck, tests, and builds, writing
ignored adjacent `spec.json`. Add implementation dependencies in `impl.ts`,
load that JSON with `implementCommand`, `implementQuery`, or
`implementReaction`, then supply `inputSchema`/`outputSchema`, a store, repeated
`apply(EventDefinition, handler)` calls, and `handle`. Apply handlers receive
decoded payloads at `event.payload`.

Every Slice requires `spec.ts` and `impl.ts`. A named `<sliceName>Spec` alias is
optional, while the default specification export and named `<sliceName>`
implementation export are the conventional generated shape. Slice-owned Event
catalogs, projection modules, registries, tests, schema re-exports, and
migration notes are optional support files generated when useful; they do not
replace the `spec.ts` → `spec.json` → `impl.ts` boundary.

Scenario Event payloads are compared exactly. Use kebab-case Event types and supply generated domain IDs or timestamps through command inputs or prior Events.

## Structure

```txt
src/features/todos/   Todo vertical feature with portable Slice directories
src/todo-app.tsx      Solid UI that calls the project-owned envelope transport
src/transport/        Typed JSON HTTP/SSE browser and server boundary
src/db/schema.ts      App-owned Drizzle schema exports for migrations
src/db/specter-sqlite.ts App-owned Drizzle Slice Store/context bridge
src/db/scenario-tests.ts In-memory SQLite scenario test helper
drizzle/              SQLite migrations
```

The framework/runtime API is imported from `@specter-ts/core`; it is not copied into this project. The authoritative Event Log comes from `@specter-ts/sqlite`; app-owned Drizzle projection tables and their context bridge remain under `src/db`.
