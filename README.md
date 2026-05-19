# Specter

Specter is a small Hono + Vite + Solid todo app backed by local SQLite.

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
