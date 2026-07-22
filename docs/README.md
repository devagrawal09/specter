# Specter documentation

> **0.4 main-branch preview:** These docs describe the API on `main`. The
> stable npm release is still 0.2.1. Start from the repository checkout when
> following preview examples.

Specter is an Effect-native runtime with a Promise facade for building
vertically sliced, event-sourced applications. TypeScript authors executable
Slice specifications and exports strict JSON contracts consumed by TypeScript,
Go, and tooling. Choose a path based on what you need to do next.

## New to Specter

1. [Introduction](introduction.md) — the core model and vocabulary.
2. [Getting started](getting-started.md) — run the Todo Reference application
   and trace one Slice end to end.
3. [Vertical Slice Architecture](architecture/vertical-slice-architecture.md)
   — how behavior and code are organized.
4. [Writing specifications](specifications/writing-specifications.md) — write
   executable Scenarios before runtime details.

## Build an application

- Architecture
  - [Vertical Slice Architecture](architecture/vertical-slice-architecture.md)
  - [CQRS](architecture/cqrs.md)
  - [Event sourcing](architecture/event-sourcing.md)
  - [File structure](architecture/file-structure.md)
  - [Runtime](architecture/runtime.md)
  - [Plugins](architecture/plugins.md)
- Specifications
  - [Writing specifications](specifications/writing-specifications.md)
  - [Portable specification format](../specification/README.md)
  - [Slice tests](specifications/slice-tests.md)
  - [Conformance](specifications/conformance.md)

## Operate and integrate

- [Runtime architecture](architecture/runtime.md)
- [Language-neutral runtime-observability protocol](../protocol/README.md)
- [Event sourcing](architecture/event-sourcing.md)
- [Plugins](architecture/plugins.md)
- [Core runtime API](api-reference/core-runtime.md)
- [Core adapters API](api-reference/core-adapters.md)
- [Persistence APIs](api-reference/persistence.md)
- [Reaction outbox API](api-reference/reaction-outbox.md)
- [Unified specification and telemetry dashboard](api-reference/observability.md)

## API reference

- [API reference index](api-reference/README.md)
- [`@specter-ts/spec`](api-reference/spec.md)
- [`@specter-ts/core`](api-reference/core-runtime.md)
- [Core adapter contracts](api-reference/core-adapters.md)
- [`@specter-ts/core/testing`](api-reference/core-testing.md)
- [Persistence packages](api-reference/persistence.md)
- [`@specter-ts/reaction-outbox`](api-reference/reaction-outbox.md)
- [`@specter-ts/protocol`](../packages/protocol/README.md)
- [`@specter-ts/observability`](api-reference/observability.md)
- [`create-specter`](api-reference/create-specter.md)

The [repository README](../README.md) covers workspace commands and release
status. The docs here focus on application design and public interfaces.
