# Specter Go reference runtime

This Go 1.24 module is an independent, standard-library-only Specter runtime. It provides:

- an ordered in-memory Event Log with atomic expected-version and idempotency behavior;
- language-native Command, Query, Reaction, and exact Scenario definitions;
- event-derived per-Slice projections;
- immediate Reactions with separately observable completion tickets;
- latest-value/coalescing Query subscriptions;
- structured Specter errors and causal runtime observations;
- a protocol-v1 client for observation ingestion and specification publication;
- a bounded, non-blocking, best-effort telemetry producer.

Commands, Queries, subscriptions, and Reaction tickets are runtime concepts,
not language-neutral remote APIs. Go applications expose them through their own
typed transports when remote access is needed.

The telemetry producer retries an immutable batch for up to 48 hours by default,
matching the collector's deduplication horizon. Use `NewProducerWithOptions` to
configure `ProducerOptions.RetryWindow` when the collector uses another value.

Run the reference app with Go 1.24:

```sh
go run ./cmd/todo
```

It binds strictly to `127.0.0.1:41737` and exposes a project-owned Todo API:

- `POST /todos` executes the Todo app's `addTodo` Command;
- `GET /todos` executes its `todosQuery`; and
- `GET /healthz` reports process health.

The reference app does not expose `/specter/v1` routes. It sends runtime
observations outward to `http://127.0.0.1:41739/specter/v1/observations` by
default. The protocol client also validates and can publish portable Slice
documents to `/specter/v1/specifications`; the Go specification package shares
the TypeScript digest and strict-validation vectors. Pass those published
digests through `specter.Config.SpecificationDigests`; the runtime then attaches
the matching digest to every Command, Query, Reaction, and Slice observation.
Set
`SPECTER_COLLECTOR_URL` to another collector root URL. The protocol performs no
capability negotiation; SQLite,
Postgres, and durable Reaction-outbox support remain runtime-specific concerns.

Validate the module with:

```sh
go test ./...
```

Repository CI provisions Go 1.24. Local environments where `go` is not already
available must provision that toolchain before running `pnpm test:go` or the
module tests directly.
