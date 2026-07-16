# `@specter-ts/reaction-outbox`

A storage-independent, at-least-once Reaction delivery worker for Specter.

The worker provides durable enqueue idempotency, deterministic attempt IDs,
leases for crash recovery, configurable retry/backoff, dead-letter storage,
and explicit dead-letter replay. Effects receive a stable delivery ID, a stable
scheduled time, and an attempt ID so plugins can make external side effects
idempotent and deterministic.

Pass the same `AbortSignal` to the worker and `runReactionOutboxWorker` to stop
cleanly during application shutdown. The polling service also discovers
effects enqueued by other application processes.

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
  idempotencyKey: 'order-123:confirmation-email',
})
await worker.drain()
```

`createDurableReactionScheduler` integrates the worker with Specter's Reaction
pass contract. It resumes pending and expired passes when the application is
constructed. Specter commits each successful Reaction projection only after
its plugin completes, so retrying a pass re-executes failed Reactions while
skipping successful independent Reactions.

Delivery is at least once: a process can crash after an external effect
succeeds but before its Slice cursor commits. Reaction Plugins must use the
provided stable delivery ID for provider-side idempotency.

For production external effects, use `createOutboxReactionPlugin`. It writes
the effect to the durable store under core's stable per-Reaction delivery ID
and returns quickly. If the process fails before the Slice cursor publishes,
the retried Reaction deduplicates the same outbox delivery. Run a separate
worker to call the external provider outside Slice catch-up and command paths.
