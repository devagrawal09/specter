# Observability Protocol Simplification

## Decision

Specter's language-neutral protocol is a one-way runtime-observability boundary:

```text
Specter runtime ── observation batch ──> collector
Specter runtime <─ acknowledgement ───── collector
```

It is not a remote application API. Commands, Queries, subscriptions, and
Reaction completion remain runtime concepts that applications expose through
their own typed transports when remote access is required. The collector's
dashboard and CLI use a separate, collector-owned read API.

This change corrects protocol v1 before publication rather than preserving the
unintended operational API or introducing a compatibility layer.

## Why

The operational API mixed three independent boundaries:

1. application-specific remote access;
2. language-neutral runtime telemetry ingestion; and
3. collector-specific dashboard reads.

That made the protocol package depend on the TypeScript runtime, required Go to
host a generic server, implied that arbitrary applications shared portable
Command and Query definitions, and made the dashboard appear to be a protocol
client. None of those properties are required for shared observability.

Narrowing the protocol makes the product model explicit: runtimes produce
metadata, the collector stores and projects it, and read-only tools inspect the
collector.

## Implementation Plan

### 1. Narrow the normative protocol

- Retain the versioned JSON envelope, runtime source identity, causality,
  Event references, structured errors, runtime observations, observation
  batches, and acknowledgements.
- Remove capability negotiation and the Command, Query, subscription, and
  Reaction-ticket message families from schemas, fixtures, public types, and
  behavioral documentation.
- Keep `/specter/v1/observations` as the sole reference HTTP protocol endpoint.
- Validate the protocol major version on every batch and acknowledgement,
  ignore unknown optional fields, reject malformed input, and preserve
  observation-ID deduplication.

### 2. Simplify the TypeScript boundary

- Remove the generic protocol client, server adapter, and Specter-runtime HTTP
  adapter.
- Make `@specter-ts/protocol` an observation-only types and validation package
  with no dependency on `@specter-ts/core`.
- Keep telemetry production in `@specter-ts/observability` non-blocking and
  independent of application execution.
- Remove the generic `/specter/v1/*` application route from the TypeScript Todo
  reference app while retaining its project-owned `/api/*` transport.

### 3. Separate collector ingestion from collector reads

- Keep only `POST /specter/v1/observations` on the collector's protocol surface.
- Retain `/v1/overview`, `/v1/activity`, `/v1/traces/:operationId`, and
  `/v1/stream` as a collector-specific, read-only API for the dashboard and CLI.
- Remove capability discovery from the collector.
- Send protocol-version headers only on the observation endpoint, not on the
  dashboard, static assets, or collector read API.
- Keep collector Commands, Events, and Queries as its internal Specter app
  implementation; they are not exposed as a generic runtime protocol.

### 4. Simplify the Go runtime integration

- Remove the generic operational protocol server and its Command, Query,
  subscription, and Reaction-ticket HTTP behavior.
- Narrow the Go protocol package to observation wire types, validation, and an
  observation-ingestion client used by the telemetry producer.
- Replace the Go Todo generic protocol server with a small project-owned Todo
  API on the existing fixed port `41737`, executing runtime Commands and Queries
  directly while continuing to emit observations to the collector.
- Continue advertising no unsupported persistence or durable-outbox behavior,
  because capabilities are no longer negotiated through the observation
  protocol.

### 5. Replace conformance and interoperability coverage

- Remove operational golden fixtures and cross-runtime application-client tests.
- Keep language-neutral observation fixtures for valid batches,
  acknowledgements, malformed messages, version mismatch, unknown optional
  fields, metadata redaction, ordering, queue overflow, retry, and deduplication.
- Verify independently that TypeScript and Go producers can submit to the same
  collector and that both sources appear in collector Queries, the dashboard,
  and CLI output.
- Preserve runtime-local tests for Command, Query, subscription, Event,
  projection, and Reaction behavior; removing those concepts from the wire does
  not remove them from either runtime.

### 6. Correct product documentation

- Describe the dashboard and CLI as collector clients, not protocol clients.
- Describe application APIs as project-owned transports.
- Update READMEs, API references, ADRs, examples, and visual reports so no
  current documentation claims that the shared protocol remotely executes
  Commands or Queries.
- Clearly label the removal as a breaking pre-release correction to protocol v1.

## Acceptance Criteria

- `/specter/v1/observations` is the only language-neutral HTTP endpoint.
- No public protocol export or normative schema defines Command, Query,
  subscription, capability, or Reaction-ticket request/response messages.
- `@specter-ts/protocol` has no dependency on `@specter-ts/core`.
- TypeScript and Go applications retain idiomatic, project-owned ways to execute
  Commands and Queries.
- Dashboard and CLI traffic uses only the collector read API and cannot mutate an
  observed application.
- Telemetry delivery remains bounded, non-blocking, retryable, deduplicated, and
  isolated from application success or failure.
- TypeScript and Go telemetry appear concurrently in the shared collector.
- Focused protocol, collector, producer, reference-app, and Go tests pass,
  followed by `go test ./...`, `pnpm check`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, and `pnpm build`.

## Compatibility Risk

Any experimental consumer of the generic protocol Command, Query,
subscription, or Reaction-ticket routes must move to an application-owned API.
There is intentionally no compatibility shim: retaining one would preserve the
coupling this change removes. Stored collector observations and the collector's
read-only dashboard model remain compatible.
