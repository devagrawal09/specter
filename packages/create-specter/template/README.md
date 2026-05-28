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

## Structure

```txt
src/features/todos/   Todo vertical feature with events, slices, and scenarios
src/views/            Solid views bound to Specter command/query refs
src/db/schema.ts      Drizzle schema exports for migrations
drizzle/              SQLite migrations
```

The framework/runtime API is imported from `@specter/core`; it is not copied into this project.
