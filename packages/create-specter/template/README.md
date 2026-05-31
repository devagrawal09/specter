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

## Agent Guidance

This starter includes a Specter Agent Skill at `.agents/skills/specter/SKILL.md` for coding agents working on Events, Slices, scenarios, client calls, and app wiring.

## Slice Scenarios

Create each Slice with a stable API name and a human-readable description:

```ts
createCommandSlice('addTodo', 'Adds a todo to the list.')
```

Every scenario object also needs a `description`. Scenario tests use Slice descriptions for suite names and scenario descriptions for test names.

## Structure

```txt
src/features/todos/   Todo vertical feature with events, slices, and scenarios
src/todo-app.tsx      Solid UI that calls the typed Specter client
src/db/schema.ts      App-owned Drizzle schema exports for migrations
src/db/specter-sqlite.ts SQLite Slice Store and Event Log adapters
src/db/scenario-tests.ts In-memory SQLite scenario test helper
drizzle/              SQLite migrations
```

The framework/runtime API is imported from `@specter-ts/core`; it is not copied into this project.
Specter core does not ship SQLite schema exports. Persistence schema and database setup are app infrastructure under `src/db`.
