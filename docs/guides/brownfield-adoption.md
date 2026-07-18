# Brownfield adoption

Use this guide when one existing write operation is moving behind Specter while
the rest of an application remains unchanged. It complements
[`runtime-boundaries.md`](./runtime-boundaries.md); the adapter verifier remains
the executable source of truth for persistence and scheduling contracts.

## Choose one authority

Make the Event Log authoritative for the migrated operation. The public route
parses and authenticates the request, creates nondeterministic values such as
IDs and timestamps, and dispatches one Command envelope through `app.command`.
It must not also update legacy tables or enqueue legacy work around Specter.

Existing domain tables can remain the read model. Treat them as Event-derived
Slice State: apply handlers update those tables, then publish the Slice cursor
atomically or with a safely idempotent recovery design. Unchanged routes may
continue reading the tables. If projection publication fails, replay durable
Events to repair them.

## Bootstrap current state

Legacy databases rarely contain enough information to reconstruct historical
Events. Instead, map a fixed current-state snapshot into explicit bootstrap
Events:

1. Read only the coordinator-owned snapshot records.
2. Create domain-named Events that capture the state required for future
   decisions. Do not invent unavailable history.
3. Append the Events idempotently using stable bootstrap keys.
4. Catch the migrated Slice up and verify its table projection is equivalent to
   the snapshot.
5. Cut the selected route over only after bootstrap succeeds.

Bootstrap must be safe to resume. A partial run must converge without duplicate
domain records, Events, or effects.

## Preserve the public boundary

Keep the existing route, authentication, request validation, response body,
status codes, and stable error codes. Runtime schemas validate untrusted input;
Scenarios describe valid domain examples and are not transport tests. Map
Specter rejection and infrastructure errors into the application's existing
error convention without leaking internal details.

Create random IDs and wall-clock timestamps at the route or another explicit
boundary and include them in the Command input. Command decisions and Scenario
outcomes must remain deterministic.

## Implement application-owned adapters

Use only the application's existing database, cache, and durable job system.
The Event Log transaction serializes catch-up, decision, and append against one
authoritative version. Idempotency receipts and Events commit together. Event
queries return unique, strictly increasing global orders after the requested
cursor.

Slice State publication is separate from the Event Log transaction. Stage
updates, publish State and cursor together, isolate Slices, and make reset and
replay safe after failure.

The Reaction scheduler durably coalesces work for a logical pass, survives
restart, serializes competing drains, and exposes stable `deliveryId` and
`scheduledAt` values across retries. `attemptId` and `attemptNumber` change per
try. A Command commit is not rolled back when a Reaction later fails.

Run the supplied black-box verifier against real application services. Do not
special-case its fixtures in adapter code.

## Wire lifecycle explicitly

Construct and await the Specter App inside the application's normal startup
lifecycle. Report ready only when the database and durable scheduler can serve
new Specter work. On shutdown, stop accepting requests, drain or safely release
owned work, close Specter resources, and then close infrastructure clients.

Test a complete process restart. Durable Events must reconstruct the same
projection, pending Reaction work must resume, and unchanged readers must see
the projected result.

## Minimum evidence

A migrated operation is not complete until it has:

- an accepted Scenario and a rejection caused by prior Events;
- bootstrap equivalence and restart/replay coverage;
- malformed-input coverage proving no Event was committed;
- route coverage for the preserved success response and repeated guarded
  rejection;
- compatibility coverage for at least one unchanged legacy reader; and
- a green adapter-verifier report against the real database and scheduler.
