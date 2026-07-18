# Specter Go reference runtime

This Go 1.24 module is an independent, standard-library-only reference implementation of Specter's language-neutral protocol. It provides:

- an ordered in-memory Event Log with atomic expected-version and idempotency behavior;
- language-native Command, Query, Reaction, and exact Scenario definitions;
- event-derived per-Slice projections;
- immediate Reactions with separately observable completion tickets;
- latest-value/coalescing Query subscriptions;
- structured Specter errors and causal runtime observations;
- protocol-v1 HTTP/JSON and SSE server/client bindings; and
- a bounded, non-blocking, best-effort telemetry producer.

Run the reference app with Go 1.24:

```sh
go run ./cmd/todo
```

It binds strictly to `127.0.0.1:41737` and exposes the protocol below `/specter/v1`. It sends observations to `http://127.0.0.1:41736/specter/v1` by default. Set `SPECTER_COLLECTOR_URL` to select another protocol base URL. The Go runtime intentionally advertises no SQLite, Postgres, or durable Reaction-outbox capability.

Validate the module with:

```sh
go test ./...
```

Repository CI provisions Go 1.24. Local environments where `go` is not already
available must provision that toolchain before running `pnpm test:go` or the
module tests directly.
