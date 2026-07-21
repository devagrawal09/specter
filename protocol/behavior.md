# Protocol v1 behavior

## Capabilities and compatibility

A client sends required and optional named capabilities. A server MUST fail the
request with `SPECTER_UNSUPPORTED_CAPABILITY` when any required capability is
missing. The response's `negotiated` list contains supported requested
capabilities. Capability arrays contain unique names. Version mismatch is
`SPECTER_PROTOCOL_VERSION_MISMATCH` and SHOULD use HTTP 426 in the reference
binding.

The v1 capability names are `commands`, `queries`, `query-subscriptions`,
`reaction-tickets`, and `runtime-observations`. An implementation MAY publish
additional names. Go v1 implementations without durable reactions or database
adapters advertise no capability for those features.

## Commands and Events

`operationId` identifies one runtime operation; `correlationId` groups work
across boundaries. `idempotencyKey` is stable across retries. Repeating a
successfully committed Command with the same key MUST return `duplicate` and
the original commit version and Event references without deciding or appending
again. `expectedVersion`, when present, is checked atomically with the decision
and append.

A committed response contains Event metadata in strict ascending local order.
It MUST NOT contain domain Event payloads. A rejected Command contains no new
Events and returns a public structured error. Internal failures use a structured
error and MUST NOT expose private exception details.

Command completion means the commit is durable. A `reactionTicketId` tracks
separate Reaction completion. Ticket identity and downstream delivery identity
remain stable across retries; attempt identity may change. Expired or unknown
tickets produce a public not-found error.

## Queries and subscriptions

A Query returns one JSON-compatible public value or a structured error.
Subscriptions first emit current state, then newer values. A slow consumer MAY
receive coalesced changes but MUST eventually receive the newest value. Sequence
numbers are strictly increasing within a subscription and every emitted value
MUST be greater than `afterSequence` when it is present. `afterSequence` allows a
binding to resume when supported.

Cancellation MUST stop iteration and release request/database context. An SSE
stream ends with `subscription.complete`; runtime failures are emitted as
`subscription.error` before closure.

## Causality and observations

An observation carries source identity, a source-local sequence, operation and
optional correlation IDs, zero or more parent operation IDs, triggering Event
IDs or an Event-order range, and optional Reaction pass/delivery IDs. Multiple
parents and causes are valid for coalesced Reaction passes.

Runtime producers MUST be non-blocking with respect to application work.
Producers SHOULD queue at most 10,000 observations, send batches of at most 100,
retry while alive within the collector's deduplication retry window, and drop
oldest entries under pressure. A batch that reaches that horizon is reported as
lost rather than retried after its deduplication identity may expire. After
recovery producers emit `telemetry.dropped` with `droppedCount`. Collectors
deduplicate by source identity plus `observationId` and acknowledge accepted and
duplicate counts.

Only Event metadata is standard. Projects MAY add sanitized JSON `attributes`;
Command inputs, Query results, domain Event payloads, and raw private errors MUST
NOT be sent by default. Observability failure cannot change a Command, Query,
projection, or Reaction outcome.
