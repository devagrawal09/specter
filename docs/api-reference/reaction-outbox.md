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
| `runReactionOutboxWorker` | Drains until aborted, polling and waking on in-process enqueue. |
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
`withReactionOutbox<TOutput, R>` passes the same `ReactionPluginContext` to the
wrapped Plugin and preserves its service requirements `R`. Because the worker
runs outside the Slice transaction, the wrapped Plugin may call `query`.

`ReactionOutboxPluginOptions` accepts Store, worker retry/lease/heartbeat
options, polling interval, shutdown timeout, and polling error callback. When
the Plugin scope closes, the worker stops claiming and the finalizer waits up
to `shutdownTimeoutMs` (default 30 seconds) for a running attempt to record
its outcome before Stores are closed. SQL and JSONL Store
codecs require JSON-compatible output and context by default.

Stores:

| Store | Package | Enqueue and cursor |
| --- | --- | --- |
| `createMemoryReactionOutboxStore` | `@specter-ts/reaction-outbox` | Process-local; lost on exit. |
| `createSqliteReactionOutboxStore` | `@specter-ts/sqlite` | Same transaction with shared context. |
| `createPostgresReactionOutboxStore` | `@specter-ts/postgres` | Same transaction with shared context. |
| `createJsonlReactionOutboxStore` | `@specter-ts/jsonl` | Enqueue durable before cursor write; replay is a no-op. |

Each wrapper runs its own worker, and a worker claims every job in its Store,
so give each wrapped Plugin its own Store (table scope or JSONL file).

`ReactionOutboxStore` operations return Effects. This lets SQL adapters join an
active Slice Store transaction without AsyncLocalStorage or a Promise bridge.
Low-level worker methods remain Promise-based for ordinary background-service
integration.

## Worker lifecycle

Defaults: five attempts, five-minute lease, heartbeat every third of the lease,
exponential backoff from one second, one attempt at a time, random UUID job
IDs, system clock.

1. `enqueue` writes pending job; duplicate idempotency key returns existing job.
2. `drain` requeues expired leases and claims next available job.
3. Handler gets stable job identity plus attempt ID/number.
4. Success completes active attempt.
5. Failure reschedules or dead-letters at max attempts.
6. `retryDeadLetter` returns one failed job to pending.

Optional Store capabilities:

- `subscribe(listener)` wakes workers in the same process after an enqueue or
  dead-letter retry. The worker then ends its poll wait, or a backoff wait for
  a later job, at once. `worker.enqueue` wakes its own worker with any Store.
  Memory and JSONL Stores implement it; SQL Stores rely on polling, since
  their enqueue becomes visible only when the Slice transaction commits.
  Workers in other processes always poll.
- `concurrencyKeys: true` means the Store keeps each job's `concurrencyKey` and
  `claimNext` never claims a job while another job with the same key is
  running. Only over such a Store may a worker run several attempts at once
  (`worker.concurrency`, default 1): jobs with different keys run in parallel,
  and jobs sharing a key still run one at a time, in claim order. A job waiting
  for its key is not counted as available work. The wrapper sets each job's key
  with `concurrencyKey(output)`; `worker.enqueue` takes `{ concurrencyKey }`.
  The memory Store implements it.
- `renewLease(jobId, attemptId, leaseExpiresAt)` lets the worker heartbeat a
  running attempt every `heartbeatMs` (shorter than `leaseMs`), so a slow
  handler keeps its lease. A lost attempt stops renewing; its completion then
  fails with `ReactionOutboxLeaseLostError`. Memory and JSONL Stores implement
  it; SQL Stores keep the lease set at claim.

`worker.waitForWork(ms, { sleep, signal })` is the interruptible wait used by
`drain` and `runReactionOutboxWorker`. Waits share one wake-up, so another
caller of `waitForWork` can take a wake-up meant for `drain`; the job then
starts on the next poll or backoff wait, at worst one poll interval later.
`worker.close()` stops a worker like aborting its `signal`: it unsubscribes
from the Store, ends waits, and stops `runReactionOutboxWorker`; a worker
created without a `signal` stays subscribed until closed. Renewal failures
reach `onTransition` as `lease-renewal-failed` with `leaseLost`.
`heartbeatMs` must also be at most 2,147,483,647, the largest timer delay.

Attempt metadata belongs to worker, not core Reaction context. Use stable job ID
or Reaction `deliveryId` for provider deduplication, never attempt ID.

## Guarantees

- Delivery is at least once across provider/worker completion crash window.
- Lease prevents stale completion; it does not cancel handler. Heartbeats
  extend it only on Stores with `renewLease`.
- Listener failure cannot change delivery state.
- SQLite/Postgres stores support multi-worker claims and restart recovery.
- JSONL store has one writer per file; it releases attempts left running by
  an earlier open as soon as it opens, without waiting for their lease.
- Use same persistence context as Slice Store when enqueue and cursor must share
  transaction.

## Related documentation

- [Plugins](../architecture/plugins.md)
- [Runtime](../architecture/runtime.md)
- [Persistence](persistence.md)
