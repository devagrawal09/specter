# Product Brief: Emergency-Department Operations

## Objective

Build an operational web application that follows an emergency-department
encounter from arrival through discharge. The application must make unsafe
transitions visibly fail, keep an authoritative durable history, and update the
department board when work performed by another request or by background
processing changes a patient.

This is a replication domain. Implement the behavior below without consulting
the historical evaluation, its applications, or its domain model. The brief
does not prescribe Event vocabulary, Slice names, feature boundaries, private
State, or projection layout.

## Assigned environment

- Persistence: maintained PostgreSQL Event Log, Slice Store, and durable outbox.
- Topology: one public web process on strict port `41911`; coordinator-owned
  verification also starts two independent application/runtime processes
  against the same PostgreSQL database.
- Database: the coordinator supplies `DATABASE_URL` and an empty database for
  each attempt. Do not replace the assigned adapters or scheduler.

## Boundary-owned fixture values

Tests and browser actions provide every domain identifier and timestamp. A UI
may create those values immediately before sending an envelope, but handlers
must not invent or replace them.

Use these stable values in visible examples and tests:

| Meaning | Value |
|---|---|
| Ambulance encounter | `enc-ed-101` |
| Walk-in encounter | `enc-ed-102` |
| Competing encounter | `enc-ed-103` |
| Patients | `pat-ed-101`, `pat-ed-102`, `pat-ed-103` |
| Treatment beds | `bed-a07`, `bed-a08` |
| Diagnostic order | `order-ed-101` |
| Critical result | `result-ed-101` |
| Critical alert | `alert-ed-101` |
| Arrival times | `2026-08-03T14:00:00.000Z`, `2026-08-03T14:05:00.000Z` |
| Clinical action times | ISO values from `2026-08-03T14:10:00.000Z` onward |

## Required product behavior

The application must support the following observable operations and rules.
Names and internal decomposition are the implementer's choice.

1. Register an ambulance or walk-in encounter with encounter ID, patient ID,
   arrival mode, arrival time, and presenting complaint. Reusing an encounter
   ID for a different request is rejected as `Encounter already exists`.
2. Record initial triage or a later reassessment with assessment ID, acuity from
   1 (most urgent) through 5, observations, and assessed time. Assessment of an
   unknown or discharged encounter is rejected. The latest accepted assessment
   drives the board.
3. Assign an assessed encounter to an available treatment bed, including the
   caller's expected encounter version and assignment time. An unassessed
   encounter is rejected as `Triage is required before bed assignment`; an
   occupied bed is rejected as `Bed is already occupied`.
4. Order a diagnostic test, then record its result. A result must reference an
   existing unreported order. Duplicate result recording is rejected. Results
   carry severity `normal`, `abnormal`, or `critical` and the result time.
5. Acknowledge an open critical alert with clinician ID and acknowledgement
   time. Unknown, already acknowledged, or encounter-mismatched alerts fail.
6. Mark an encounter ready for discharge only after it has been assessed and
   no critical alert remains unacknowledged. Discharge then records disposition
   and departure time. Discharging before readiness is rejected as
   `Encounter is not ready for discharge`; discharging twice is rejected.

An accepted transition returns the normal committed-command result through the
generated public JSON transport. A domain rejection returns a stable structured
Specter error and displays the exact message specified above where applicable.
Schema-invalid payloads and rejected operations must append no domain facts.

## Checkpoint operation

The scored vertical-path checkpoint is **treatment-bed assignment**. Demonstrate
exact executable scenarios for successful assignment after registration and
triage, rejection before triage, and rejection when another active encounter
already occupies the bed. Include runtime input validation, private decision
State, one operational board query, a public envelope call, and visible UI
behavior on port `41911`.

The checkpoint need not implement every setup operation through the UI, but its
tests must express prior history as domain facts rather than mutating a Query
projection or database table directly.

## Required asynchronous effect

Recording a `critical` diagnostic result schedules durable work that submits a
normal guarded operation to open the corresponding critical alert. The effect
uses the supplied `alertId`, encounter ID, result ID, and result time; the
retry-stable delivery identity is the downstream idempotency key. Repeating or
retrying delivery must leave one alert, while an independently submitted alert
for the same result must be rejected or resolve to the same committed outcome.

The result-recording request is observably committed before this asynchronous
work finishes. An injected first effect failure must persist an attempt and be
recoverable after process restart without duplicating the alert.

## Operational views and live behavior

Provide a department board and encounter detail through public Queries. The
board shows encounter ID, patient ID, arrival mode, latest acuity, bed, workflow
status, open-alert count, and arrival time. It supports filters for status,
arrival mode, and maximum acuity. Encounter detail shows the diagnostic orders,
results, alert acknowledgement, readiness, and discharge outcome.

At least one browser subscription stays open. A critical result submitted by a
second request must cause the first browser to show the open alert without a
manual refresh or a local command. Initial state, reconnect, cancellation, and
latest-state behavior remain those of the generated SSE transport.

## Persistence, replay, concurrency, and idempotency

- A restart must reconstruct equivalent command-decision State and both public
  views from durable history.
- Replay must repair a cleared or lagging projection without changing history.
- Two independent application processes concurrently assigning `bed-a07` to
  `enc-ed-102` and `enc-ed-103` from the same observed availability must produce
  exactly one assignment; the other request must receive a conflict or the
  occupied-bed rejection.
- Submitting the same registration twice with one idempotency key must return
  the original commit receipt and append no duplicate facts.
- Applying a fact and advancing its projection cursor must be atomic or safely
  repeatable after injected failure.

## Browser journeys

### Journey A: ambulance escalation and live alert

Register `enc-ed-101`, record urgent triage, assign `bed-a07`, order the
diagnostic test, and keep the board visible. From a second request record the
critical result. Verify the first browser receives an open-alert update, then
acknowledge the alert, mark the encounter ready, and discharge it. The detail
view must retain the complete outcome after a server restart.

### Journey B: guarded walk-in discharge and bed race

Register and triage `enc-ed-102` and `enc-ed-103`. Attempt discharge of
`enc-ed-102` before readiness and see `Encounter is not ready for discharge`.
Exercise competing assignments of `bed-a08` for the two encounters and show
only one winner. Complete the winning encounter's readiness and discharge flow;
filter the board to confirm the final status.

## Visible acceptance

The supplied visible suite exercises the checkpoint, both journeys, focused and
whole-app Scenarios, public JSON routes, SSE update, disk-independent database
restart, and standard toolchain checks. The completed project must pass:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Visible assertions cover the exact messages and fixture outcomes above. The
coordinator separately holds back transport-abuse, cross-process bed races,
cursor fault injection, subscription cleanup, and durable-effect retry cases.
