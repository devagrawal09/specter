# Worklog Agent Guidance

## Data isolation

- Treat `data/worklog.db` as the user's live database. Never use it for tests,
  browser QA, demos, screenshots, CLI verification, or seeded examples.
- Start verification servers with `pnpm --filter @specter/worklog dev:verify`.
  This creates a temporary SQLite database outside the app directory and removes
  it when the server exits.
- For offline CLI verification, always pass `--db` with an explicit temporary
  database path. For subscription integration checks, stop the live server,
  start `dev:verify`, and let the CLI use that temporary HTTP server.
- Playwright must start its own verification server. Do not configure it to
  reuse a running server, because that server may be the user's live instance.
- Do not inspect, copy, reset, or mutate the live database unless the user
  explicitly asks for that database operation.
