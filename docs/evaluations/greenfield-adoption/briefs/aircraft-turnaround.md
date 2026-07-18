# Product Brief: Aircraft Turnaround Control

## Objective

Build an airport operations application that coordinates an aircraft from
on-block arrival through service completion and pushback. It must prevent gate
and safety conflicts, turn fuel discrepancies into durable safety work, and
keep the turnaround board live for dispatchers.

This is a transfer domain not used by the Specter reference applications. The
brief specifies observable business behavior only. It does not prescribe Event
types, Slice names, feature boundaries, private State, or projection layout.

## Assigned environment

- Persistence: maintained SQLite Event Log, Slice Store, and durable outbox
  against a real on-disk database.
- Topology: one application/web process on strict port `41914`.
- Recovery: generate and adapt the shipped SQLite persistent harness. Do not
  replace the assigned adapters, scheduler, or generated transport.

## Boundary-owned fixture values

| Meaning | Value |
|---|---|
| Primary turnaround | `turn-at-401` |
| Competing turnaround | `turn-at-402` |
| Flights | `SP401`, `SP402` |
| Aircraft | `N401SP`, `N402SP` |
| Gates | `gate-c12`, `gate-c14` |
| Service tasks | `task-bag-401`, `task-cabin-401`, `task-fuel-401`, `task-cater-401` |
| Fuel discrepancy | `fuel-check-401` |
| Safety hold | `hold-at-401` |
| Scheduled arrival | `2026-08-06T16:20:00.000Z` |
| On-block and later times | ISO values from `2026-08-06T16:24:00.000Z` onward |

Requests supply all turnaround, task, discrepancy, hold, actor, version, and
timestamp values. No handler may create domain IDs or operational times.

## Required product behavior

1. Open a turnaround with turnaround ID, flight, aircraft registration,
   origin, destination, scheduled arrival/departure, and required service task
   IDs. Duplicate turnaround, flight, or simultaneously active aircraft is
   rejected.
2. Assign an available gate with expected turnaround version and assignment
   time, then record on-block arrival. A gate already assigned to another active
   turnaround is rejected as `Gate is already occupied`; on-block before gate
   assignment is rejected.
3. Start and complete each required service task with its supplied task ID,
   service type, team, and timestamps. Completion without start, duplicate
   completion, and tasks not declared for the turnaround are rejected.
4. Record a fuel reconciliation with expected quantity, loaded quantity,
   tolerance, check ID, and checked time. A variance outside tolerance requires
   safety review; an in-tolerance result satisfies the fueling prerequisite.
5. Acknowledge and clear a fuel safety hold with reviewer, resolution, and
   supplied timestamps. A hold cannot be cleared before acknowledgement and a
   corrected in-tolerance fuel reconciliation.
6. Declare the turnaround ready only when the aircraft is on-block, every
   required task is complete, fuel is reconciled, and no safety hold is open.
   Otherwise reject with `Turnaround prerequisites are incomplete`.
7. Record pushback with tug ID and off-block time. Pushback before readiness is
   rejected as `Turnaround is not ready for pushback`; a completed turnaround
   cannot be pushed back twice.

Accepted operations return committed results through the public transport.
Domain rejection uses stable structured errors and specified messages. Invalid
or rejected inputs append no facts.

## Checkpoint operation

The vertical-path checkpoint is **gate assignment**. Cover successful assignment
to an opened turnaround, rejection for an unknown turnaround, and rejection
when a prior active turnaround occupies the gate. Include exact Scenarios,
runtime validation, private decision State, an operations-board Query, public
transport, and visible UI on `41914`.

## Required asynchronous effect

Accepting an out-of-tolerance fuel reconciliation schedules durable work that
submits a normal guarded operation opening the supplied `holdId`. The effect
uses the retry-stable delivery identity as the downstream idempotency key.
Retries, duplicate delivery, and restart recovery result in one active hold for
that discrepancy.

Fuel reconciliation is visibly committed before effect completion. An injected
first effect failure persists an attempt and can later succeed after restart.
The resulting hold must still enforce the normal readiness guard.

## Operational views and live behavior

Provide a turnaround board with flight, aircraft, gate, on-block state, task
progress, fuel state, safety-hold state, readiness, and departure state. Support
filters for gate concourse, safety status, and ready/not-ready. Detail shows the
task timeline, fuel checks, hold history, and pushback.

With the board open in one browser, submit an out-of-tolerance reconciliation
through another request. The browser must show both the fuel discrepancy and
the asynchronously opened hold through SSE without refresh.

## Persistence, replay, concurrency, and idempotency

- Restart against the same SQLite file and reconstruct equivalent decision and
  Query State; repair a missing/lagging board projection through replay.
- Race `turn-at-401` and `turn-at-402` for `gate-c12` using the same observed
  availability. Exactly one assignment succeeds; the other conflicts or gets
  the occupied-gate rejection.
- Repeat one task-completion request with one idempotency key and receive the
  original receipt with one completion in history.
- A failure between board apply and cursor advancement is atomic or safely
  repeatable.

## Browser journeys

### Journey A: discrepancy, live hold, and safe pushback

Open `turn-at-401`, assign `gate-c12`, record on-block, and complete all service
tasks except fueling. While the board is open, submit an out-of-tolerance fuel
check from another request and observe the automatic hold. Attempt readiness
and see `Turnaround prerequisites are incomplete`. Acknowledge the hold, record
a corrected fuel check, clear it, declare ready, and push back. Restart and
confirm the departed state and history.

### Journey B: gate race and incomplete turnaround

Open `turn-at-401` and `turn-at-402`, race them for `gate-c14`, and show one
winner. On the winner, omit a required service task and verify readiness fails
with `Turnaround prerequisites are incomplete`. Complete it, declare ready, and
confirm the board's ready filter changes live.

## Visible acceptance

The visible suite covers the checkpoint, exact Scenario behavior, public
routes, SSE updates, on-disk restart/replay, and both browser journeys. Run:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Held-out checks add gate concurrency, task idempotency, cursor fault recovery,
durable hold retry/dead-letter behavior, malformed transport requests, SSE
reconnect, and cancellation cleanup.
