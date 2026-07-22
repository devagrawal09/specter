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
dead-letter. `retryDeadLetter` replays one failed job.

Use Store from same SQLite or Postgres persistence context as Slice Store when
enqueue and cursor must share transaction. Payload uses Store codec; bundled SQL
stores require JSON-compatible output and context. Custom Store codecs may
support another representation.

Store methods return Effects so enqueue can join active Slice Store transaction.
Low-level worker methods remain Promise-based at background-service boundary.

Worker delivery remains at least once. Provider may succeed before worker can
commit completion. Wrapped Plugin should use `delivery.context.deliveryId` or
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
