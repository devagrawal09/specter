# Mongo Returns

A controlled brownfield-style merchandise returns API using Express, MongoDB transactions, Agenda, Zod, TypeScript, and Vitest.

The public API always listens on port `42132`. The MongoDB replica set is exposed on `42133`. Neither port falls back to another value when occupied. The HTTP listener binds before Agenda starts, so a port conflict exits without locking durable jobs. Agenda uses bounded topology checks, and readiness stays unavailable until a one-shot Agenda probe has actually executed after startup or a database outage. The short lock lifetime lets due work left by a failed worker resume safely.

## Prerequisites

- Node.js 22 or newer
- pnpm 11
- Docker with Compose

## Exact local setup

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d mongo mongo-init
docker compose wait mongo-init
docker compose ps -a
pnpm migrate
pnpm seed
pnpm seed
pnpm dev
```

The second seed is intentional: it demonstrates that the baseline reconciler is repeat-safe. Stop the foreground API with `Ctrl-C`.

Run the compiled production server instead with:

```sh
pnpm build
pnpm start
```

Or run the production image after explicitly preparing the baseline:

```sh
docker compose --profile app up --build api
```

Container startup applies indexes but never reseeds, so application data and pending Agenda jobs survive restarts.

## API contract

Every success uses:

```json
{"ok":true,"data":{}}
```

Every error uses:

```json
{"ok":false,"error":{"code":"STABLE_CODE","message":"Stable message."}}
```

Validation failures may add `error.details`. Malformed JSON is always `400 MALFORMED_JSON`. Domain misses are `404`; invalid or repeated transitions are `409`.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/health` | none | readiness data, or bounded `503 NOT_READY` while MongoDB/Agenda is unavailable |
| GET | `/returns` | none | legacy return collection |
| GET | `/returns/:id` | none | legacy return record |
| POST | `/returns` | `orderId`, `customerId`, `itemSku`, `reason`, `refundAmountCents` | `201` requested return |
| POST | `/returns/:id/receive` | `{}` | received return |
| POST | `/returns/:id/inspect` | `{"outcome":"accepted"}` or `{"outcome":"rejected"}` | inspected return |
| POST | `/returns/:id/approve-refund` | `{}` | refunded return and approval |

Refund approval is a MongoDB transaction. It rereads persisted return state, requires both receipt and an accepted inspection, changes the return with an optimistic version predicate, inserts one approval and one history event, cancels a pending receipt reminder, and inserts one idempotent durable refund job. No caller-provided amount or decision state is trusted.

Example:

```sh
curl -sS http://127.0.0.1:42132/returns
curl -sS -X POST http://127.0.0.1:42132/returns/ret-1001/approve-refund \
  -H 'content-type: application/json' \
  -d '{}'
```

## Deterministic snapshot

The reconciler owns these IDs:

- `ret-1001`: received, inspected, accepted, eligible
- `ret-1002`: accepted and already refunded
- `ret-1003`: not received, reminder pending
- `ret-1004`: received but not inspected
- `ret-1005`: received, inspected, rejected
- `ret-1006`: received, inspected, accepted, eligible for concurrency checks

It reconciles the six returns plus the owned approval, reminder, history, and Agenda job records. Run it only when resetting these controlled baseline IDs is intended.

## Verification

With the replica set running:

```sh
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
RUN_LIVE_TESTS=1 pnpm exec vitest run tests/live
```

The live suite covers repeated migrations/seeds, legacy public readers, transaction commit and rollback decisions, simultaneous approval requests, Agenda execution, execution of a persisted job after a worker restart, stale-lock recovery, a full MongoDB stop/restart with readiness proof and prompt new work, and exact cleanup of all live-created state. Each live test establishes and reconciles its own baseline, so focused `-t` invocations are supported.

To prove the fixed public port fails on conflict, start one API and then run `pnpm start` in a second terminal; the second process exits with `EADDRINUSE`.

## Shutdown and cleanup

```sh
docker compose --profile app down -v --remove-orphans
```

This stops all project services and removes `mongo-returns-data`.
