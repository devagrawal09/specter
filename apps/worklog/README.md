# Worklog

Worklog is a single-user local application for capturing a journal timeline,
tracking one-off tasks, organizing topics, connecting related records, and
earning an auditable lifetime score.

## Core release

- Timeline-first Solid web UI with one composer for journals, tasks, and
  topics.
- An oldest-to-newest, bottom-following timeline that lets new work push
  earlier activity upward without interrupting someone reading the past.
- Journal entries with a user-selected activity timestamp.
- One-off tasks with optional notes and due timestamps.
- Topics and symmetric connections between supported record types.
- Permanent one-time points for creation, first completion, completed-task
  connections, and completing a topic containing at least three tasks.
- A subscribed Garden view that turns those same permanent awards into flowers,
  crops, topic trees, connection vines, and milestone growth.
- A server-aware CLI that accepts raw Specter Command and Query envelopes,
  updates live subscriptions, and retains explicit direct-SQLite access.
- Soft editing and archival; the Event Log remains the durable source of truth.

The app is local-only and uses a SQLite database at `data/worklog.db`. The live
production server uses fixed port `41736`; dev, preview, and verification use
fixed port `41737` so they can never attach to or displace the live service.
Documents, recurring tasks, habits, routines, planning, authentication, sync,
and application-level import/export are deferred.

## Garden

The Garden is a read-only view of the existing Event Log and permanent point
ledger. Journal entries grow flowers, tasks grow crops, topics grow trees, and
connections grow vines. First task completion ripens its crop, a completed-task
connection flowers its vine, and a completed topic fruits its tree. These earned
stages remain after reopening or later relationship changes.

Topic trees anchor stable garden plots, records without a topic appear in a
meadow, and archived elements remain visible but dormant. Day, Sunset, and Night
are browser-only presentation choices. The Garden adds no domain Events,
Commands, tables, timers, resources, decay, or upkeep state.

## Run it

```sh
pnpm install
pnpm build:publishable
pnpm --filter @specter/worklog dev
```

Open `http://127.0.0.1:41737` for the dev server. Production defaults to
`http://127.0.0.1:41736`, and its port can be set explicitly with
`WORKLOG_PORT`. The server and CLI use `WORKLOG_SQLITE_PATH` when set and
otherwise use `./data/worklog.db` relative to the app directory.

### Verification data isolation

`data/worklog.db` is live, user-owned data. Never use the default `dev` command
for tests, browser QA, screenshots, demos, or seeded examples. Start a
verification instance instead:

```sh
pnpm --filter @specter/worklog dev:verify
```

That command creates a temporary SQLite database outside the app directory and
removes it when the server exits. It runs on `41737`. Playwright uses this
command automatically and refuses to reuse an existing server, so it cannot
silently attach to the live Worklog instance on `41736`.

Offline CLI verification must likewise use an explicit temporary database:

```sh
verification_dir="$(mktemp -d)"
pnpm --filter @specter/worklog worklog -- query --db \
  "$verification_dir/worklog.db" --json \
  '{"type":"scoreQuery","payload":{"limit":100}}'
```

The agent-facing CLI accepts raw Specter envelopes and always returns JSON. By
default it uses the running server at `http://localhost:41736/api`, which keeps
web subscriptions current. Pass `--db` to explicitly use SQLite while the
server is stopped, or `--url` to require a different server. The CLI never
silently falls back after a server failure, so writes cannot unexpectedly bypass
live subscriptions:

```sh
pnpm --filter @specter/worklog worklog -- command --json \
  '{"type":"addTask","payload":{"taskId":"task-1","title":"Ship it","notes":null,"dueAt":null,"createdAt":"2026-07-18T15:00:00.000Z"}}'

pnpm --filter @specter/worklog worklog -- query --json \
  '{"type":"tasksQuery","payload":{"status":"all","topicId":null}}'
```

Omit `--json` to read one envelope from standard input. Commands also accept
`--idempotency-key`; both operations accept `--url` or `--db` as mutually
exclusive transport overrides. Command failures after a successful server
health check never fall back to SQLite, avoiding ambiguous duplicate writes.

The production server binds only to `127.0.0.1`. Specter API requests require
JSON bodies and a Worklog client header. A private reverse proxy such as
tailnet-only Tailscale Serve can forward requests without application Host or
Origin configuration; the proxy is responsible for access control and HTTPS.

## Backup

Stop the Worklog server and wait for any CLI command to finish, then copy
`data/worklog.db` to backup storage. Restore by replacing that file while
Worklog remains stopped. SQLite WAL mode is enabled for safe concurrent web
and CLI access during ordinary operation, but backups deliberately use a
quiescent database so the single file is complete.

## Implementation contract

Worklog is the committed-JSON pilot. Every feature stores its editable Slice
contract in `spec.json`; `impl.ts` imports that file directly. There are no
`spec.ts` sources or exporter steps in this app. Start the local visual editor
from the repository root with:

```sh
pnpm --filter @specter-ts/spec-editor build
node packages/spec-editor/dist/cli.js apps/worklog
```

The specifications retain exact executable Scenarios and kebab-case durable
Events. Runtime schemas remain at transport boundaries, and decision/query
projections remain private. Domain IDs and timestamps originate in the web or
CLI boundary and are included in Event payloads.
