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
- A direct SQLite CLI that accepts raw Specter Command and Query envelopes and
  returns JSON.
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

The agent-facing CLI accepts raw Specter envelopes and always returns JSON:

```sh
pnpm --filter @specter/worklog worklog -- command --json \
  '{"type":"addTask","payload":{"taskId":"task-1","title":"Ship it","notes":null,"dueAt":null,"createdAt":"2026-07-18T15:00:00.000Z"}}'

pnpm --filter @specter/worklog worklog -- query --json \
  '{"type":"tasksQuery","payload":{"status":"all","topicId":null}}'
```

Omit `--json` to read one envelope from standard input. Commands also accept
`--idempotency-key`; both operations accept `--db` to override the database.

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
