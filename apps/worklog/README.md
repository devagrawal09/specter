# Worklog

Worklog is a single-user local application for capturing a journal timeline,
tracking one-off tasks, organizing topics, connecting related records, and
earning an auditable lifetime score.

## Core release

- Timeline-first Solid web UI with a persistent journal composer.
- Journal entries with a user-selected activity timestamp.
- One-off tasks with optional notes and due timestamps.
- Topics and symmetric connections between supported record types.
- Permanent one-time points for creation, first completion, completed-task
  connections, and completing a topic containing at least three tasks.
- A server-aware CLI that accepts raw Specter Command and Query envelopes,
  updates live subscriptions, and retains explicit direct-SQLite access.
- Soft editing and archival; the Event Log remains the durable source of truth.

The app is local-only, uses a SQLite database at `data/worklog.db`, and runs on
fixed port `41736`. Documents, recurring tasks, habits, routines, planning,
authentication, sync, and application-level import/export are deferred.

## Run it

```sh
pnpm install
pnpm build:publishable
pnpm --filter @specter/worklog dev
```

Open `http://127.0.0.1:41736`. The server and CLI use
`WORKLOG_SQLITE_PATH` when set and otherwise use `./data/worklog.db` relative
to the app directory.

### Verification data isolation

`data/worklog.db` is live, user-owned data. Never use the default `dev` command
for tests, browser QA, screenshots, demos, or seeded examples. Start a
verification instance instead:

```sh
pnpm --filter @specter/worklog dev:verify
```

That command creates a temporary SQLite database outside the app directory and
removes it when the server exits. Playwright uses this command automatically and
refuses to reuse an existing server, so it cannot silently attach to a live
Worklog instance.

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

The production server binds only to `127.0.0.1`. Specter API requests also
require JSON bodies, a Worklog client header, a loopback Host, and a trusted
same-origin browser Origin. These controls keep the unauthenticated local API
out of reach of LAN clients and cross-origin form submissions; Worklog is not
designed to be exposed through a remote bind or reverse proxy.

## Backup

Stop the Worklog server and wait for any CLI command to finish, then copy
`data/worklog.db` to backup storage. Restore by replacing that file while
Worklog remains stopped. SQLite WAL mode is enabled for safe concurrent web
and CLI access during ordinary operation, but backups deliberately use a
quiescent database so the single file is complete.

## Implementation contract

Every feature uses the Specter `spec.ts`/`impl.ts` Slice boundary, exact
executable Scenarios, kebab-case durable Events, runtime schemas at transport
boundaries, and private event-derived decision/query projections. Domain IDs
and timestamps originate in the web or CLI boundary and are included in Event
payloads.
