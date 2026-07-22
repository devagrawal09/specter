# `@specter-ts/observability`

A standalone Specter runtime-observation collector, browser dashboard, CLI,
and non-blocking TypeScript producer. The collector is itself a Specter app:
protocol batches enter through the internal `recordRuntimeObservations` Command
and are persisted as explicit operational Events before internal overview,
activity, and causal-trace Queries expose them.

Both `POST /specter/v1/observations` and
`POST /specter/v1/specifications` are language-neutral protocol routes. The
dashboard and CLI use the collector-owned, read-only `/v1/*` API; they cannot
execute Commands or Queries in an observed application.

Run the collector on its fixed, strict default port:

```sh
specter-observe serve
```

It stores the active segment in SQLite, rotates after 24 hours or 64 MiB, and
retains accepted observation IDs in a separate deduplication database for a
48-hour retry window by default. Producers use the same default horizon and
report an unacknowledged batch as dropped instead of retrying after its identity
can expire. Override both sides together with the TypeScript producer's
`retryWindowMs`, the Go producer's `ProducerOptions.RetryWindow`, and the
collector's `--retry-window-ms` option. The read-only dashboard is available at
`http://127.0.0.1:41736`.

Applications create a bounded producer and adapt the core observer and durable
outbox transitions into protocol observations:

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
  collectorUrl: 'http://127.0.0.1:41736',
  source,
  // Explicit privacy opt-in: full synthetic Given/When/Then examples leave
  // this process only when the application supplies these documents.
  specifications,
})
const telemetry = createRuntimeObservationEmitter({
  producer,
  source,
  specificationDigests,
})

const config = { /* Events, Slices, adapters */ observe: telemetry.observe }
const schedule = createDurableReactionScheduler(outbox, {
  onTransition: telemetry.outbox,
})
```

The producer never awaits network I/O in `record`, batches at most 100
observations, and retains at most 10,000 total observations by default,
including its immutable in-flight batch. Under pressure it drops the oldest
mutable queued entry; if the in-flight batch occupies the full bound, it drops
the incoming entry instead. It retries while alive and reports recovered loss
as `telemetry.dropped`, including a batch that remains unacknowledged through
the retry horizon.

Specification publication is separately best effort and never blocks runtime
execution. Documents are deduplicated by their canonical SHA-256 digest. The
collector retains immutable documents outside rotating telemetry segments and
records source associations separately; it never expires a specification
implicitly. Operators may explicitly prune selected digests with
`DELETE /v1/specifications`. `GET /v1/specifications` supports application,
Slice, and digest filters.

The unified dashboard renders the whole Slice and every Given/When/Then lane,
including exact payloads and rejected reasons. It correlates observations that
carry the same specification digest, shows lag/failure summaries, follows live
activity over SSE, and opens causal traces from telemetry rows. An observation
without a published matching digest remains visible as telemetry but is not
silently attached to another specification version.

CLI reads are stable JSON/NDJSON by default:

```sh
specter-observe snapshot
specter-observe snapshot --format text
specter-observe watch --application todo-reference --kind reaction.run.failed
specter-observe trace operation-id
```

`watch` accepts filters for application, environment, instance, Event Log,
kind, operation, and correlation. Slice and Reaction filtering can use their
corresponding protocol kind together with the dashboard's source filters.
