# Product Brief: Municipal Water Restoration

## Objective

Build a municipal operations application that tracks a water-service incident
from public report through crew response, isolation, repair, water-quality
clearance, and service restoration. It must protect crew allocation, turn unsafe
quality results into durable public-health controls, and update a live incident
map as independent work arrives.

This transfer domain is absent from the Specter reference applications. Choose
the internal Event model, Slice names, feature boundaries, private State, and
projection design; this brief defines only observable product behavior.

## Assigned environment

- Persistence: maintained SQLite Event Log, Slice Store, and durable outbox
  against a real on-disk database.
- Topology: one application/web process on strict port `41915`.
- Recovery: generate and adapt the shipped SQLite persistent harness. Do not
  replace the assigned adapters, scheduler, or transport.

## Boundary-owned fixture values

| Meaning | Value |
|---|---|
| Primary incident | `incident-wr-501` |
| Competing incident | `incident-wr-502` |
| Network segments | `segment-wr-17`, `segment-wr-18` |
| Crews | `crew-wr-7`, `crew-wr-8` |
| Repair | `repair-wr-501` |
| Quality samples | `sample-wr-501`, `sample-wr-502`, `sample-wr-503` |
| Boil advisory | `advisory-wr-501` |
| Initial report time | `2026-08-07T09:00:00.000Z` |
| Dispatch and later times | ISO values from `2026-08-07T09:05:00.000Z` onward |

All identifiers, measurements, actors, expected versions, and timestamps are
provided at the initiating browser/test boundary. Handlers do not create them.

## Required product behavior

1. Open an incident report with incident/segment IDs, location, reporter,
   severity `routine`, `urgent`, or `critical`, symptoms, affected-customer
   estimate, and reported time. Reusing an incident ID is rejected as
   `Incident already exists`.
2. Assign an available crew with expected incident version and dispatch time.
   A crew assigned to another active incident is rejected as
   `Crew is already assigned`; a closed incident cannot receive a crew.
3. Record segment isolation with valve reference and isolation time. Start and
   complete a uniquely identified repair, recording repair type, completion
   notes, and supplied times. Repair cannot complete before isolation.
4. Record uniquely identified water-quality samples with collection time,
   turbidity, contamination result `clear` or `detected`, and laboratory time.
   Samples before repair completion are rejected. Older samples cannot replace
   the current quality sequence.
5. Acknowledge a boil-water advisory and later clear it. Clearance requires
   acknowledgement and two consecutive `clear` samples after the most recent
   detected sample. Otherwise reject with `Water quality is not cleared`.
6. Restore service only after repair completion, water quality clearance, and
   no active advisory. Otherwise reject with
   `Restoration prerequisites are incomplete`. Closing the incident requires
   restoration and a released crew; duplicate close is rejected.

Accepted operations expose committed results through the public envelope
transport. Rejected/schema-invalid operations append no facts and surface
stable structured errors with the specified user-visible messages.

## Checkpoint operation

The vertical-path checkpoint is **crew assignment**. Cover acceptance for an
open incident, rejection for an unknown incident, and rejection when prior
history assigns the crew to another active incident. Include exact Scenarios,
runtime validation, private decision State, an incident-map Query, public
transport, and visible UI on `41915`.

## Required asynchronous effect

An accepted sample with contamination `detected` schedules durable work that
submits a normal guarded operation opening the supplied `advisoryId`. Use the
retry-stable delivery identity as its downstream idempotency key. Duplicate
sample submission, delivery retry, and restart recovery yield exactly one
active advisory for the detected sample.

The sample commit is visible before the effect completes. A persisted first
failure can be retried after restart, and the eventual advisory must enforce
the normal restoration guard.

## Operational views and live behavior

Provide an incident map/list with incident, segment/location, severity,
affected-customer estimate, assigned crew, repair status, latest quality result,
advisory state, and restoration state. Support filters for severity, active
advisory, and workflow status. Detail shows the full response, repair, sample,
advisory, and restoration timeline.

Keep one map subscription open. A contamination result submitted through a
second request must update its quality badge and then its automatic advisory
without refresh or a local browser command.

## Persistence, replay, concurrency, and idempotency

- Restart from the same SQLite file and recover equivalent decision State and
  views; replay repairs a cleared or lagging projection.
- Race assignment of `crew-wr-7` to `incident-wr-501` and `incident-wr-502` at
  the same observed availability. Exactly one succeeds; the other conflicts or
  receives `Crew is already assigned`.
- Repeat repair completion with one idempotency key and obtain the original
  receipt with one completion.
- Projection apply and cursor publication remain atomic or safely repeatable
  after injected failure.

## Browser journeys

### Journey A: contamination advisory and safe restoration

Open `incident-wr-501`, assign `crew-wr-7`, isolate its segment, and complete
`repair-wr-501`. With the map open, submit contamination sample `sample-wr-501`
through another request and observe the live automatic advisory. Attempt
restoration and see `Restoration prerequisites are incomplete`. Acknowledge the
advisory, record two clear samples, clear the advisory, restore service, release
the crew, and close the incident. Verify the result after restart.

### Journey B: crew race and quality gate

Open both fixture incidents and race them for `crew-wr-8`; show one winner.
Complete isolation and repair for that incident, record a detected sample, and
acknowledge the resulting advisory. Record only one later clear sample. Attempt
advisory clearance or restoration and see the appropriate quality/prerequisite
rejection. Record the second consecutive clear sample and complete the flow;
use filters to distinguish restored from still-open work.

## Visible acceptance

The visible suite covers focused and whole-app Scenarios, public routes, SSE,
on-disk restart/replay, checkpoint behavior, and both browser journeys. Run:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Held-out verification adds crew races, idempotency probes, cursor failures,
outbox retry and dead-letter recovery, transport abuse, SSE reconnect, and
subscription cleanup.
