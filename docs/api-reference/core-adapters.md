# Core adapters API

**Import:** `@specter-ts/core`

**Status:** `0.3.0` main-branch preview; the published npm release remains `0.2.1`.

Import adapter contracts as types. Implement them only
when a bundled memory, SQLite, or Postgres adapter does not fit your project.

## Purpose

Adapters keep Event Log persistence, disposable Slice State, and Reaction pass
scheduling outside core. The contracts are behavioral: implementations must
preserve transaction, ordering, cursor, idempotency, and retry invariants.

## Public types

| Export | Purpose |
| --- | --- |
| `EventLogCommit` | Durable receipt containing Events, version, and optional idempotency metadata. |
| `EventLogAppendResult` | Commit receipt plus `duplicate`, which says whether this attempt wrote Events. |
| `EventLogAppendOptions` | Optional `expectedVersion`, `idempotencyKey`, and runtime-computed `fingerprint`. |
| `EventLogTransaction` | `query`, `currentVersion`, `findCommit`, and `append` operations in one transaction view. |
| `EventLogAdapter` | Event Log operations plus a serialized `transaction(run)` boundary. |
| `SliceStore<TWrite, TRead>` | Write/read capabilities, cursor read, and cursor publication. |
| `SliceStoreAdapter<TWrite, TRead>` | Retrieves staged State and runs per-Slice local transactions. |
| `ReactionDeliveryContext` | Stable delivery identity/time and attempt-specific identity/count. |
| `ReactionScheduler` | Installs a Reaction runner and returns a pass request function. |
| `RequestReactions` | Requests a pass and returns an idle-wait factory. |
| `WaitForReactionsIdle` | Waits until the requested Reaction work reaches idle. |

## Event Log lifecycle

The Command runtime calls:

```ts
await eventLog.transaction(async (transaction) => {
  const version = await transaction.currentVersion()
  const unread = await transaction.query(cursor, eventTypes)
  // Decide from caught-up State.
  return transaction.append(eventDrafts, { expectedVersion: version })
})
```

`transaction(...)` must cover catch-up, decision, idempotency lookup, and
append. It must serialize conflicting decisions or make the compare-and-swap
fail. `append(...)` requires at least one Event and atomically assigns unique
IDs, strictly increasing global orders, and ISO recorded times.

`query(afterOrder, eventTypes)` returns only matching Events with unique orders,
strictly ascending and greater than `afterOrder`. `findCommit(key)` returns the
durable receipt for an earlier idempotent append. The key lookup, fingerprint
comparison, and append must share the same atomic lock.

`duplicate: true` means no new Events were written. It is not a second commit.

## Slice Store lifecycle

`get(sliceName)` returns isolated staged State. Apply handlers receive
`store.write`; Command, Query, and Reaction handlers receive `store.read`.
Adapters may use the same runtime object for both, but the capabilities remain
separate in TypeScript.

After all unread Events apply successfully, core calls
`setLastAppliedOrder(order)`. Publishing the State and cursor must be locally
atomic or safely idempotent. Query work uses
`transaction(sliceName, run)` to group local projection changes. This local
transaction never makes Slice State part of the authoritative Event Log
transaction.

## Reaction scheduler lifecycle

```ts
const requestReactions = schedule(async (context) => {
  // Core runs eligible Reaction Slices for this pass.
})

const waitForIdle = requestReactions()
await waitForIdle()
```

Schedulers serialize passes. The bundled immediate scheduler queues every
request and runs each pass separately. A Reaction may request more work while a
pass is active; the scheduler must not start a nested pass or require that
Reaction to await itself.

`deliveryId` and `scheduledAt` identify the logical delivery and remain stable
across retries. `attemptId` changes per attempt and `attemptNumber` is one-based.
Reaction Plugins use the stable delivery ID for downstream idempotency.

## Constraints

- The Event Log is the source of truth. Slice Stores are rebuildable
  projections.
- Never expose partially applied State with an advanced cursor.
- Preserve Event payloads exactly; adapter serialization must round-trip them.
- Do not report an idempotent duplicate until the original receipt is durable.
- Keep request or database context alive for an entire subscription iterator
  lifecycle when adapters depend on scoped context.
- An immediate scheduler is not crash-safe; persistent apps need a durable
  scheduler such as the Reaction outbox.

## Related documentation

- [Persistence API](persistence.md)
- [Reaction outbox API](reaction-outbox.md)
- [Event Sourcing](../architecture/event-sourcing.md)
- [Runtime](../architecture/runtime.md)
- [API reference](README.md)
