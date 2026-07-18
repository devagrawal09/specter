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

## Implementation contract

Every feature uses the Specter `spec.ts`/`impl.ts` Slice boundary, exact
executable Scenarios, kebab-case durable Events, runtime schemas at transport
boundaries, and private event-derived decision/query projections. Domain IDs
and timestamps originate in the web or CLI boundary and are included in Event
payloads.
