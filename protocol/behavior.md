# Protocol v1 behavior

## Compatibility

Every batch and acknowledgement contains protocol major version `1`. A
collector MUST reject a different major with
`SPECTER_PROTOCOL_VERSION_MISMATCH`; the HTTP binding uses status 426. Producers
and collectors MUST ignore unknown optional object members so compatible fields
can be added without capability negotiation.

Protocol v1 intentionally has one purpose and one request/response pair:
`observations.batch` and `observations.ack`. Commands, Queries, subscriptions,
and Reaction completion are runtime behavior that MAY be observed, but they are
not remotely invoked through this protocol.

## Causality and metadata

An observation carries source identity, a source-local sequence, operation and
optional correlation IDs, zero or more parent operation IDs, triggering Event
IDs or an Event-order range, and optional Reaction pass/delivery IDs. Multiple
parents and causes are valid for coalesced Reaction passes.

Only Event metadata is standard. Projects MAY add sanitized JSON `attributes`;
Command inputs, Query results, domain Event payloads, and raw private errors MUST
NOT be sent by default. Event references in one observation MUST be strictly
ascending by order. Event order is local to `source.eventLogId` and MUST NOT be
treated as global across sources.

## Delivery and acknowledgement

Each batch contains at most 100 observations and has a `requestId`. A producer
MUST keep an in-flight batch immutable while retrying it. A collector MUST
deduplicate using source identity plus `observationId`; it MUST NOT use
`requestId` as the identity of the batch contents. An acknowledgement reports
accepted and duplicate counts and MAY list rejected observation IDs.

Runtime producers MUST be non-blocking with respect to application work.
Producers SHOULD queue at most 10,000 observations, retry an immutable in-flight
batch while alive within the collector's deduplication retry window, and drop
oldest mutable queued entries under pressure. A batch that reaches that horizon
is reported as lost rather than retried after its identity may expire. After
recovery producers emit `telemetry.dropped` with `droppedCount`.

Observability delivery, acknowledgement, retry, or failure MUST NOT change a
Command, Query, projection, subscription, or Reaction outcome.
