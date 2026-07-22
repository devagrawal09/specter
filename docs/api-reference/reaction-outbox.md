# Reaction outbox API

**Import:** `@specter-ts/reaction-outbox`

Optional durable wrapper for slow Reaction Plugins plus generic leased outbox
worker.

## Public values

| Export | Purpose |
| --- | --- |
| `withReactionOutbox` | Wraps any Plugin with durable enqueue and scoped worker. |
| `createMemoryReactionOutboxStore` | Deterministic process-local Store. |
| `createReactionOutboxWorker` | Generic enqueue/drain/replay worker. |
| `runReactionOutboxWorker` | Polls worker until aborted. |
| `ReactionOutboxLeaseLostError` | Stale attempt transition. |
| `ReactionOutboxDrainFailure` | Newly dead-lettered failures from drain. |

## Plugin wrapper

```ts
const durablePlugin = withReactionOutbox(emailPlugin, {
  store: persistence.createReactionOutboxStore(),
  worker: { maxAttempts: 5, leaseMs: 60_000 },
  pollIntervalMs: 250,
})
```

Wrapper enqueues `OutboxedReaction<TOutput> = { output, context }` under stable
`deliveryId`. Slice cursor commits after enqueue. Scoped worker executes wrapped
Plugin outside Slice transaction and resumes unfinished jobs at app startup.

`ReactionOutboxPluginOptions` accepts Store, worker retry/lease options, polling
interval, and polling error callback. SQL Store codecs require JSON-compatible
output and context by default.

`ReactionOutboxStore` operations return Effects. This lets SQL adapters join an
active Slice Store transaction without AsyncLocalStorage or a Promise bridge.
Low-level worker methods remain Promise-based for ordinary background-service
integration.

## Worker lifecycle

Defaults: five attempts, five-minute lease, exponential backoff from one second,
random UUID job IDs, system clock.

1. `enqueue` writes pending job; duplicate idempotency key returns existing job.
2. `drain` requeues expired leases and claims next available job.
3. Handler gets stable job identity plus attempt ID/number.
4. Success completes active attempt.
5. Failure reschedules or dead-letters at max attempts.
6. `retryDeadLetter` returns one failed job to pending.

Attempt metadata belongs to worker, not core Reaction context. Use stable job ID
or Reaction `deliveryId` for provider deduplication, never attempt ID.

## Guarantees

- Delivery is at least once across provider/worker completion crash window.
- Lease prevents stale completion; it does not cancel handler.
- Listener failure cannot change delivery state.
- SQLite/Postgres stores support multi-worker claims and restart recovery.
- Use same persistence context as Slice Store when enqueue and cursor must share
  transaction.

## Related documentation

- [Plugins](../architecture/plugins.md)
- [Runtime](../architecture/runtime.md)
- [Persistence](persistence.md)
