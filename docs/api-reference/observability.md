# Observability API

**Import:** `@specter-ts/observability`

**Status:** `0.4.0` main-branch preview; the published npm release remains `0.2.1`.

## Purpose

Observability is deliberately best effort. A sink failure must not reject a
successful Command, alter an Event commit, stop projection catch-up, or change
Reaction semantics. Signals are operational metadata; do not put domain
secrets in their fields.

## Values

| Export | Purpose |
| --- | --- |
| `noopSpecterObservability` | Sink that discards all signals. |
| `createCompositeSpecterObservability(...sinks)` | Fans each signal out to several sinks. |
| `createInMemorySpecterObservability(options?)` | Records sequenced, timestamped signals with snapshot/subscription controls. |
| `createSpecterObserver(sink)` | Maps core `SpecterObservation` callbacks to operational signals. |
| `instrumentEventLog(eventLog, sink)` | Decorates append operations to report newly persisted Events. |
| `reportSliceCursor(sink, input)` | Reports a projector cursor and calculated Event Log lag. |
| `reportSubscriptionInvalidated(sink, input)` | Reports one Query subscription invalidation. |
| `reportReactionRun(sink, input)` | Reports named or aggregate Reaction lifecycle. |
| `reportProjectionActivity(sink, input)` | Reports catch-up or replay start/completion/failure. |
| `createOutboxObservabilityListener(sink)` | Maps durable outbox transitions to attempt signals. |
| `createSpecterDevelopmentPanel(source, options?)` | Aggregates the in-memory collector into typed snapshots and JSON/text/HTML renderers. |

## Sink and panel types

| Export | Purpose |
| --- | --- |
| `SpecterObservabilitySink` | A `record(signal)` destination; may be synchronous or async. |
| `SpecterObservabilityListener` | Callback for one recorded, sequenced signal. |
| `InMemorySpecterObservability` | Sink with `snapshot`, `subscribe`, and `clear`. |
| `SpecterDevelopmentPanelOptions` | Maximum retained Events and activity rows in rendered snapshots. |
| `SpecterDevelopmentPanel` | `snapshot`, `subscribe`, `renderJson`, `renderText`, and `renderHtml`. |
| `SpecterDevelopmentSnapshot` | Aggregated Events, version, cursors, subscriptions, Reactions, outbox attempts, and projections. |
| `SpecterSubscriptionSummary` | Per-Query invalidation count and latest metadata. |

## Signal types

| Export | Purpose |
| --- | --- |
| `EventsPersistedSignal` | Newly persisted Events, Event Log version, and optional idempotency key. |
| `CommandCommittedSignal` | Command name, version, Event count, and duplicate status. |
| `SliceCursorSignal` | Slice cursor, Event Log version, and calculated lag. |
| `SubscriptionInvalidatedSignal` | Query type plus optional subscriber and reason. |
| `ReactionRunSignal` | Reaction name, lifecycle outcome, duration, and error summary. |
| `OutboxAttemptSignal` | Job/attempt identity, attempt number, timing, outcome, and error. |
| `ProjectionActivitySignal` | Catch-up/replay lifecycle and its order range, count, duration, and error. |
| `SpecterOperationalSignal` | Union of every operational signal. |
| `RecordedSpecterOperationalSignal` | Operational signal plus collector sequence and observed time. |
| `ReactionRunOutcome` | `'started' | 'completed' | 'failed'`. |
| `ProjectionActivity` | `'catch-up' | 'replay'`. |
| `ProjectionOutcome` | `'started' | 'completed' | 'failed'`. |

## Wire the automatic signals

```ts
import { createSpecterApp } from '@specter-ts/core'
import {
  createInMemorySpecterObservability,
  createSpecterDevelopmentPanel,
  createSpecterObserver,
  instrumentEventLog,
} from '@specter-ts/observability'

const observability = createInMemorySpecterObservability()
const panel = createSpecterDevelopmentPanel(observability)

const app = await createSpecterApp({
  events: todoEvents,
  eventLog: instrumentEventLog(persistence.eventLog, observability),
  schedule,
  slices: todoSlices,
  observe: createSpecterObserver(observability),
})

console.log(panel.renderText())
```

`instrumentEventLog(...)` reports non-duplicate Event appends.
`createSpecterObserver(...)` reports Command commits, core catch-up completion,
subscription invalidation, and named Reaction lifecycle. The panel aggregates
those signals without becoming an authoritative store.

## Report project-owned work

Core cannot see replay jobs, external projectors, or transport-specific
subscription IDs. Report those boundaries explicitly:

```ts
await reportProjectionActivity(observability, {
  sliceName: 'todosQuery',
  activity: 'replay',
  outcome: 'started',
  fromOrder: 0,
})

await reportSliceCursor(observability, {
  sliceName: 'searchIndex',
  lastAppliedOrder: 41,
  eventLogVersion: 43,
})
```

Bracket project-owned replay with started and completed/failed
`reportProjectionActivity(...)` calls. External projectors should report their
cursor after durable progress. Pass `createOutboxObservabilityListener(sink)`
as the Reaction outbox worker or scheduler transition listener to capture
attempts, retries, and dead letters.

## Constraints

- Treat sinks as fallible and isolate them at custom integration boundaries.
  The bundled core observer and Event Log instrumentation already swallow sink
  failures.
- Operational signals are not an Event Log, audit trail, or Command receipt.
- The in-memory collector and development panel are process-local diagnostics,
  not production retention.
- Bound Event and activity counts with panel options and redact sensitive
  payloads before they reach a sink.
- Report replay explicitly; normal core catch-up is reported automatically.

## Related documentation

- [Runtime](../architecture/runtime.md)
- [Reaction outbox API](reaction-outbox.md)
- [Core runtime API](core-runtime.md)
- [Core adapters API](core-adapters.md)
- [API reference](README.md)
