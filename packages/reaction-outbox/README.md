# `@specter-ts/reaction-outbox`

Optional durable delivery for slow or remote Reaction Plugins.

Core already retries a Reaction commit until its Slice cursor advances. Wrap a
Plugin when its external work should leave the Slice transaction quickly:

```ts
import { withReactionOutbox } from '@specter-ts/reaction-outbox'

const durableEmailPlugin = withReactionOutbox(emailPlugin, {
  store: persistence.createReactionOutboxStore(),
  worker: {
    maxAttempts: 5,
    leaseMs: 60_000,
  },
})
```

`withReactionOutbox` enqueues `{ output, context }` under core's stable
per-Reaction `deliveryId`. Slice state and cursor commit after enqueue. A scoped
worker runs wrapped Plugin outside Slice transaction, resumes pending or expired
jobs after restart, retries with backoff, and moves exhausted jobs to
dead-letter. `retryDeadLetter` replays one failed job. The wrapped Plugin
receives the same `{ command, query }` context and keeps its service
requirement type; Queries are allowed because the worker runs outside the Slice
transaction.

Use Store from same SQLite or Postgres persistence context as Slice Store when
enqueue and cursor must share transaction. `@specter-ts/jsonl` provides a file
Store whose enqueue is durable before the JSON Slice Store writes the cursor;
a replayed enqueue of the same `deliveryId` is a no-op. Give each wrapped
Plugin its own Store: its worker claims every job in that Store. Payload uses Store codec; bundled SQL
stores require JSON-compatible output and context. Custom Store codecs may
support another representation.

Store methods return Effects so enqueue can join active Slice Store transaction.
Low-level worker methods remain Promise-based at background-service boundary.

Stores with `subscribe` (memory, JSONL) wake workers in the same process on
enqueue, so jobs start without waiting for `pollIntervalMs`; polling still finds
work enqueued by other processes. Stores with `renewLease` (memory, JSONL) get
a lease heartbeat every `heartbeatMs` while a handler runs; renewal failures
reach `onTransition` as `lease-renewal-failed`.

When the wrapper's scope closes (for example on `app.close()`), its worker
stops claiming and the finalizer waits up to `shutdownTimeoutMs` (30 seconds
by default) for a running attempt to record its outcome, so a Store closed
afterwards does not run the job again. A low-level worker created without a
`signal` stays subscribed to its Store until `worker.close()`.

Worker delivery remains at least once. Provider may succeed before worker can
commit completion; with the JSONL Store, a crash that tears the `completed`
line has the same effect, and the job runs again after the next open. Wrapped Plugin should use `delivery.context.deliveryId` or
worker `context.jobId` as provider idempotency key when provider supports it.

Low-level `createReactionOutboxWorker` remains available for non-Specter jobs:

```ts
const worker = createReactionOutboxWorker({
  store,
  maxAttempts: 5,
  handle: async (effect, context) => {
    await provider.send(effect, { idempotencyKey: context.jobId })
  },
})

await worker.enqueue(effect, {
  jobId: 'delivery-123',
  idempotencyKey: 'delivery-123',
})
await worker.drain()
```
