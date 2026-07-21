# API reference

Specter is a set of small TypeScript packages for executable Slice specifications, an Event-sourced runtime, persistence adapters, durable Reactions, and operational visibility. This reference describes the `0.3.0` API currently on `main`. The published npm release remains `0.2.1`; use the repository checkout when evaluating this preview.

Public package entrypoints are the source of truth. Import only the names documented here rather than reaching into package `src` or `dist` directories.

## Package and import map

| Package or import | Purpose | Reference |
| --- | --- | --- |
| `@specter-ts/core` | Event definitions, completed Slice types, runtime, adapters, envelopes, observations, and public errors | [Core runtime API](./core-runtime.md) and [core adapter contracts](./core-adapters.md) |
| `@specter-ts/core/spec` | Specification builders, Scenario Event helper, and specification types | [Core specification API](./core-spec.md) |
| `@specter-ts/core/testing` | Scenario runners, replay, focused Event catalogs, and Event propagation analysis | [Core testing API](./core-testing.md) |
| `@specter-ts/memory` | In-memory Event Log, Slice Store, and immediate Reaction scheduler | [Persistence API](./persistence.md) |
| `@specter-ts/sqlite` | libSQL/SQLite Event Log, Slice Store, Reaction outbox store, and combined persistence | [Persistence API](./persistence.md) |
| `@specter-ts/postgres` | Postgres Event Log, Slice Store, Reaction outbox store, and combined persistence | [Persistence API](./persistence.md) |
| `@specter-ts/reaction-outbox` | Durable Reaction Plugin, scheduler, worker, store contract, retries, and dead-letter handling | [Reaction outbox API](./reaction-outbox.md) |
| `@specter-ts/observability` | Shared collector, dashboard, CLI, and non-blocking runtime producer | [Observability API](./observability.md) |
| `create-specter` | CLI that creates the Todo reference project and generates Slices and Events | [Create Specter CLI](./create-specter.md) |

There is no `@specter-ts/core/client` entrypoint. Browser transports are
project-owned code, as described in [Runtime architecture](../architecture/runtime.md).

## Import rules

- Import specification builders and Scenario types from `@specter-ts/core/spec` in `spec.ts` files.
- Import scenario-test helpers from `@specter-ts/core/testing` in tests.
- Import runtime values and completed implementation types from `@specter-ts/core` in application wiring and `impl.ts` files.
- Import persistence, scheduling, outbox, and observability capabilities from their named packages.
- Use named exports. These packages do not expose default exports.
- Runtime schemas are Standard Schema-compatible values supplied by the application. Type-only imports disappear at build time and do not validate data.

## Related concepts

- [Writing executable specifications](../specifications/writing-specifications.md)
- [Testing Slice implementations](../specifications/slice-tests.md)
- [Conformance](../specifications/conformance.md)
- [Runtime architecture](../architecture/runtime.md)
- [Plugins](../architecture/plugins.md)
