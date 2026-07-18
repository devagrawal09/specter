# Product Brief: Cold-Chain Freight Control

## Objective

Build an operational web application that controls a temperature-sensitive
shipment from registration through proof of delivery. Excursions must produce
durable quality controls, disposition rules must prevent unsafe release, and
operators must receive live changes caused by telemetry and background work.

This is a replication domain. Derive an implementation from this behavior only;
the brief intentionally does not define Event types, Slice names, feature
boundaries, private State, or projections.

## Assigned environment

- Persistence: maintained PostgreSQL Event Log, Slice Store, and durable outbox.
- Topology: one public web process on strict port `41912`; coordinator-owned
  verification also starts two independent application/runtime processes
  against the same PostgreSQL database.
- Database: the coordinator supplies `DATABASE_URL` and a fresh database per
  attempt. Do not substitute infrastructure.

## Boundary-owned fixture values

All identifiers and timestamps originate in browser/test requests, including
those used later by asynchronous work.

| Meaning | Value |
|---|---|
| Primary shipment | `ship-cc-201` |
| Competing shipment | `ship-cc-202` |
| Containers | `cont-cc-201`, `cont-cc-202` |
| Checkpoint | `checkpoint-cc-201` |
| Telemetry sample | `sample-cc-201` |
| Excursion case | `excursion-cc-201` |
| Investigation | `investigation-cc-201` |
| Proof of delivery | `delivery-cc-201` |
| Registration time | `2026-08-04T08:00:00.000Z` |
| Dispatch and later action times | ISO values from `2026-08-04T08:30:00.000Z` onward |

## Required product behavior

1. Register a shipment with shipment/container IDs, origin, destination,
   product, allowed minimum and maximum Celsius values, and registration time.
   The minimum must be below the maximum. Reusing either active identifier for
   different work is rejected.
2. Dispatch a registered shipment with vehicle ID, expected shipment version,
   and dispatch time. An already dispatched shipment is rejected as
   `Shipment has already been dispatched`.
3. Record location checkpoints in chronological order. Each includes a unique
   checkpoint ID, location, status, and observed time. A checkpoint before
   dispatch or one older than the latest accepted observation is rejected.
4. Record a uniquely identified temperature sample. In-range telemetry updates
   the shipment normally. An out-of-range sample places its disposition under
   quality control; duplicate sample IDs cannot create duplicate work.
5. Open and acknowledge an excursion investigation, record corrective action,
   and decide `release` or `reject`. Release before acknowledgement and
   corrective action is rejected as `Investigation requirements are incomplete`.
   A shipment with unresolved excursion work cannot be delivered.
6. Record proof of delivery with recipient, delivery ID, condition, and time.
   Delivery while quality-held is rejected as `Shipment is on quality hold`;
   rejected shipments cannot be delivered.

Accepted operations expose normal committed-command results. Rejections use
stable structured errors and the specified message; invalid or rejected inputs
append no domain facts.

## Checkpoint operation

The vertical-path checkpoint is **dispatching a registered shipment**. Cover a
successful dispatch, rejection of dispatch without registration, and duplicate
dispatch, including exact prior-history Scenarios, runtime validation, private
decision State, a shipment-board Query, public transport, and visible UI on
`41912`.

## Required asynchronous effect

An out-of-range temperature sample schedules durable work that submits a normal
guarded operation to open the supplied `excursionId` and place the shipment on
quality hold. Its retry-stable delivery identity is used as the downstream
idempotency key. Retries, restart recovery, or duplicate telemetry submission
must result in one investigation and one active hold.

The telemetry commit is observable before asynchronous completion. The visible
application shows pending versus completed effect status, and a coordinator
injected first failure can be retried successfully after restart.

## Operational views and live behavior

Provide a shipment board with shipment/container ID, route, latest location,
latest temperature, control status, investigation state, and delivery state.
Support search plus filters for control status and destination. A shipment
detail view shows checkpoints, temperature samples, investigation decisions,
and proof of delivery.

A board subscription in one browser must update after an out-of-range sample is
sent through another request and again after background work opens the hold.
Neither update may depend on local refresh.

## Persistence, replay, concurrency, and idempotency

- Restart and catch-up reconstruct equivalent decision and Query State;
  deliberate projection loss is repaired through replay.
- Concurrent dispatch requests for `ship-cc-201` from two application processes
  at the same expected version produce one dispatch and one stale/conflict or
  already-dispatched result.
- Reusing one idempotency key for the same telemetry request returns the original
  receipt and creates no duplicate sample, hold, or investigation.
- Durable history remains globally unique and strictly ordered.
- Projection apply and cursor advancement survive injected interruption without
  losing or multiplying a board row.

## Browser journeys

### Journey A: excursion, quality control, and delivery

Register and dispatch `ship-cc-201`, record a checkpoint, and open its board
detail. Submit the out-of-range sample from another request and observe the live
temperature and automatic quality hold. Attempt delivery and see
`Shipment is on quality hold`. Acknowledge the investigation, record corrective
action, release the shipment, and record proof of delivery.

### Journey B: decision gates and rejection

Register and dispatch `ship-cc-202`, then create an out-of-range condition.
Attempt release before acknowledgement/corrective action and see
`Investigation requirements are incomplete`. Complete the prerequisites but
choose rejection. Verify delivery remains unavailable and filter the board to
show rejected shipments.

## Visible acceptance

Run the visible Scenario, public-route, SSE, restart, and browser tests plus:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Visible assertions cover the checkpoint, both journeys, fixture outcomes, and
exact messages. Held-out verification adds cross-process dispatch conflicts,
outbox claim races and restart retry, transport abuse, projection/cursor faults,
and SSE abort cleanup.
