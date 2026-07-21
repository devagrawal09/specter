# Event Sourcing in Specter

The Event Log is the durable source of truth in a Specter App. Accepted
Commands append Events that describe exact domain facts. Slice State is a
disposable projection derived by replaying those Events; it is never a second
source of truth.

## Events and Event Log metadata

An Event Definition owns a kebab-case type and a Standard Schema for its domain
payload:

```ts
export const todoAddedEvent = createEventDefinition(
  'todo-added',
  z.object({ todoId: z.string(), title: z.string() }),
)
```

The Command creates an `EventDraft` containing only `type` and `payload`. The
Event Log adds the storage metadata:

| Field | Owner | Meaning |
| --- | --- | --- |
| `type`, `payload` | Domain | The exact fact consumers replay |
| `id` | Event Log | Unique identity for the stored Event |
| `order` | Event Log | Unique global position used by cursors |
| `recordedAt` | Event Log | ISO timestamp for persistence metadata |

Domain IDs and timestamps belong in the Command payload when they affect
behavior. Create them at the initiating boundary. Do not treat Event Log IDs or
`recordedAt` as domain values.

## Catch-up, apply, and replay

Each Slice registers apply handlers for the Event types that build its private
State. Before a handler runs, core asks the Slice Store for its last applied
global order, queries the Event Log for later relevant Events, validates them,
and applies them in strictly ascending order. Advancing the State and cursor
must be locally atomic or safely idempotent.

For the Todo Query, replaying `todo-added`, `todo-completion-changed`, and
`todo-removed` reconstructs the list projection. Deleting that projection does
not delete Todos: replay restores it from the Event Log.

Event Log queries must return unique Events whose orders are strictly
ascending and greater than the supplied cursor. Core raises
`SpecterEventLogOrderError` when an adapter violates this contract.

## Command consistency

Command catch-up, decision, and append run inside one Event Log transaction.
Core reads the current version and always appends with compare-and-swap against
that same version. An adapter must serialize conflicting decisions or reject a
stale append with `SpecterVersionConflictError`.

Callers can add two guards:

```ts
await app.command(
  { type: 'addTodo', payload: { todoId: 'todo-1', title: 'Ship it' } },
  { expectedVersion: 12, idempotencyKey: requestId },
)
```

- `expectedVersion` rejects a decision made against any other Event Log
  version.
- `idempotencyKey` stores a durable receipt bound to a fingerprint of the
  Command envelope. Repeating the same Command returns the original commit with
  `duplicate: true`; reusing the key for different input raises
  `SpecterIdempotencyConflictError`.

The idempotency lookup and append must share the adapter's atomic append lock.

## Determinism and schema evolution

Create domain IDs, timestamps, and random values before dispatch, then preserve
them one-to-one in Event payloads. Event schemas may validate payloads but must
not transform them: replay must see the exact values the Command emitted.

Changing an Event payload changes every producer, Scenario example, and apply
consumer. Before a change, run `analyzeEventPropagation(...)` and
`formatEventPropagation(...)` from `@specter-ts/core/testing`. Persistent
changes also need restart, replay, cursor-failure, and Reaction-retry coverage.

## Invariants and pitfalls

- Never mutate or remove historical Events to repair a projection.
- Never make Slice State authoritative or enlist it in the Event Log Command
  transaction.
- Never generate domain identity or time inside a Command handler or Reaction
  retry.
- Do not advance a cursor past partially applied State.
- Keep payloads JSON-compatible when Events use the bundled persistent
  adapters or cross a JSON transport.
- With a durable scheduler or outbox, Reaction delivery is at least once; use
  its stable delivery ID as the downstream idempotency key. The immediate
  scheduler is process-local and can lose pending work on a crash.

## Related documentation

- [Introduction](../introduction.md)
- [CQRS](cqrs.md)
- [Runtime](runtime.md)
- [Core adapters API](../api-reference/core-adapters.md)
- [Persistence API](../api-reference/persistence.md)
- [Conformance](../specifications/conformance.md)
- [Documentation](../README.md)
