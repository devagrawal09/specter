# Observability API

**Import:** `@specter-ts/observability`

**Status:** `0.3.0` main-branch preview; the published npm release remains `0.2.1`.

## Purpose

`@specter-ts/observability` provides a standalone collector, read-only browser
dashboard, CLI, and non-blocking TypeScript telemetry producer. The collector is
implemented as a Specter app and persists operational Events in SQLite.

Observability is deliberately best effort. A collector outage must not reject a
successful Command, alter an Event commit, stop projection catch-up, or change
Reaction semantics. Signals are metadata; projects must sanitize attributes and
must not send Command inputs, Query results, domain Event payloads, or private
errors by default.

## Boundary

Runtimes send `observations.batch` and receive `observations.ack` at
`POST /specter/v1/observations`. This is the entire language-neutral protocol.

The dashboard and CLI use collector-owned, read-only routes for overview,
activity, traces, and streaming updates. They are not protocol clients and
cannot execute Commands or Queries in observed applications.

## Main exports

| Export | Purpose |
| --- | --- |
| `createSpecterObservabilityCollector(options?)` | Creates the persistent Specter collector app and typed read methods. |
| `createSpecterObservabilityHttpHandler(options)` | Serves observation ingestion, collector reads, the dashboard, and its SSE stream. |
| `createRuntimeObservationProducer(options)` | Creates the bounded, retrying, non-blocking TypeScript producer. |
| `createRuntimeObservationEmitter(options)` | Maps core runtime and outbox callbacks into protocol observations. |
| `createSpecterProtocolObserver(options)` | Creates the core observation callback for a producer/source pair. |
| `renderCollectorHtml()` | Renders the dependency-light dashboard document. |
| `DEFAULT_OBSERVATION_RETRY_WINDOW_MS` | Default producer/collector deduplication retry horizon. |

The package also exports collector model types such as `RuntimeOverview`,
`CollectedRuntimeObservation`, `RuntimeActivityFilter`, and `RuntimeTrace`.

## Produce observations

```ts
const source = {
  application: 'todo-reference',
  environment: 'development',
  runtimeLanguage: 'typescript',
  runtimeVersion: '0.3.0',
  instanceId: `todo-${process.pid}`,
  eventLogId: './data/app.db',
}

const producer = createRuntimeObservationProducer({
  collectorUrl: 'http://127.0.0.1:41739',
  source,
})

const telemetry = createRuntimeObservationEmitter({ producer, source })
const config = { /* Events, Slices, adapters */ observe: telemetry.observe }
```

`record` never awaits network I/O. The producer keeps an immutable in-flight
batch, sends at most 100 observations per batch, retains at most 10,000 by
default, retries within the deduplication horizon, and reports recovered loss
with `telemetry.dropped`.

## Run and inspect the collector

```sh
specter-observe serve
specter-observe snapshot
specter-observe snapshot --format text
specter-observe watch --application todo-reference --kind reaction.run.failed
specter-observe trace operation-id
```

The collector uses fixed strict port `41739` by default. It rotates its active
SQLite segment after 24 hours or 64 MiB and retains a separate deduplication
index for the retry window.

## Related documentation

- [Runtime](../architecture/runtime.md)
- [Runtime-observability protocol](../../protocol/README.md)
- [Reaction outbox API](reaction-outbox.md)
- [API reference](README.md)
