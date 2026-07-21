# Specter Runtime Protocol v1

This directory is the language-neutral contract for Specter runtimes, clients,
and observability collectors. Implementations conform by producing the same
observable results for the fixtures in `fixtures/`; application Slices,
handlers, schemas, and persistence layouts remain language-native.

For a visual summary of the implementation, validation, product impact, and
recommended follow-up work, open the
[runtime protocol delivery report](../docs/runtime-protocol-delivery-report.html)
in a browser.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## Wire rules

- Messages are UTF-8 JSON objects and MUST contain `protocolVersion`, `kind`,
  and `requestId`. Version 1 is the first protocol major.
- IDs are non-empty strings. Timestamps are RFC 3339 UTC strings. Integers MUST
  be in the JSON-safe range and non-negative where the schemas say so.
- Implementations MUST reject a different major version, MUST ignore unknown
  optional object members, and MUST reject an unsupported required capability.
- Domain values MUST be JSON values. `undefined`, non-finite numbers, bigint,
  maps, functions, class instances, and cyclic values are not permitted.
- Event `order` is strictly increasing only within its `eventLogId`; it is not a
  global order across sources.

## Contracts

- [Behavior and causality](behavior.md)
- [Reference HTTP/SSE binding](http-binding.md)
- [Message schemas](schemas/messages.schema.json)
- [Runtime observation schema](schemas/runtime-observation.schema.json)
- [Behavioral conformance vectors](conformance/README.md)

JSON Schema describes the wire shape. The behavioral document is authoritative
for ordering, idempotency, capability, cancellation, and failure semantics.
