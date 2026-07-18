# MySQL Shipments brownfield service

A small Hono/Node service that preserves existing shipment readers while isolating a migration candidate at `POST /shipments/:id/dispatch`. MySQL is authoritative. Redis/BullMQ is a durable delivery mechanism backed by a transactional MySQL outbox.

## Prerequisites

- Node.js 22+
- pnpm 11+
- Docker with Compose v2
- Ports `42133` (HTTP), `42134` (MySQL), and `42135` (Redis) available

The HTTP server always binds `42133`, rejects any other `PORT` value, and exits on `EADDRINUSE`; it never selects another port.

## Exact local commands

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait db redis
pnpm migrate
pnpm seed
pnpm typecheck
pnpm test
RUN_LIVE_TESTS=1 pnpm test:live
pnpm build
docker compose config --quiet
pnpm worker
```

Run `pnpm start` in a second terminal for the API, and `pnpm reconcile -- --loop` in a third for continuous outbox repair. Or run the full production-shaped stack:

```sh
docker compose up -d --build db redis migrate app worker reconciler
curl --fail http://127.0.0.1:42133/health/ready
```

Stop it and remove all project volumes:

```sh
docker compose down --volumes --remove-orphans
```

## Public contract

Operations:

- `GET /health/live` — process liveness
- `GET /health/ready` — deterministic MySQL and Redis readiness
- `GET /shipments` — unchanged list reader
- `GET /shipments/:id` — unchanged detail reader
- `GET /shipments/:id/history` — unchanged history reader
- `POST /shipments` — create a pending shipment
- `POST /shipments/:id/dispatch` — atomic dispatch decision and durable notification handoff

All successful responses use `{"ok":true,"data":...}`. All errors use `{"ok":false,"error":{"code":"...","message":"..."}}`; validation errors may add `details`. Malformed JSON is `400 BAD_JSON`. Missing resources are `404 NOT_FOUND`. Duplicate references and invalid/repeated dispatch transitions are `409`.

Dispatch has no request body. Under a row lock it reads the persisted `status`, `payment_captured`, and `inventory_allocated` values. It rejects non-pending, unpaid, or unallocated shipments. A successful transaction updates the shipment, appends one history event, and inserts one deterministic outbox row. Redis enqueue is bounded; if Redis is down, HTTP still returns the committed result with `notification.delivery` set to `pending`.

Example:

```sh
curl -sS -X POST http://127.0.0.1:42133/shipments/shp-ready-001/dispatch
```

```json
{
  "ok": true,
  "data": {
    "shipment": { "id": "shp-ready-001", "status": "dispatched" },
    "notification": {
      "id": "outbox-dispatch-shp-ready-001",
      "jobId": "notify-dispatch-shp-ready-001",
      "delivery": "enqueued"
    }
  }
}
```

The real shipment object also contains its reference, recipient, prerequisite flags, and timestamps.

## Deterministic snapshot

`pnpm seed` can be run repeatedly. It reconciles five fixed records without resetting a shipment that has subsequently transitioned:

- `shp-ready-001`
- `shp-payment-002`
- `shp-inventory-003`
- `shp-cancelled-004`
- `shp-dispatched-005`

History/outbox identifiers and BullMQ job IDs are deterministic. Duplicate-key upserts preserve completed outbox/notification state. The seed command also invokes reconciliation, so missing Redis jobs are recreated idempotently.

## Recovery model

MySQL DDL auto-commits, so migrations do not pretend to be transactional. Every DDL statement is convergent (`IF NOT EXISTS`), the migration marker is written only after all statements succeed, and a named lock serializes runners. A partial failure can be rerun safely.

Outbox reconciliation selects `pending`, `enqueued`, and `dead_letter` rows. This repairs a failed initial enqueue, a lost Redis dataset, or an exhausted BullMQ job. Final-attempt failures are durably recorded with the failed job ID, attempt count, timestamp, and dead-letter count. Recovery advances `retry_generation` under a MySQL row lock and uses a deterministic non-colliding job ID such as `notify-dispatch-<shipment>-r1`. A crash after advancing the generation but before enqueue is safe: the pending generation is added on the next pass. The worker locks the outbox row and inserts a deterministic notification ID, so every generation still converges on one durable notification. Worker connection errors are handled and rate-limited to one structured log per five seconds while Redis is unavailable. Run once with `pnpm reconcile`, or continuously with `pnpm reconcile -- --loop`.

## Verification suites

- `pnpm test`: pure transition rules and public-route envelopes; live suites skip explicitly.
- `RUN_LIVE_TESTS=1 pnpm test:live`: repeat migrations/seeds, frozen HTTP reader/guard compatibility, concurrent transaction behavior, queue execution, bounded Redis failure, fresh-pool restart, actual final-attempt exhaustion, durable dead-letter observation, generation retry, and exactly-once notification persistence.
- `pnpm typecheck` and `pnpm build`: strict TypeScript and production output.

Live tests delete only their two fixed `LIVE-*` fixtures. They do not reset databases or seeded records.
