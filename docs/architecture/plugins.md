# Plugins

Plugin interprets one Reaction output. Same-app Command output needs no explicit
Plugin; Specter dispatches it with stable delivery ID. External or custom output
uses `.plugin(...)`.

## Execution

```ts
type ReactionPlugin<TOutput> = (
  command: CommandDispatch,
) => Effect<ReactionExec<TOutput>, unknown, unknown>

type ReactionExec<TOutput> = (
  output: TOutput,
  context: ReactionDeliveryContext,
) => Effect<void, unknown>
```

Core initializes and caches executor during app construction. For each Event Log
commit, Reaction Store transaction applies Events, runs handler, validates
output, executes Plugin, then advances cursor. Failure rolls back State and
cursor.

## Default Command Plugin

Without `.plugin`, handler output must be Command envelope:

```ts
.outputSchema(createTodoCheerCommandSchema)
.store(TodoCheerStore)
```

Default Plugin dispatches Command with `deliveryId` as idempotency key. It waits
for nested Command commit, not nested Reactions. Shared SQLite/Postgres context
joins nested command work to active Reaction transaction.

## Delivery identity

`ReactionDeliveryContext` contains:

| Field | Meaning |
| --- | --- |
| `deliveryId` | Stable `reactionName:commitVersion`; use for idempotency. |
| `throughOrder` | Event Log commit version being processed. |
| `scheduledAt` | Durable Event Log commit timestamp. |

Core has no attempt IDs. Attempt metadata belongs to optional outbox worker.

## Direct or outboxed

Direct Plugin runs inside Slice Store transaction. Use it for fast, idempotent
same-app work or local capabilities.

Slow remote work should use maintained wrapper:

```ts
const durablePlugin = withReactionOutbox(emailPlugin, {
  store: persistence.createReactionOutboxStore(),
})
```

Wrapper enqueues output and context under `deliveryId` before Slice cursor
commits. Scoped worker runs wrapped Plugin outside Slice transaction, retries
with leases/backoff, dead-letters exhausted jobs, and supports replay.

## Invariants

- Handler remains deterministic from caught-up Slice State.
- One Reaction commit produces zero or one output.
- Return `undefined` for no output.
- Use runtime output schema at untrusted integration boundary.
- Treat direct external Plugin as at-least-once across crash window.
- Prefer provider idempotency; use outbox for slow work.
- Plugin executes decided effect; it is not second Command handler.

## Related documentation

- [Runtime](runtime.md)
- [Reaction outbox API](../api-reference/reaction-outbox.md)
- [Core runtime API](../api-reference/core-runtime.md)
