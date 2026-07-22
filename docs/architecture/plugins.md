# Plugins

In Specter, Plugin is effect interpreter for one Reaction Slice. Same-app
Command output needs no explicit Plugin: Specter dispatches output as Command,
using stable delivery ID for idempotency. Arbitrary output or external boundary
requires explicit Plugin. Plugin is not generic application extension system.

## From Event to effect

A completed Reaction follows one explicit path:

1. New Events catch the Reaction's Slice State up through its declared apply handlers.
2. The Reaction handler reads that state and returns either one effect description or `undefined`.
3. The output schema validates and may transform the handler result into the Plugin's public effect type.
4. Core asks the Plugin for an executor, then calls that executor with the effect and a delivery context.
5. Only after the executor succeeds does core publish the Reaction Slice cursor.

The Plugin interface captures that split:

```ts
type ReactionPlugin<TOutput> = (
  command: CommandDispatch,
) => Effect<ReactionExec<TOutput>, unknown, unknown>

type ReactionExec<TOutput> = (
  effect: TOutput,
  context: ReactionDeliveryContext,
) => Effect<void, unknown>
```

Core creates and caches one executor per Reaction name. The outer function can initialize a client or bind configuration once. The returned executor performs each delivery.

## Todo example: default same-app Command

The Todo Reference app reacts at each five-completion milestone. Its handler
queries the Reaction Slice's private projection and returns a `createTodoCheer`
Command envelope when new milestone is due. Output type extends
`CommandEnvelope`, so implementation goes directly from schema to Store:

```ts
.outputSchema(todoCheerCommandSchema)
.store(TodoCheerStore)
```

The complete implementation, including the output schema, apply handlers, and
Drizzle projection query, lives in
[`todo-completion-cheer-reaction/impl.ts`](../../apps/reference/src/features/todos/todo-completion-cheer-reaction/impl.ts).

Default dispatch still
passes through target Command schema, expected-version Event append,
allowed-Event check, and idempotency handling. Default dispatcher uses `deliveryId` as
the idempotency key so retrying the same Reaction delivery resolves to the
original Command commit instead of creating a second cheer. It waits for nested
Command commit only; nested Reaction drain remains separate, avoiding scheduler
self-deadlock.

## Delivery identity

Every executor receives:

| Field | Stability | Use |
| --- | --- | --- |
| `deliveryId` | Stable for one Reaction name and caught-up Event cursor across retries | Logical effect identity and downstream idempotency key. |
| `scheduledAt` | Captured once when the scheduler first creates the pass | Stable request timestamp. |
| `attemptId` | Stable within one attempt, different on a retry | Attempt-level tracing and lease ownership. |
| `attemptNumber` | One-based and increases on a retry | Retry diagnostics and policy. |

Use `deliveryId`, not `attemptId`, when the same logical effect must deduplicate across retries.

## Immediate and durable execution

An immediate Plugin can dispatch a same-app Command or call an in-process capability. It keeps the implementation small and is appropriate when that effect already has a durable idempotency boundary.

External I/O needs a stronger boundary. `createOutboxReactionPlugin` durably enqueues the decoded effect using `deliveryId`, then returns. A separate Reaction outbox worker performs the remote call with leases, backoff, and dead-letter handling. If the app crashes after enqueue but before publishing the Reaction cursor, replay enqueues the same ID and the store returns the existing job.

The Reaction scheduler is a separate concern from the Plugin:

- The scheduler decides when a Reaction pass runs and supplies pass delivery context.
- The Reaction handler decides whether an effect is needed.
- The Plugin interprets that effect.
- The optional outbox worker delivers queued external work.

`createImmediateReactionSchedulerLayer` serializes queued passes in process and
executes every request separately. `createDurableReactionSchedulerLayer` stores
Reaction-pass jobs and recovers pending or expired passes after restart. Either
scheduler can be paired with immediate or outbox-backed Plugin depending on
effect boundary.

## Invariants and pitfalls

- Keep the handler deterministic from its caught-up Slice State. Put network calls, clocks, and provider clients in the Plugin or worker.
- A Reaction produces zero or one effect per handler run. Return `undefined` for no effect.
- Declare an output schema even when the effect is a same-app Command envelope. The Plugin receives the schema's decoded output.
- Treat every attempted Plugin execution as duplicate-prone. Core cannot
  atomically commit an arbitrary external provider call with the local Slice
  cursor. Surviving process restart requires a durable scheduler or outbox.
- Use idempotent same-app Commands or provider-side idempotency. A successful external call followed by a crash can be retried.
- Do not await a nested Reaction pass from inside a Reaction-dispatched Command. Core requests another pass without making the active pass wait on itself.
- One Reaction failure does not prevent independent Reactions in the same pass from running. The pass reports the collected failures after all runnable Reactions settle.
- Do not use Plugins to bypass domain decisions. A Plugin executes an already-decided effect; it should not become a second Command handler.

## Related documentation

- [Runtime architecture](./runtime.md)
- [CQRS](./cqrs.md)
- [Event sourcing](./event-sourcing.md)
- [Writing executable specifications](../specifications/writing-specifications.md)
- [Reaction outbox API](../api-reference/reaction-outbox.md)
- [Core runtime API](../api-reference/core-runtime.md)
