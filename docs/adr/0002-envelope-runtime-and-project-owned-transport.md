# Envelope runtime and project-owned transport

Date: 2026-07-16

Status: Accepted

## Context

Specter 0.2 exposed Commands and Queries as flat properties synthesized from
Slice names. The same shape was mirrored by a Proxy-based `SpecterClient` in
core. Multi-application evaluation and direct regression tests showed that the
flat namespace collides with Promise and object properties, browser transport
cannot preserve the unrestricted TypeScript contract, and core subscription
delivery conflates shared projection cursors with per-subscriber state.

The Event Log remains the durable source of truth. Slice State is a disposable
projection used for decisions, queries, and reaction preparation.

## Decision

### Runtime API

`createSpecterApp` exposes three typed envelope operations:

```ts
const execution = await app.command({
  type: 'addTodo',
  payload: { todoId: 'todo-1', title: 'Ship it' },
})

const todos = await app.query({ type: 'todosQuery', payload: {} })

for await (const value of app.subscribe({
  type: 'todosQuery',
  payload: {},
})) {
  // latest query state
}

await execution.reactions
```

Core no longer exports or implements `SpecterClient`. Slice names use lower
camel case and core stores registrations in `Map` instances rather than object
property namespaces.

### Command and Reaction completion

A Command call resolves after its Events are durably committed. Its result
contains a `reactions` Promise. That nested Promise settles after every
independent Reaction has been attempted and rejects with one aggregate failure
when any Reaction fails. A Reaction failure never changes an already committed
Command into a rejected Command.

An idempotent duplicate returns the original durable Events and version with
`duplicate: true`. Its `reactions` Promise requests (or coalesces with) a fresh
Reaction drain instead of assuming earlier delivery succeeded. Consequently a
caller can resubmit the same idempotency key after a settled Reaction failure,
including after process restart, and observe the catch-up failure or success.
Already advanced Reaction cursors prevent successful effects from running
again.

Reaction effects remain arbitrary plugin-defined values. Dispatching a
follow-up Command is one explicit Reaction Plugin, not the universal Reaction
output shape.

Each delivery exposes a stable `deliveryId` and ISO `scheduledAt` across
retries, plus attempt-specific `attemptId` and `attemptNumber`. Plugins use the
delivery values for downstream idempotency and retry-stable IDs/timestamps.
Same-app follow-up Commands pass the delivery ID (plus deterministic suffixes
when one effect dispatches several Commands) as their idempotency key.

### Transactions and projections

The Event Log transaction owns Command catch-up, decision, and append. Every
append uses compare-and-swap against the exact Event Log version that the
Command decision observed, even when the caller omitted `expectedVersion`.
Caller-supplied `expectedVersion` is an additional precondition on that
observed version. Slice State is not enlisted in the transaction. Applying
Events to Slice State and advancing its cursor must be locally atomic or safely
idempotent so failed projection work can be repaired by replay. First-party
stores stage `get()` State and publish State plus cursor only from
`setLastAppliedOrder()`; adapters that expose live database capabilities make
every apply handler idempotent.

`EventLogTransaction.append()` returns `EventLogAppendResult`, which extends
the durable `EventLogCommit` receipt with `duplicate: boolean`. Adapters set it
to `true` when an idempotency receipt is discovered inside the atomic append
boundary and no new Events were written. Core preserves that result; it must
not reinterpret an atomic duplicate as a new commit.

`EventLogAdapter.query(afterOrder, eventTypes)` returns unique Events in strict
ascending global order with every order greater than `afterOrder`. Core rejects
adapter results that violate this contract.

Adapters expose distinct read and write capabilities at the type level. They
may point to the same runtime object; core does not require separate allocation
or runtime proxies.

### Query subscriptions

Subscriptions are latest-state streams. They emit the current value, fan out
independently to every subscriber, coalesce intermediate results for slow
subscribers, retain the newest value, support legitimate `undefined`, honor
pre-aborted signals, and cleanly close pending iterators. Project transports
must make the subscription activation and adapter-context lifetime explicit.

### Specifications and schemas

Query and Reaction Scenario `expect` values describe the final public value
after output-schema transformation. Implementations transform actual handler
output once and compare it directly with the Scenario expectation.

Specter guarantees structural immutability for specification wrappers and
arrays. It does not clone or deep-freeze caller-owned payload values.

### Transport and language-neutral protocol

Core remains transport-agnostic. Generated projects may own their HTTP, SSE,
WebSocket, or other adapters. The canonical generated HTTP/SSE transport accepts only
JSON-compatible public Command payloads and Query outputs, allowlists registered
operations, and maps structured Specter errors without exposing internal error
details.

Specter additionally publishes `@specter-ts/protocol`: a versioned,
language-neutral description of observable runtime behavior plus a reference
JSON HTTP/SSE binding. It standardizes capability negotiation, Command and
Query envelopes, subscriptions, Reaction-completion tickets, structured
errors, and runtime-observation batches. It does not move application Slice
definitions, handlers, schemas, or persistence layouts across languages.

Protocol implementations require matching major versions, negotiate named
capabilities, tolerate unknown optional fields, and reject unsupported required
capabilities. TypeScript and Go conform independently against the same golden
fixtures; neither implementation shares application storage with the other.

Remote UIs use a project-owned transport. Entirely in-process or in-browser
runtimes, including ColonyBench, may call the envelope API directly.

Domain IDs and domain timestamps originate at the initiating boundary and are
explicit Command payload fields. Event IDs, global order, and recorded time are
Event Log metadata owned by the persistence adapter.

### Package boundaries

- `@specter-ts/core` exports runtime creation, Event Definitions, envelope and
  reference types, adapters, and structured errors.
- `@specter-ts/core/spec` exports specification builders and `event()`.
- `@specter-ts/core/testing` exports Scenario test utilities.
- `@specter-ts/protocol` exports v1 types, validation, capability negotiation,
  and the reference HTTP/SSE client/server binding.
- `@specter-ts/core/client` is removed.

The root Specter Agent Skill is the canonical source. Generated copies are
mechanically synchronized, and app-specific exceptions live in `AGENTS.md`.

## Consequences

This is a breaking 0.3.0 change. Existing flat app calls and
`defineSpecterClient` consumers require migration. The repository ships a
deterministic codemod and migrates every reference application and starter.

Generated projects own more visible transport code, but that code is explicit,
inspectable, replaceable, and constrained to its actual wire format. Core has a
smaller and more coherent responsibility: domain execution, conformance,
projection catch-up, and subscription semantics.
