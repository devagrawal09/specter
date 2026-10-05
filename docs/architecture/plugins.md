# Plugins

Plugin interprets one Reaction output. Same-app Command output needs no explicit
Plugin; Specter dispatches it with stable delivery ID. External or custom output
uses `.plugin(...)`.

## Execution

```ts
type ReactionPlugin<TOutput, R = never> = (
  context: ReactionPluginContext,
) => Effect<ReactionExec<TOutput>, unknown, R | Scope>

type ReactionPluginContext = {
  command: CommandDispatch // resolves to CommandReceipt
  query: QueryDispatch // query(querySlice, input) -> decoded Query output
}

type CommandReceipt = {
  events: readonly PersistedEvent[]
  version: number
  duplicate: boolean // idempotency key matched an earlier commit
}

type ReactionExec<TOutput> = (
  output: TOutput,
  context: ReactionDeliveryContext,
) => Effect<void, unknown>
```

Core initializes and caches executor during app construction, inside the app
scope. For each Event Log commit containing an Event type the Reaction applies,
Reaction Store transaction applies Events, runs handler, validates output,
executes Plugin, then advances cursor. Failure rolls back State and cursor.
Other commits run no handler or Plugin and open no transaction.

```ts
const agentTurnPlugin: ReactionPlugin<AgentTurn, AgentModel> = ({
  command,
  query,
}) =>
  Effect.gen(function* () {
    const model = yield* AgentModel
    return (turn, delivery) =>
      Effect.gen(function* () {
        const thread = yield* query(threadQuery, { threadId: turn.threadId })
        const reply = yield* model.reply(thread)
        const receipt = yield* command(
          { type: 'recordAgentReply', payload: { ...turn, reply } },
          { idempotencyKey: delivery.deliveryId },
        )
        yield* Effect.annotateCurrentSpan('agent.duplicate', receipt.duplicate)
      })
  })

.plugin(withReactionOutbox(agentTurnPlugin, { store }))
```

`command` returns the commit receipt. It does not wait for nested Reactions;
joining them from inside a Reaction transaction could wait on itself. Both
capabilities fail with `SpecterEffectError`.

Inside a direct Plugin, the nested append joins the Reaction's transaction on
shared SQLite/Postgres contexts, so the receipt is not final until the Reaction
commits; a later failure rolls the append back with the cursor. Do not trigger
external side effects on `!receipt.duplicate` from a direct Plugin. Outboxed
Plugins receive receipts for already committed appends.

`query` takes the registered Query Slice value for its name and types and runs
that Query in the same app; a different Slice value with the same name fails.
Result reflects Event Log head when called, not the Reaction's commit.

## Service requirements

`R` lists Effect services the Plugin factory reads. `.plugin(...)` infers it,
and an annotated `ReactionPlugin<TOutput>` defaults to `never`, so reading an
undeclared service fails to compile. `SpecterRuntimeRequirements<TConfig>`
includes every registered Plugin's `R`; `createSpecterApp(config, layer)` and
`createSpecterAppLayer(config)` therefore reject a Layer missing a Plugin
service. `Scope` is always available and never an app requirement.

Plugin `R` is tracked through literal Slice types. A config widened to
`SpecterAppConfig`, or a Plugin typed with `R = unknown` or cast to `any`, loses
it; an erased requirement counts as `never` instead of rejecting every Layer. `ReactionExec` takes no
services; capture them in the factory.

## Queries and transactions

Direct Plugin runs inside its Reaction's Slice Store transaction. A Query
catches up its own Slice in a separate Store transaction:

- Memory: per-Slice semaphores; nesting would be safe.
- SQLite with shared persistence context: joins outer write transaction on the
  same connection. Separate contexts would contend for the database write lock
  held by the outer transaction until `busy_timeout` fails.
- Postgres with shared context: joins outer connection, but holds the Query
  Slice advisory lock until the Reaction commits; opposite lock orders across
  Reactions deadlock and abort. Separate contexts take a second pool
  connection and can exhaust the pool.

Core therefore rejects `query` while a direct Plugin executes inside its
Reaction transaction with `SpecterPluginQueryInTransactionError`
(`SPECTER_PLUGIN_QUERY_IN_TRANSACTION`). Retrying cannot help, so it is a
permanent failure: `ReactionRunFailure.permanent` is `true`, State and cursor
roll back, and the cursor stays on that commit until the Plugin changes.
`execution.reactions` for that and every later commit rejects, and app startup
(`createSpecterApp` itself, or the first operation of a
`createSpecterPromiseApp` app) fails while the commit is pending. The
SQLite scheduler stops retrying the boundary, records the error, and fails its
waiters with `ReactionSchedulerFailure` instead of polling; rescheduling the
boundary (for example on restart after a fix) runs it again.

Fibers forked from the executor inherit this guard. Escaping with
`Effect.runPromise` or `Effect.runFork` inside a direct Plugin bypasses it, and
on SQLite a Query run that way waits for the database permit the Reaction
transaction already holds, deadlocking in-process. Run Queries from a Plugin
wrapped with `withReactionOutbox`: its worker executes outside any Slice
transaction. The factory itself may query during startup.

`command` stays available to direct Plugins and joins the active transaction on
shared SQLite/Postgres contexts. It carries the same Postgres hazard as
`query` (a nested Command holds its Slice lock and the Event Log append lock
until the Reaction commits), but same-app Command dispatch is the default
Plugin's whole job and an atomic append-with-cursor is valuable. Lock-order
deadlocks across direct Plugins dispatching Commands remain a known risk;
Postgres detects and aborts them and the Reaction retries. Prefer the outbox
for Plugins that dispatch several Commands.

## Default Command Plugin

Without `.plugin`, handler output must be Command envelope:

```ts
.outputSchema(createTodoCheerCommandSchema)
.store(TodoCheerStore)
```

Default Plugin dispatches Command with `deliveryId` as idempotency key. A
redelivery that produces different output (for example a re-streamed LLM
response) returns the first committed Command as a duplicate, because the first
commit for a key wins by default. It waits
for nested Command commit, not nested Reactions. Shared SQLite/Postgres context
joins nested command work to active Reaction transaction.

## Delivery identity

`ReactionDeliveryContext` contains:

| Field | Meaning |
| --- | --- |
| `deliveryId` | Stable `reactionName:commitVersion`; use for idempotency. |
| `throughOrder` | Relevant Event Log commit version being processed. |
| `scheduledAt` | Durable Event Log commit timestamp. |

Core has no attempt IDs. Attempt metadata belongs to optional outbox worker.

## Direct or outboxed

Direct Plugin runs inside Slice Store transaction. Use it for fast, idempotent
same-app work or local capabilities.

Slow remote work, or work that runs Queries, should use maintained wrapper:

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
