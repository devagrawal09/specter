# Specter

Specter is a TypeScript and Solid framework for vertically sliced event-sourced applications. The todo app in `src/features/todos` is a reference application for proving the framework API.

## Development

```bash
npm install
npm run dev
```

The dev server uses the fixed port `41731`.

## Production Build

```bash
npm run build
npm start
```

## Checks

```bash
npm test
npm run lint
npm run check
```

## Database

```bash
npm run db:generate
npm run db:migrate
```

The SQLite database is stored at `./data/app.db`.

## Current API Direction

The lib API uses Specter language: `createSpecterApp`, `createCommandSlice`, `createProjectionSlice`, `createReactionSlice`, `createView`, Event Definitions, and Event Drafts. Event Definitions are registered with the Specter App; the Event Log assigns IDs, order, and recorded timestamps when accepted commands append drafts.
