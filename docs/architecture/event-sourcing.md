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
Event Log records it as a `PersistedEvent` with its storage metadata:

| Field | Owner | Meaning |
| --- | --- | --- |
| `type`, `payload` | Domain | The exact fact consumers replay |
| `id` | Host or Event Log | Unique identity for the stored Event: the host's when it [supplied one](#host-context-on-dispatch), else one the Event Log generates |
| `recordedAt` | Host or Event Log | ISO-8601 time the Event was recorded: the host's when it supplied one, else the Event Log's clock |
| `order` | Event Log | Unique global position used by cursors, never reused, even after a [purge](#purging-a-key) |
| `keys` | Core, stored by the Event Log | The [named keys](#event-keys) derived from the payload when it was appended |

Domain IDs and timestamps belong in the Command payload when they affect
the decision. Create them at the initiating boundary. A fold may read an
Event's `order` and `recordedAt` (see
[Event metadata in folds](#event-metadata-in-folds)), but a Command handler
never sees the Event it is about to emit, so neither can drive the decision
that records it.

### Event keys

Slices fold Event types, not aggregates, but most facts are about something
with an identity. An Event Definition may declare the named keys its Events
carry, each derived from the payload:

```ts
export const todoMovedEvent = createEventDefinition(
  'todo-moved',
  z.object({ todoId: z.string(), listId: z.string().optional() }),
  {
    keys: {
      todo: (payload) => payload.todoId,
      list: (payload) => payload.listId,
    },
  },
)
```

A key is an identity the fact is about, usually its aggregate's ID, named
for its kind: a fact about several things carries several keys (a child
Session's creation names its `session` and its `parent`). A key function
returns `undefined` for an Event that has no such identity. Names keep ID
spaces apart: a `todo` and a `list` with the same ID are two keys. An Event
whose type declares no keys is unkeyed. Key names use lower camel case.

Core derives an Event's keys when a Command emits it and passes them to the
Event Log with the Event, which stores and indexes them; adapters never
derive keys themselves, so the stored keys are exactly what the definition
derived from the payload that was appended. Every read returns an Event with
its stored keys (`PersistedEvent.keys`), and the stored keys are the only
ones used after the append: a Command's
[consistency keys](#command-consistency) are checked against them; a
[keyed Reaction](runtime.md#keyed-reactions) handles the values stored with
each Event; and a host's keyed read (`readKey({ name, value })`) pages
through one key's stored Events, such as one aggregate's. A definition whose
key functions change derives new keys for new Events only; Events appended
before keep the keys they were stored with, in the index and in every
Reaction's catch-up alike.

Two rules keep keyed decisions sound, and conformance checks both. A keyed
Command or Reaction applies only Event types that declare one of its key
names; and every Event of such a type, in a Scenario or emitted by a Command,
carries one of them. An Event without the key a Slice decides by could change
its State without the runtime knowing which key it concerns, so a Command
emitting one fails before it appends. A key a type declares may be absent from
an Event when no keyed Slice applying that type uses it, such as a Session's
optional `parent`.

## Host context on dispatch

A host often owns facts about an Event that are not the domain's: the ID its
own records derive from (a message named after the Event that created it),
the time its clock read when the request arrived, or what its own Event Log
needs in the append transaction. It supplies them per Event when it
dispatches the Command:

```ts
await app.command(envelope, {
  eventContext: (draft, index) => ({
    id: requestEventIds[index],
    recordedAt: new Date(receivedAt).toISOString(),
    metadata: { requestId },
  }),
})
```

Core calls `eventContext` after the decision, once per emitted Event, with
the Event's validated draft and its position in the commit, for every attempt
that appends (a stale append decides again, and the drafts may differ). It
hands the Event Log each draft with the context: the Event is stored under the
host's `id` and `recordedAt`, and the adapter receives `metadata`, which is
opaque to Specter. An Event without context takes the Event Log's ID and time.
The decision never sees the context, so a Command stays a function of its
input and its fold; the context only names and dates what the decision
emitted. An ID must be unique in the log, and a time an ISO-8601 UTC
timestamp; an invalid context fails the dispatch before it appends. The
bundled adapters store the ID and time and none of the metadata, which is for
a host's own Event Log (projections or hooks it runs in the append).

## Event metadata in folds

An apply handler receives the `PersistedEvent`: its typed payload, with its
`id`, `order`, `recordedAt` and stored `keys`. A fold may therefore read when
and in what order its facts were recorded, such as the time a Session went
idle, or which of two facts came first. Because the State is a fold of the
log, the same log replays to the same State; the time is the one recorded,
not the time of replay.

In a Scenario, Given Event N (one-based) has `order` N, is recorded N seconds
after the Unix epoch (`1970-01-01T00:00:0N.000Z`), has the ID
`scenario-event-N`, and carries the keys its definition derives from its
payload. A Scenario that compares times therefore writes them from the Given
Events' positions: the third Given Event was recorded at `3000` milliseconds.

## Catch-up, apply, and replay

Each Slice registers apply handlers for the Event types that build its private
State. Before a handler runs, core asks the Slice Store for its last applied
global order, queries the Event Log for later relevant Events, validates them,
and applies them in strictly ascending order. Advancing the State and cursor
must be locally atomic or safely idempotent. Core reads the log one page at a
time (`readPageSize` Events, 1000 by default), each read starting after the
last Event of the page before, so a first boot on a long log never holds
more than a page; a Reaction reads its commits the same way.

### State versions

A Store keeps a Slice's State under the Slice's version, which changes with
its specification digest and with the `stateVersion` the implementation
declares in `.store(Tag, { stateVersion })`. A State of another version is
never read: the Slice starts empty and folds the log, and its next commit
replaces the old State. So a State whose shape changed is rebuilt instead of
misread. Raise `stateVersion` when the State changes shape and the
specification does not (a refactor of the fold); a specification change
already changes the version. Snapshots of Slices that fold in memory are kept
under the same version and ignored the same way.

A Reaction's cursor is also how far it has delivered, and a new State does not
undo a delivery. Beside each Slice's State and cursor, the Store keeps under
the Slice's name alone the highest cursor it reached under any version
(`reached`). A Reaction of a new version starts its State empty, folds it up to
`reached` without running its handler or Plugin, and delivers only the
commits after: what it delivered under its old version is not delivered again,
and a commit after it is decided from the whole new fold. Pruned outbox jobs
therefore never run again because a Reaction's specification or `stateVersion`
changed. A Command or Query Slice of a new version folds the whole log, as
before.

For the Todo Query, replaying `todo-added`, `todo-completion-changed`, and
`todo-removed` reconstructs the list projection. Deleting that projection does
not delete Todos: replay restores it from the Event Log.

Event Log queries must return unique Events whose orders are strictly
ascending and greater than the supplied cursor. Core raises
`SpecterEventLogOrderError` when an adapter violates this contract.

## Command consistency

A Command decides from its private State, which is the fold of the Event
types it applies and nothing else. Its append is therefore stale only when an
Event it would have folded was appended after it read that State. Core appends
with a compare-and-swap scoped to exactly that (`expectedUnchanged` on the
Event Log): no Event of the types the Command applies may follow the order its
State was folded to. Writers of other types never conflict with it, and a
Command that applies nothing never conflicts. An adapter checks the condition
in its store, under its append lock, and rejects a stale append with
`SpecterVersionConflictError`. A stale append only means another writer
committed first, so core runs catch-up and the decision again (up to 32 times)
before surfacing the conflict.

Folds of the same types still conflict across aggregates: two Commands that
both apply `todo-renamed` conflict even for different Todos. A Command whose
decision reads only some aggregates' Events names their keys, each derived
from its input and, when the input does not name them, from the State it
decided from:

```ts
export const renameTodo = implementCommand(specification)
  .inputSchema(renameTodoSchema)
  .store(RenameTodoStore)
  .consistencyKeys({ todo: (command) => command.todoId })
  .apply(todoAddedEvent, applyTodoAdded)
  .apply(todoRenamedEvent, applyTodoRenamed)
  .handle(handleRenameTodo)
```

Its append then conflicts only with a new Event of an applied type that
carries one of those values under that name. A key function returns one
value, several, or `undefined` for none; a Command whose functions return no
value at all conflicts with nothing. The adapter checks the stored keys in
SQL (SQLite, Postgres) or in its own index (memory, JSONL). The
re-decision on a stale append is scoped the same way.

Keys are checked when the Command appends, after it decided, so they may come
from the State it read: removing a credential that is its integration's
active one reads that integration's other credentials, and the integration is
the credential's, in its State:

```ts
.consistencyKeys({
  credential: (command) => command.credentialId,
  integration: (command, state) => state.integrationOf[command.credentialId],
})
```

The Event that would change what the keys were read from must carry one of
them; here a credential's creation carries the credential.

Declaring keys is a promise the runtime cannot check while it runs: once the
Command has read its State, no Event carrying none of its keys may change its
decision. A Command that reads more, such as a parent's state, declares that
key too (`{ todo: (command) => [command.todoId, command.parentId] }`); one
whose decision reads its whole fold, such as a limit across every Todo,
declares no keys and keeps the type-scoped check. Without `consistencyKeys`
the scoped check is the safe default. A fold may still read another key's past
through an Event that carries the Command's key (a fork copying its parent's
state when it is recorded): later Events of the parent cannot change what was
copied.

Executable Scenarios check the promise. Each Scenario of a Command with
consistency keys also runs without its trailing Given Events that carry none
of its keys, the Events a concurrent writer could append after the decision
read its State without a conflict, and must reach the same outcome. A Scenario
that shows the decision depending on them fails with the keys it declared.

Callers can add two guards:

```ts
await app.command(
  { type: 'addTodo', payload: { todoId: 'todo-1', title: 'Ship it' } },
  { expectedVersion: 12, idempotencyKey: requestId },
)
```

- `expectedVersion` rejects a decision made against any other Event Log
  version: a whole-log compare-and-swap, which neither consistency keys nor
  the retry apply to.
- `idempotencyKey` stores a durable receipt with a fingerprint of the
  Command envelope. Repeating the key returns the first commit with
  `duplicate: true`, even for different input. With
  `idempotencyMode: 'exact'`, reusing the key for different input raises
  `SpecterIdempotencyConflictError`.

The idempotency lookup and append must share the adapter's atomic append lock.
Adapters return the stored commit for a known key and never decide conflicts;
the runtime applies the mode.

An adapter declares what it supports beyond appending and reading the log,
`capabilities: { scopedAppend, keyedRead, purge }`, and refuses an operation
it does not support rather than ignore part of it. The runtime refuses to
start, with `SpecterEventLogCapabilityError`, on an Event Log without scoped
appends when the app has a Command, and without keyed reads or purges when the
host says it uses them
(`makeSpecterRuntime(config, { requires: { keyedRead: true, purge: true } })`).

## Purging a key

The log is append-only, but retention is not optional: the facts of an
aggregate the domain deleted, such as a deleted Session's messages and tool
output, should not stay forever. A host purges them by key:

```ts
yield* eventLog.purge(
  { name: 'session', value: sessionId },
  { keep: ['session-deleted'] },
)
```

A purge removes every Event that carries the key (its stored key
`session` is `sessionId`), except Events of the types `keep` names: the
tombstones the folds need to know the key is gone, such as its deletion,
which a Command reads to refuse the ID again. It runs atomically, under the
same lock as an append, and leaves the log consistent:

- **Orders are never reused.** The log's version does not move back, even when
  the purge removed its latest Events, and the next append takes orders above
  every order the log ever assigned. Cursors, `deliveryId`s and outbox jobs
  keep naming what they named.
- **Commits.** A commit keeps its version, time, idempotency key, fingerprint
  and the Events it has left; a commit left with none is removed with its
  idempotency receipt, so a Command retried under that key decides again,
  against the State its tombstones give.
- **Keys.** The keys stored with a removed Event go with it.
- **Compare-and-swap.** A purge is not a conflict: a decision that read the
  removed Events appends as before, and `expectedVersion` sees the same
  version. Nor does a purge hide one: when it removes an Event that was
  appended after a decision read the log, of a type the decision applies, the
  decision's scoped append is stale, whatever the Event's keys were, and core
  decides again.
- **Slices and Reactions keep their cursors, State and snapshots.** Nothing is
  rebuilt or delivered again.

What the purge guarantees about State is a property of the folds:

> A Slice is *purge-safe* for a key when, once it has folded the key's kept
> Events, its State no longer depends on the key's other Events. Folding the
> log after a purge, a purge-safe Slice reaches the same State as before for
> every key but the purged one, whose State is what its tombstones give.

So a Slice that keeps anything about an aggregate folds its tombstone and
forgets the aggregate, keeping only what a rule still needs (that the ID was
deleted). Its State before the purge, its snapshot, and a fold of the purged
log from the start are then the same State, which a test can check: fold the
log, purge, fold again from nothing, compare. A purge before the tombstone is
recorded, or a Slice that keeps a purged aggregate's data, breaks the
equivalence, and a Command that records a fact about the key after its
tombstone leaves a fact the purge did not see; the tombstone should make the
key's Commands refuse.

A host whose Event Log keeps rows of its own that refer to Events (an index of
the log by order) removes them in the same transaction: the SQLite Event Log
runs `onPurge` inside the purge, before it deletes, with the orders it
removes. An adapter declares `capabilities.purge`; a host that purges requires
it (`requires: { purge: true }`).

## Determinism and schema evolution

Create domain IDs, timestamps, and random values before dispatch, then preserve
them one-to-one in Event payloads. Event schemas may validate payloads but must
not transform them: replay must see the exact values the Command emitted. The
host's per-Event context (an ID, a time) is recorded with the Event after the
decision, so a later fold reads it from the log like any other fact.

Changing an Event payload changes every producer, Scenario example, and apply
consumer. Before a change, run `analyzeEventPropagation(...)` and
`formatEventPropagation(...)` from `@specter-ts/core/testing`. Persistent
changes also need restart, replay, cursor-failure, and Reaction-retry coverage.

## Invariants and pitfalls

- Never mutate or remove historical Events to repair a projection. A purge
  removes a deleted key's Events for retention, keeping its tombstones, and
  only purge-safe folds stay equivalent across it.
- Never make Slice State authoritative. Shared SQL transaction may atomically
  join Reaction cursor, nested Command append, or outbox enqueue for delivery.
- Never generate domain identity or time inside a Command handler or Reaction
  retry. Supply an Event's ID and recorded time as dispatch context instead.
- Do not advance a cursor past partially applied State.
- Keep payloads JSON-compatible when Events use the bundled persistent
  adapters or cross a JSON transport.
- Reaction commit retry is at least once; use stable delivery ID downstream.
  Only commits with an Event type the Reaction applies are delivered; a
  Reaction cursor may lag behind skipped irrelevant commits.
  Use outbox wrapper for slow work, leases, dead-letter, and replay.

## Related documentation

- [Introduction](../introduction.md)
- [CQRS](cqrs.md)
- [Runtime](runtime.md)
- [Core adapters API](../api-reference/core-adapters.md)
- [Persistence API](../api-reference/persistence.md)
- [Conformance](../specifications/conformance.md)
- [Documentation](../README.md)
