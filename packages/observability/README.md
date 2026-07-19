# `@specter-ts/observability`

A standalone Specter runtime-observation collector, browser dashboard, CLI,
and non-blocking TypeScript producer. The collector is itself a Specter app:
protocol batches enter through the `recordRuntimeObservations` Command and are
persisted as explicit operational Events before overview, activity, and causal
trace Queries expose them.

Run the collector on its fixed, strict default port:

```sh
specter-observe serve
```

It stores the active segment in SQLite, rotates after 24 hours or 64 MiB, and
retains accepted observation IDs in a separate deduplication database. Accepted
IDs do not expire because a producer retries while its process remains alive;
an expiry could otherwise accept a late retry twice. This gives deduplication
priority over a bounded control-index size until the protocol gains an explicit
producer retry horizon. The read-only dashboard is available at
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
  endpoint: 'http://127.0.0.1:41736',
  source,
})
const telemetry = createRuntimeObservationEmitter({ producer, source })

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
as `telemetry.dropped`.

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
