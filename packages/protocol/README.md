# `@specter-ts/protocol`

Language-neutral Specter runtime-observability protocol v1 types and runtime
validation for TypeScript producers and collectors.

The package models two messages:

- `observations.batch`, sent from a runtime to a collector; and
- `observations.ack`, sent from the collector back to that producer.

The sole reference HTTP endpoint is `POST /specter/v1/observations`. This
package is intentionally network-independent and has no dependency on
`@specter-ts/core`. It does not expose a generic application client, server, or
adapter and cannot remotely execute Commands, Queries, subscriptions, or
Reactions.

Applications keep Slices and handlers language-native and expose project-owned
transports when remote application access is required. The observability
dashboard and CLI are clients of the collector's separate read API, not clients
of this protocol.

The normative specification, JSON Schemas, and language-neutral fixtures live
in the repository's [`protocol/`](../../protocol/) directory.
