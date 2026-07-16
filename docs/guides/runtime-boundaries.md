# Runtime and transport boundaries

Specter core runs domain behavior in process. It does not infer network routes
or serialize arbitrary TypeScript values. A generated project owns the boundary
between its Specter App and a remote UI.

## Command completion

`app.command(envelope)` resolves only after the Event Log has committed the
accepted Command's Events. The returned execution has a separate
`reactions: Promise<void>`:

```ts
const execution = await app.command(
  {
    type: 'authorizePayment',
    payload: {
      paymentId: crypto.randomUUID(),
      authorizedAt: new Date().toISOString(),
    },
  },
  {
    idempotencyKey: submissionId,
    expectedVersion: loadedVersion,
  },
)

// The Command is already committed here.
await execution.reactions
```

A Reaction failure does not roll back the Command. Never retry it without an
idempotency key merely because `execution.reactions` rejects. Resubmitting the
same Command with the same idempotency key returns the original commit and a
new or coalesced Reaction-drain Promise, so catch-up can be retried safely even
after restart. Durable schedulers may also expose explicit retry operations.
Use `expectedVersion` when the caller requires a particular Event Log version.

Reaction Plugin delivery context is retry-aware. `deliveryId` and
`scheduledAt` are stable for the logical delivery; `attemptId` and
`attemptNumber` identify one try. Use the delivery ID for an external
idempotency key and the scheduled time for a domain timestamp that must not
change on retry. Add deterministic suffixes when one effect dispatches several
Commands.

## Event Log and Slice State

The Event Log transaction is the only authoritative Command transaction. It
covers Command projection catch-up, decision, and append. Core always appends
with compare-and-swap against the Event Log version used for the decision;
caller `expectedVersion` is validated against that same version. Adapters
serialize conflicting transactions or reject the stale compare-and-swap.

Atomic append returns `EventLogAppendResult`: the durable Events, version,
optional idempotency receipt metadata, and `duplicate`. `duplicate: true` means
the adapter found the existing receipt under its append lock and wrote no new
Events. `findCommit()` returns the durable `EventLogCommit` without attempt
metadata.

Slice State is a disposable projection. Its adapter must make applying Events
and advancing the Slice cursor locally atomic, or make the operation safely
idempotent. It is deliberately not enlisted in the Event Log transaction.
Replay repairs a projection from durable Events.

Event Log queries return Events with unique, strictly ascending global orders,
all greater than the requested cursor. Core rejects adapter results that break
that contract.

## Subscription lifecycle

`app.subscribe(queryEnvelope, { signal })` is a latest-state stream, not an
Event history. Each subscriber receives an initial query result and then its
own invalidations. A slow subscriber may skip intermediate values but retains
the newest result. `undefined` remains a valid in-process result.

Creating or starting the async iterator can perform projection work. An HTTP or
SSE adapter that uses request-scoped database context must keep that context
available for iterator activation, every `next()`, cancellation, and cleanup.
Always pass an `AbortSignal` from the remote connection and call `return()` when
it closes.

## JSON transport

The starter's HTTP/SSE transport accepts JSON-compatible values only. Use ISO
strings for dates. Reject `undefined`, `bigint`, non-finite numbers, functions,
symbols, cyclic objects, `Map`, `Set`, and class instances before they cross the
wire. Core can still accept richer in-process values when application schemas
permit them.

The server dispatches only the three envelope operations and lets core's
registered Command and Query maps reject unknown types. It never performs a
property lookup from an untrusted method name. Stable Specter error codes cross
the boundary; unexpected internal failures become a generic infrastructure
error.

The browser transport preserves two-stage Command completion: its outer Promise
settles from the committed response and its nested Reaction Promise observes a
separate completion endpoint. Query subscriptions use abortable,
reconnect-capable SSE.

## Schema modes

The schema-builder overloads have intentionally different guarantees:

| Form | TypeScript types | Runtime validation and transformation | Appropriate use |
| --- | --- | --- | --- |
| `.inputSchema<MyInput>()` | yes | no | trusted in-process input |
| `.inputSchema(schema)` | inferred | yes | HTTP, RPC, queue, webhook, or other untrusted input |
| `.outputSchema<MyOutput>()` | yes | no | trusted internal output |
| `.outputSchema(schema)` | inferred | yes | public query or Reaction Plugin boundary |

Static-only schemas cannot catch malformed runtime data. Exact Scenarios still
test examples, but they are not a replacement for a runtime schema at an
untrusted boundary.

## Focused and whole-app tests

Use the focused Event catalog helper for a single Slice implementation. It
selects the Event Definitions referenced by that Slice's Scenarios and apply
handlers. Use the full catalog when testing all implementations together. A
whole-app catalog passed to a strict single-Slice conformance check contains
unrelated Events by definition; diagnostics point to the focused helper and the
affected Scenarios or apply handlers.

For payload evolution, `analyzeEventPropagation(...)` and
`formatEventPropagation(...)` from `@specter-ts/core/testing` enumerate every
Command producer, Scenario Given/outcome example, and apply consumer of an
Event Definition before code changes begin.

Generated Slice and projection scaffolds materialize independent private State
rather than introducing shared mutable projections. `spec.ts` and `impl.ts`
remain the only required Slice files and use named exports. Event catalogs,
projection modules, registries, tests, schema exports, and migration notes are
optional generated support files. Generated persistent harnesses include Event
Log, Slice Store, durable scheduler, replay, reset, wired failure injection,
migration, and executable recovery tests.

## Operational presets

- The memory adapter is deterministic and intended for tests and local tools.
- The SQLite adapter is the default single-process persistent preset.
- The Postgres adapter supports multi-process persistence and database-level
  serialization; its service-backed integration suite verifies advisory locks,
  rollback, JSONB payloads, atomic outbox claims, retries, dead letters, and
  replay in CI.
- The immediate scheduler is deterministic but not crash-safe.
- The durable outbox scheduler persists attempts, uses stable attempt IDs,
  retries with bounded backoff, and exposes dead-letter inspection and retry.

Attach the observability collector and development panel during development.
`instrumentEventLog(...)` plus `createSpecterObserver(...)` automatically
populate Event commits, catch-up-derived projection cursor lag, subscription
invalidations, and named Reaction start/completion/failure. Pass
`createOutboxObservabilityListener(...)` as the durable scheduler's
`onTransition` listener to populate outbox attempts. Project-owned replay code
must bracket replay with `reportProjectionActivity(...)`; external projectors
can report their cursor with `reportSliceCursor(...)`. The panel exposes a typed
`snapshot()` and concrete `renderJson()`, `renderText()`, and `renderHtml()`
renderers. Do not put domain secrets in observability attributes.

## Browser-test preflight

Generated projects separate Vitest and Playwright globs, use a strict fixed
five-digit port, and include `pnpm test:e2e:preflight`. Run the preflight before
browser tests so the installed Playwright package and browser revision are
verified explicitly rather than failing midway through a workflow. Release
verification runs the generated project's actual Playwright workflow after the
preflight; a passing preflight alone is not an end-to-end result.
