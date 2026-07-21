# Reaction outbox API

**Import:** `@specter-ts/reaction-outbox`

**Status:** `0.3.0` main-branch preview; the published npm release remains `0.2.1`.

The Reaction outbox package provides storage-independent, at-least-once background delivery. It can durably schedule whole Specter Reaction passes, durably enqueue an individual Reaction effect through a Plugin, or run a general payload worker against any conforming outbox store.

## Public values

| Export | Purpose |
| --- | --- |
| `createMemoryReactionOutboxStore` | Creates a deterministic in-memory `ReactionOutboxStore` with a `reset()` method. |
| `createOutboxReactionPlugin` | Creates a Reaction Plugin that maps and durably enqueues one effect under core's stable delivery ID. |
| `createDurableReactionScheduler` | Adapts an outbox store of `ReactionPass` jobs to core's `ReactionScheduler` contract. |
| `createReactionOutboxWorker` | Creates an enqueue/drain/retry worker for an arbitrary payload type. |
| `runReactionOutboxWorker` | Polls a worker until aborted, including work enqueued by other processes. |
| `ReactionOutboxLeaseLostError` | Error raised when an attempt tries to transition a job after its lease is no longer active. |
| `ReactionOutboxDrainFailure` | Aggregate error raised after a drain moves one or more jobs to dead-letter. |

## Public types

| Export | Meaning |
| --- | --- |
| `ReactionOutboxStatus` | Job state: `pending`, `running`, `completed`, or `dead-letter`. |
| `ReactionOutboxJob<TPayload>` | Durable job record, schedule, attempt count, lease, completion, and last error. |
| `ReactionOutboxClaim<TPayload>` | Running job with required active attempt ID and lease expiry. |
| `ReactionOutboxStore<TPayload>` | Storage contract for enqueue, claim, transition, recovery, inspection, and dead-letter retry. |
| `MemoryReactionOutboxStore<TPayload>` | In-memory store contract plus `reset()`. |
| `EnqueueReactionInput<TPayload>` | Fully identified payload and initial request/availability timestamps accepted by a store. |
| `EnqueueReactionResult<TPayload>` | Existing or new job plus whether this enqueue created it. |
| `EnqueueReactionOptions` | Optional job ID, idempotency key, and availability time accepted by a worker. |
| `ReactionOutboxAttemptContext` | Stable job identity and request time plus attempt-specific ID and number passed to a worker handler. |
| `ReactionOutboxTransition<TPayload>` | Discriminated lifecycle notification for enqueue, attempt, retry, dead-letter, and replay transitions. |
| `ReactionOutboxTransitionListener<TPayload>` | Best-effort observer of outbox transitions. |
| `OutboxReactionPluginOptions<TEffect, TPayload>` | Store and optional effect-to-payload mapper for `createOutboxReactionPlugin`. |
| `DurableReactionSchedulerOptions` | Retry, lease, clock, sleep, cancellation, identity, transition, and background-error options for the scheduler. |
| `ReactionPass` | `{ kind: 'reaction-pass' }` payload used by the durable scheduler. |
| `ReactionOutboxWorkerOptions<TPayload>` | Store, handler, retry policy, lease, clock, cancellation, identity, and transition options for a worker. |
| `ReactionOutboxWorker<TPayload>` | Worker methods: `enqueue`, `drain`, and `retryDeadLetter`. |
| `ReactionOutboxServiceOptions` | Cancellation, poll interval, sleep, and error handling for `runReactionOutboxWorker`. |
| `ReactionOutboxFailure` | Job ID, attempt ID, and cause recorded in a drain failure. |

## Worker lifecycle

`createReactionOutboxWorker` uses these defaults: five attempts, a five-minute lease, exponential backoff starting at one second, `randomUUID()` job IDs, and the system clock.

1. `enqueue` writes a `pending` job. Its idempotency key defaults to its job ID. Re-enqueuing a key returns the existing job with `created: false`.
2. `drain` first requeues expired leases, then claims the next available job as `running`. The bundled stores order claims by availability, request time, then ID.
3. The handler receives the payload and a context. `jobId`, `idempotencyKey`, and `requestedAt` stay stable; `attemptId` and one-based `attemptNumber` change on a retry.
4. Success transitions the active attempt to `completed`.
5. Failure before `maxAttempts` returns it to `pending` at `now + backoffMs(attemptNumber)`.
6. Failure at `maxAttempts` moves it to `dead-letter`; the drain finishes other available jobs, then throws one `ReactionOutboxDrainFailure` containing all newly dead-lettered failures.
7. `retryDeadLetter` explicitly returns one dead-lettered job to `pending`. It preserves the existing attempt count, so configure the worker's `maxAttempts` accordingly before replaying it.

Concurrent calls to `drain` share one active drain and request another pass instead of running competing loops inside the same worker. Store leases provide cross-worker crash recovery. A completion, reschedule, or dead-letter transition must name the active attempt; otherwise a conforming store throws `ReactionOutboxLeaseLostError`.

Transition listeners are operational only: listener failures are swallowed and cannot change delivery semantics.

## Scheduler versus Plugin

These integrations protect different boundaries:

- `createDurableReactionScheduler` stores a `ReactionPass`. When the worker handles it, core catches up and runs every eligible Reaction. It resumes pending and expired passes when the app is constructed.
- `createOutboxReactionPlugin` is attached to one Reaction Slice. It stores that Slice's decoded effect and returns after enqueue, moving slow or remote I/O out of the Reaction pass.

The Plugin uses core's per-Reaction `deliveryId` as both job ID and idempotency key. If a process crashes after enqueue but before the Slice cursor is published, the retried Reaction deduplicates the same job. Its optional `map(effect, deliveryContext)` runs before enqueue and can shape a provider-specific payload.

## Minimal Todo effect worker

```ts
import {
  createMemoryReactionOutboxStore,
  createReactionOutboxWorker,
} from '@specter-ts/reaction-outbox'

type TodoCheerEffect = {
  readonly milestone: number
  readonly message: string
}

const store = createMemoryReactionOutboxStore<TodoCheerEffect>()
const worker = createReactionOutboxWorker({
  store,
  handle: async (effect, context) => {
    await cheerProvider.send(effect, {
      idempotencyKey: context.idempotencyKey,
    })
  },
})

await worker.enqueue(
  { milestone: 5, message: 'Nice work: 5 todos completed.' },
  { idempotencyKey: 'todo-cheer:5' },
)
await worker.drain()
```

For a long-running process, pass the same `AbortSignal` to `createReactionOutboxWorker` and `runReactionOutboxWorker` for coordinated polling shutdown. A long-running handler must observe cancellation through its own integration. Use the SQLite or Postgres outbox store for durable production work; the memory store is process-local.

## Constraints and delivery guarantees

- Delivery is at least once. A process can crash after external I/O succeeds but before completion is recorded.
- Use the stable job ID or idempotency key for provider-side deduplication. Never use `attemptId` as the logical effect identity.
- A lease does not cancel a handler when it expires. It prevents a stale attempt from overwriting the state of a newer claim.
- `maxAttempts` must be a positive integer; `leaseMs` and polling intervals must be positive; backoff must be finite and non-negative.
- `createOutboxReactionPlugin` rejects an unparseable `scheduledAt` before
  enqueue. Schedulers should still provide the documented ISO-8601 value.
- Storage adapters may impose serialization constraints. The SQLite and Postgres adapters persist JSON payloads.
- `runReactionOutboxWorker` rethrows drain errors unless `onError` is provided.

## Related documentation

- [Plugins](../architecture/plugins.md)
- [Runtime architecture](../architecture/runtime.md)
- [Core runtime API](./core-runtime.md)
- [Persistence API](./persistence.md)
- [Observability API](./observability.md)
