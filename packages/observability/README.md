# `@specter-ts/observability`

Operational signals and development diagnostics for Specter.

```ts
const diagnostics = createInMemorySpecterObservability()
const observeOutbox = createOutboxObservabilityListener(diagnostics)

const dependencies = Layer.mergeAll(
  Layer.succeed(EventLog, instrumentEventLog(eventLog, diagnostics)),
  createDurableReactionSchedulerLayer(outboxStore),
  StoreLayers,
)

const worker = createReactionOutboxWorker({
  store: outboxStore,
  onTransition: observeOutbox,
  handle,
})
```

Instrumented Event Log covers persisted Events. App integrations report Slice
cursor, subscription, projection, and Reaction signals through explicit reporter
functions. Durable outbox attempts are automatic after worker transition
listener is wired as above.

Replay is project-owned orchestration rather than a core runtime operation.
Wrap that orchestration with `reportProjectionActivity(...)` using `started`,
then `completed` or `failed`, so replay appears in the same panel. External
projectors can call `reportSliceCursor(...)` when their cursor changes. The
in-memory recorder supports snapshots and live listeners. Composite sinks can
forward the same stream to application logging, metrics, or tracing
infrastructure.

```ts
await reportProjectionActivity(diagnostics, {
  sliceName: 'todosQuery',
  activity: 'replay',
  outcome: 'started',
  fromOrder: 0,
})
try {
  const toOrder = await replayTodosProjection()
  await reportProjectionActivity(diagnostics, {
    sliceName: 'todosQuery',
    activity: 'replay',
    outcome: 'completed',
    fromOrder: 0,
    toOrder,
  })
} catch (cause) {
  await reportProjectionActivity(diagnostics, {
    sliceName: 'todosQuery',
    activity: 'replay',
    outcome: 'failed',
    fromOrder: 0,
    cause,
  })
  throw cause
}
```

Observer failures are isolated from application execution: telemetry cannot
turn a committed Command or completed Reaction into a failure.

## Development panel

The framework-agnostic development panel aggregates the same signal stream
into Events, Slice cursor lag, projection replay/catch-up, subscription
invalidations, Reaction outcomes, and durable outbox attempts. Applications can
mount the rendered HTML on a development-only route or consume its typed
snapshot in their own UI.

```ts
const panel = createSpecterDevelopmentPanel(diagnostics)

app.get('/__specter', (context) => context.html(panel.renderHtml()))
console.table(panel.snapshot().sliceCursors)
console.log(panel.renderText())
await writeFile('specter-diagnostics.json', panel.renderJson())
```
