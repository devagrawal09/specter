# Slice specifications are independent from implementations

Specter separates each Slice's stable behavioral specification from its executable implementation.

A Slice's `spec.ts` defines only its name, description, and non-empty Scenarios. Scenarios use branded `event(type, payload)` examples, so specifications depend on Event type names and exact domain payloads without importing implementation-owned Event Definitions or schemas. The immutable specification may be completed by multiple divergent `impl.ts` files and each implementation can be tested independently. A Specter App selects exactly one completed implementation for each Slice name.

The implementation order is deliberate:

- Command: input schema, store, zero or more apply handlers, handle.
- Query: input schema, output schema, store, zero or more apply handlers, handle.
- Reaction: output schema, plugin, store, zero or more apply handlers, handle.

Calling a schema stage with a Standard Schema enables runtime validation and transformation. Calling it with only a type parameter keeps static typing without runtime validation. Apply handlers bind directly to registered Event Definition instances, giving handlers decoded payload types and allowing identity checks.

Specter App construction is asynchronous and aggregates conformance diagnostics without executing handlers, stores, or plugins. It verifies unique registrations, completed implementations, Event coverage, schema-compatible examples, lossless Event payload schemas, and exact equality between a Slice's Given Event type union and its apply-handler Event type union. At runtime, a Command may emit only Event types present in accepted Scenario outcomes.

Event payloads are exact durable facts. Schemas may not strip, transform, or generate payload fields; implicit IDs, order, and recorded timestamps are Event Log metadata outside the payload. Domain IDs, timestamps, and randomness therefore enter handlers through command input or prior Events.

This is a breaking `0.3.0` API change. The old co-located `slice.ts`, late optional Scenarios, apply-handler maps, generated-ID matching, and synchronous app construction are intentionally not retained.
