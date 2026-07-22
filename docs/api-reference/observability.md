# Observability API

**Import:** `@specter-ts/observability`

**Status:** `0.4.0` main-branch preview; the published npm release remains `0.2.1`.

## Purpose

`@specter-ts/observability` provides a standalone collector, unified browser
dashboard, CLI, and non-blocking TypeScript telemetry producer. The collector is
implemented as a Specter app. It persists operational Events in rotating SQLite
segments and keeps immutable portable Slice specifications in its control
database.

Observations are deliberately best effort and metadata-only by default. A
collector outage must not reject a successful Command, alter an Event commit,
stop projection catch-up, or change Reaction semantics. Projects must sanitize
attributes and must not send Command inputs, Query results, domain Event
payloads, or private errors as telemetry.

Specification publication is a separate explicit privacy opt-in. Published
documents contain complete developer-authored Given/When/Then examples without
automatic redaction. Use synthetic values and treat the collector as trusted
local or team infrastructure.

## Boundary

The language-neutral protocol has two independent write-only ingestion lanes:

- runtimes send `observations.batch` and receive `observations.ack` at
  `POST /specter/v1/observations`;
- runtimes send `specifications.publish` and receive `specifications.ack` at
  `POST /specter/v1/specifications`.

The dashboard and CLI use collector-owned read routes for specifications,
overview, activity, traces, and streaming updates. They cannot execute Commands
or Queries in observed applications. Application operations remain behind
project-owned typed transports. Operators may separately prune selected
specification digests through the collector-owned delete route.

## Main exports

| Export | Purpose |
| --- | --- |
| `createSpecterObservabilityCollector(options?)` | Creates the persistent Specter collector app and typed read methods. |
| `createSpecterObservabilityHttpHandler(options)` | Serves observation ingestion, collector reads, the dashboard, and its SSE stream. |
| `createRuntimeObservationProducer(options)` | Creates the bounded, retrying, non-blocking TypeScript producer. |
| `createRuntimeObservationEmitter(options)` | Maps core runtime and outbox callbacks into protocol observations. |
| `createSpecterProtocolObserver(options)` | Creates the core observation callback for a producer/source pair. |
| `createSpecterProtocolObserverLayer(options)` | Supplies that observer as an Effect Layer. |
| `createMemorySpecificationCatalog()` | Creates an in-memory immutable specification catalog. |
| `createSqliteSpecificationCatalog(client)` | Creates the collector's persistent specification catalog. |
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
  runtimeVersion: '0.4.0',
  instanceId: `todo-${process.pid}`,
  eventLogId: './data/app.db',
}

const producer = createRuntimeObservationProducer({
  collectorUrl: 'http://127.0.0.1:41739',
  source,
  // Explicit opt-in: these documents contain full synthetic Scenario values.
  specifications: todoSpecifications,
})

const telemetry = createRuntimeObservationEmitter({
  producer,
  source,
  specificationDigests: todoSpecificationDigests,
})

const app = await createSpecterApp(
  config,
  Layer.mergeAll(
    EventLogLive,
    SliceStoresLive,
    ReactionSchedulerLive,
    Layer.succeed(SpecterObserver, telemetry.observer),
  ),
)
```

`record` never awaits network I/O. The producer keeps an immutable in-flight
batch, sends at most 100 observations per batch, retains at most 10,000 by
default, retries within the deduplication horizon, and reports recovered loss
with `telemetry.dropped`.

At startup the producer publishes each unique specification digest in the
background. Publication and observation delivery are acknowledged, retried,
and deduplicated independently. Telemetry may temporarily reference an
unpublished digest; the collector resolves that association when publication
eventually succeeds.

## Run and inspect the collector

```sh
specter-observe serve
specter-observe snapshot
specter-observe snapshot --format text
specter-observe watch --application todo-reference --kind reaction.run.failed
specter-observe trace operation-id
```

The collector uses fixed strict port `41739` by default. It rotates its active
SQLite telemetry segment after 24 hours or 64 MiB and retains a separate
deduplication index for the retry window. Specifications are immutable,
deduplicated by canonical SHA-256 digest, stored outside rotating segments, and
retained until an operator explicitly prunes them.

The dashboard renders a whole-Slice overview and detailed Given → When → Then
lanes with exact payloads and rejection reasons. It places recent executions,
failures, projection activity, and causal traces beside the exact specification
digest referenced by telemetry. It never claims that production telemetry
matched a particular Scenario because observations intentionally omit full
Command inputs and domain payloads.

## Related documentation

- [Runtime](../architecture/runtime.md)
- [Runtime-observability protocol](../../protocol/README.md)
- [Reaction outbox API](reaction-outbox.md)
- [API reference](README.md)
