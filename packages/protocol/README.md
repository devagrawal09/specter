# @specter-ts/protocol

Language-neutral Specter protocol v1 types, runtime validation, capability
negotiation, and the reference Fetch API HTTP/SSE binding.

```ts
import {
  createSpecterProtocolHttpClient,
  createSpecterProtocolHttpHandler,
} from '@specter-ts/protocol'
```

`createSpecterProtocolHttpHandler` accepts a `ProtocolRuntimeAdapter`, so any
runtime can implement the same boundary. The optional
`createSpecterRuntimeProtocolAdapter` binds a TypeScript Specter app without
adding network code to `@specter-ts/core`. The client exposes capability
discovery, Commands, Queries, subscriptions, Reaction tickets, and observation
ingestion.

The normative specification, JSON Schemas, and language-neutral fixtures live
in the repository's [`protocol/`](../../protocol/) directory.
