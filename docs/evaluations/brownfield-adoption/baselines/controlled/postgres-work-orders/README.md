# PostgreSQL Work Orders

A controlled brownfield-style TypeScript service built with Fastify, PostgreSQL, pg-boss, Zod, and Vitest. The HTTP listener is fixed to `127.0.0.1:42131`; configuring another port fails validation, and an occupied port fails startup instead of falling back.

## Setup

Prerequisites: Node.js 22.12+, pnpm 11+, and Docker with Compose.

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d db
pnpm db:wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Readiness is available at `GET http://127.0.0.1:42131/health/ready` and returns 503 while either the application pool or durable scheduler cannot reach PostgreSQL. Database connection and query deadlines keep outage responses bounded; pg-boss errors degrade readiness without terminating the process, and the same scheduler resumes after PostgreSQL returns. The database wait performs exactly 30 attempts one second apart. Compose uses project `pgbw-work-orders-42131`, container `pgbw-work-orders-db-55431`, host database port `55431`, and volume `pgbw-work-orders-data-55431` to avoid collisions.

With the server running, a focused reader/candidate check is:

```sh
curl --fail-with-body http://127.0.0.1:42131/work-orders/WO-1001
curl --fail-with-body -X POST http://127.0.0.1:42131/work-orders/WO-1001/close \
  -H 'content-type: application/json' \
  -d '{"requestedBy":"manual-check"}'
curl --fail-with-body http://127.0.0.1:42131/work-orders/WO-1001
```

Stop the server with `Ctrl-C`, then remove the isolated database state with:

```sh
docker compose down --volumes
```

## Public operations

- `GET /health/live` and `GET /health/ready`
- `GET /work-orders` and `GET /work-orders/:id`
- `GET /work-orders/:id/history`
- `POST /work-orders`
- `PATCH /work-orders/:id/inspection`
- `POST /work-orders/:id/remind` (existing durable background notification behavior)
- `POST /work-orders/:id/close` (migration candidate)

All successful operations use `{ "ok": true, "data": ... }`. All errors use `{ "ok": false, "error": { "code", "message", "details"? } }`. Runtime validation maps invalid input and malformed JSON to 400, missing resources/routes to 404, and state conflicts to 409.

### Selected candidate contract

Request:

```http
POST /work-orders/WO-1001/close
Content-Type: application/json

{"requestedBy":"maintenance-console"}
```

The body is optional and strict; `requestedBy` defaults to `api`. The operation locks the persisted row with `SELECT ... FOR UPDATE`. Only `status=in_progress` plus `inspectionPassed=true` is accepted. In one database transaction it updates the work order, appends `work_order_history`, and inserts a durable `WorkOrderClosed` application event. After commit, the outbox dispatcher enqueues the event to the same pg-boss queue used by the reminder route. A deterministic singleton key and idempotent delivery table make dispatcher/worker retries safe; an event left pending by a crash is retried after restart.

Success is HTTP 200:

```json
{
  "ok": true,
  "data": {
    "eventId": "<uuid>",
    "workOrder": {
      "id": "WO-1001",
      "title": "Hydraulic pump overhaul",
      "status": "closed",
      "inspectionPassed": true,
      "closedAt": "<iso-8601>",
      "version": 4,
      "createdAt": "2025-01-02T09:00:00.000Z",
      "updatedAt": "<iso-8601>"
    }
  }
}
```

Conflict examples are `INVALID_STATUS`, `INSPECTION_REQUIRED`, and `ALREADY_CLOSED`, all with HTTP 409. `WORK_ORDER_NOT_FOUND` is HTTP 404. `INVALID_REQUEST` and `INVALID_JSON` are HTTP 400. The pre-existing `GET /work-orders/:id` reader observes the newly closed state without a response-contract change.

## Deterministic legacy snapshots

The repeat-safe seed fully reconciles work order, history, application-event, delivery, and fixture-associated pg-boss job/archive rows before restoring:

| ID | Status | Inspection | Candidate result |
| --- | --- | --- | --- |
| `WO-1001` | `in_progress` | passed | accepted |
| `WO-1002` | `open` | passed | `INVALID_STATUS` |
| `WO-1003` | `in_progress` | not passed | `INSPECTION_REQUIRED` |
| `WO-1004` | `closed` | passed | `ALREADY_CLOSED` |
| `WO-1005` | `cancelled` | passed | `INVALID_STATUS` |
| `WO-1006` | `in_progress` | passed | accepted/restart fixture |

Rerunning `pnpm db:seed` restores exactly one `seed_snapshot` history row per fixture and removes all fixture-related events, deliveries, and jobs, so it cannot combine reset domain state with stale background work.

## Migrations and validation

Migrations are ordered SQL up/down pairs protected by an advisory lock and recorded with SHA-256 checksums. `pnpm db:rollback` rolls back exactly the latest applied migration; `pnpm db:migrate` reapplies pending migrations.

Run the complete validation sequence while the database is up:

```sh
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
pnpm db:wait
pnpm db:migrate
pnpm db:rollback
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm test:live
```

The non-live test command runs deterministic domain and injected public-route tests. `test:live` exercises real migrations, the database-backed route, atomic durable rows, seed idempotency, pg-boss execution, and delivery after scheduler restart.

For a production-mode run after migrations and seeding:

```sh
pnpm build
pnpm start
```

The process starts the durable scheduler before listening and closes Fastify, the scheduler, and the PostgreSQL pool on `SIGINT`/`SIGTERM`.
