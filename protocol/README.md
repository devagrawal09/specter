# Specter Runtime Observability Protocol v1

This directory is the language-neutral telemetry contract between Specter
runtimes and an observability collector. It carries runtime-observation batches
to the collector and acknowledgements back to the producer. It is not an API
for executing application Commands or Queries.

Implementations conform by producing the same observable results for the
fixtures in `fixtures/`; application Slices, handlers, schemas, transports, and
persistence layouts remain language-native.

For a visual summary of the implementation, validation, product impact, and
recommended follow-up work, open the
[runtime protocol delivery report](../docs/runtime-protocol-delivery-report.html)
in a browser.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Wire rules

- Messages are UTF-8 JSON objects and MUST contain `protocolVersion`, `kind`,
  and `requestId`. Version 1 is the first protocol major.
- IDs are non-empty strings. Timestamps use the canonical RFC 3339 UTC spelling
  `YYYY-MM-DDTHH:mm:ss(.digits)?Z` and must name a real calendar instant.
  Integers MUST be in the JSON-safe range and non-negative where the schemas say
  so; equivalent JSON spellings such as `1`, `1.0`, and `1e0` are accepted.
- Implementations MUST reject a different major version and MUST ignore unknown
  optional object members.
- Domain values MUST be JSON values. `undefined`, non-finite numbers, bigint,
  maps, functions, class instances, and cyclic values are not permitted.
- Event `order` is strictly increasing only within its `eventLogId`; it is not a
  global order across sources.

## Contracts

- [Behavior and causality](behavior.md)
- [Reference HTTP binding](http-binding.md)
- [Message schemas](schemas/messages.schema.json)
- [Recursive JSON value schema](schemas/json-value.schema.json)
- [Runtime observation schema](schemas/runtime-observation.schema.json)
- [Behavioral conformance vectors](conformance/README.md)

JSON Schema describes the wire shape. The behavioral document is authoritative
for batching, retry, deduplication, ordering, causality, and failure isolation.
