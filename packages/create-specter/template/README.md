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
```

Browser or end-to-end tests can live under `tests/` or `e2e/`. Those paths are excluded from Vitest so Playwright tests do not get collected by `npm run test`.

The dev and preview servers use fixed port `41731` with `strictPort`; if the port is occupied, stop the conflicting process instead of switching ports.

## Agent Guidance

This starter includes a Specter Agent Skill at `.agents/skills/specter/SKILL.md` for coding agents working on Events, Slices, scenarios, client calls, and app wiring.

## Slice Scenarios

Create each Slice specification in `spec.ts` with a stable API name, a human-readable description, and nonempty scenarios:

```ts
import { createCommandSlice, event } from '@specter-ts/core/spec'

createCommandSlice('addTodo')
  .description('Adds a todo to the list.')
  .scenarios({
    description: 'Creates a todo with the provided title.',
    given: [],
    when: { todoId: 'todo-1', title: 'Ship it' },
    expect: [event('todo-added', { todoId: 'todo-1', title: 'Ship it' })],
  })
```

Every scenario object also needs a `description`. Scenario tests use Slice descriptions for suite names and scenario descriptions for test names.

Keep `spec.ts` free of runtime schemas, Event Definitions, stores, and plugins. Add those dependencies in the adjacent `impl.ts`, using `inputSchema`/`outputSchema`, a store, repeated `apply(EventDefinition, handler)` calls, and `handle`. Apply handlers receive decoded payloads at `event.payload`.

Scenario Event payloads are compared exactly. Use kebab-case Event types and supply generated domain IDs or timestamps through command inputs or prior Events.

## Structure

```txt
src/features/todos/   Todo vertical feature with two-file Slice directories
src/todo-app.tsx      Solid UI that calls the typed Specter client
src/db/schema.ts      App-owned Drizzle schema exports for migrations
src/db/specter-sqlite.ts SQLite Slice Store and Event Log adapters
src/db/scenario-tests.ts In-memory SQLite scenario test helper
drizzle/              SQLite migrations
```

The framework/runtime API is imported from `@specter-ts/core`; it is not copied into this project.
Specter core does not ship SQLite schema exports. Persistence schema and database setup are app infrastructure under `src/db`.
