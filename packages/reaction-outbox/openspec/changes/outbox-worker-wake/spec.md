# Outbox worker wake-up and lease heartbeat

## Goal

A worker should start a job enqueued in its own process without waiting for
`pollIntervalMs`, and a slow handler should keep its attempt lease instead of
being claimed again while it still runs.

## Scope

- In: optional `subscribe` and `renewLease` on `ReactionOutboxStore`; worker
  wake-up that ends poll and backoff waits; `worker.waitForWork`; lease
  heartbeat every `heartbeatMs`; memory Store support; tests and docs.
- Out: handler cancellation on lease loss; `renewLease`/`subscribe` in the
  SQLite and Postgres Stores (they keep polling and the claim-time lease).
- The JSONL Store that uses both capabilities is a separate change in
  `packages/jsonl`.

## Required behavior

- Polling stays the fallback for work enqueued by other processes.
- A wake-up during a wait ends it; one that arrives while no wait is in
  progress ends the next wait at once.
- `worker.enqueue` and `retryDeadLetter` wake their own worker for any Store.
- Heartbeats stop on `ReactionOutboxLeaseLostError` and when the handler
  settles; `heartbeatMs` must be positive and shorter than `leaseMs`.

## Tasks

- [x] Extend the Store contract, worker, and memory Store.
- [x] Test wake-up in the polling service, backoff waits, pending wake-ups,
      the Plugin wrapper, lease renewal, and Stores without renewal.
- [x] Update `packages/reaction-outbox/README.md` and
      `docs/api-reference/reaction-outbox.md`.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter-ts/reaction-outbox test`
- `pnpm --filter @specter-ts/reaction-outbox typecheck`
- `node scripts/validate-openspec.mjs`
